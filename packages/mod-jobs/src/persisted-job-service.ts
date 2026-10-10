import type { Json, ModServices } from '@kernlang/agon-mod-api';
import { createPersistenceEnvelope } from '@kernlang/agon-support-persistence';
import { JobService, isTerminalJobState, positiveJobServiceInteger } from './job-service.js';
import type { JobExecutor, JobObservation, JobSnapshot, JobTaskContext } from './job-service.js';

/** Keep the existing mod API while JobService owns all scheduling decisions. */
export class ModularJobService extends JobService<Json> {
  private readonly pendingWrites = new Map<string, { envelope: Json; terminal: boolean }>();
  private readonly outstandingJobs = new Set<string>();
  private readonly persistenceCapacity: number;
  private writer: Promise<void> | undefined;
  private persistenceFailure: Error | undefined;
  private closed = false;

  constructor(private readonly services: ModServices, maxConcurrency = 2, eventLimit = 1000, retentionLimit = 100) {
    super({ maxConcurrency, eventLimit, retentionLimit });
    this.persistenceCapacity = positiveJobServiceInteger(retentionLimit, 100, 'jobRetentionLimit');
  }

  override submit(kind: string, label: string, task: JobExecutor<Json> | ((context: JobTaskContext<Json>) => Promise<Json>)): JobSnapshot {
    this.requireOpen();
    return super.submit(kind, label, typeof task === 'function' ? { run: task } : task);
  }

  override createManual(kind: string, label: string): JobSnapshot {
    this.requireOpen();
    return super.createManual(kind, label);
  }

  close(): void { this.closed = true; }

  private requireOpen(): void {
    if (this.closed) throw new Error('Jobs service is closed');
    if (this.outstandingJobs.size >= this.persistenceCapacity) {
      throw new Error('Jobs persistence backlog is full; wait for storage to recover before submitting more work');
    }
  }

  override events(id: string, after = 0, limit = 100) {
    return super.events(id, after, limit);
  }

  protected override onRecordChanged(record: JobObservation<Json>): void {
    // Reserve one slot until the terminal record reaches storage.
    this.outstandingJobs.add(record.snapshot.id);
    try {
      const payload = JSON.parse(JSON.stringify({
        snapshot: record.snapshot, events: record.events, outcome: record.outcome,
      })) as Json;
      const envelope = createPersistenceEnvelope({
        kind: 'job', status: record.snapshot.state, payload, idSeed: record.snapshot.id,
        ownerModId: 'agon.jobs', ownerModVersion: this.services.identity.version,
        ownerContentHash: this.services.identity.contentHash,
        contributionId: 'agon.jobs.persisted-job', createdAt: record.snapshot.createdAt,
        updatedAt: record.snapshot.finishedAt ?? record.snapshot.startedAt ?? record.snapshot.createdAt,
      });
      this.pendingWrites.set(record.snapshot.id, {
        envelope: envelope as unknown as Json,
        terminal: isTerminalJobState(record.snapshot.state),
      });
      this.startWriter();
    } catch (error) { this.recordFailure(error); }
  }

  private startWriter(): void {
    if (this.writer) return;
    this.writer = Promise.resolve().then(() => this.writePending()).finally(() => {
      this.writer = undefined;
      if (this.pendingWrites.size) this.startWriter();
    });
  }

  private async writePending(): Promise<void> {
    while (this.pendingWrites.size) {
      const [id, write] = this.pendingWrites.entries().next().value!;
      this.pendingWrites.delete(id);
      try {
        await this.services.state.write(`jobs/${id}`, write.envelope);
        if (write.terminal) this.outstandingJobs.delete(id);
      }
      catch (error) { this.recordFailure(error); }
    }
  }

  private recordFailure(error: unknown): void {
    this.persistenceFailure ??= error instanceof Error ? error : new Error(String(error));
    try {
      void Promise.resolve(this.services.logger.warn('Jobs state write failed', {
        error: this.persistenceFailure.message,
      })).catch(() => console.warn('[agon.jobs] State persistence and its diagnostic logger failed'));
    } catch {
      console.warn('[agon.jobs] State persistence and its diagnostic logger failed');
    }
  }

  /** Drain observations received so far. A timeout does not cancel host storage I/O. */
  async flushPersistence(timeoutMs = 10_000): Promise<void> {
    const timeout = positiveJobServiceInteger(timeoutMs, 10_000, 'persistence timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `Jobs persistence did not finish within ${timeout} ms; host storage I/O may still be pending`,
      )), timeout);
    });
    try {
      while (this.writer) await Promise.race([this.writer, deadline]);
      if (this.persistenceFailure) throw this.persistenceFailure;
    } finally {
      clearTimeout(timer);
    }
  }
}
