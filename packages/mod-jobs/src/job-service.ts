import { randomUUID } from 'node:crypto';

const JOB_DEFAULTS = Object.freeze({ jobEventLimit: 256, jobRetentionLimit: 100, jobMaxConcurrency: 4 });

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type TerminalJobState = 'succeeded' | 'failed' | 'cancelled';

export interface JobSnapshot {
  id: string;
  kind: string;
  label: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface JobEvent<T = unknown> {
  seq: number;
  ts: number;
  type: string;
  data?: T | { error: string };
}

export interface JobEventPage<T = unknown> {
  jobId: string;
  events: JobEvent<T>[];
  nextSeq: number;
  earliestSeq: number;
  terminal: boolean;
  truncated: boolean;
}

export interface JobOutcome<T = unknown> {
  state: TerminalJobState;
  value?: T;
  error?: string;
}

export interface JobObservation<T = unknown> {
  readonly snapshot: JobSnapshot;
  readonly events: readonly JobEvent<T>[];
  readonly outcome: JobOutcome<T>|null;
}

export interface JobTaskContext<T = unknown> {
  signal: AbortSignal;
  emit: (type:string,data?:T)=>void;
}

export interface JobExecutor<T = unknown> {
  run: (ctx:JobTaskContext<T>)=>Promise<T>;
}

export interface JobServiceOptions {
  eventLimit?: number;
  retentionLimit?: number;
  maxConcurrency?: number;
}

export interface JobRecord<T = unknown> {
  snapshot: JobSnapshot;
  events: JobEvent<T>[];
  nextSeq: number;
  controller: AbortController;
  executor: JobExecutor<T>|null;
  outcome: JobOutcome<T>|null;
  taskSettled: boolean;
  waiters: Array<(outcome:JobOutcome<T>)=>void>;
}

export function isTerminalJobState(state: JobState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled';
}

export function positiveJobServiceInteger(value: number|undefined, fallback: number, label: string): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(candidate);
}

export function cloneSnapshot(snapshot: JobSnapshot): JobSnapshot {
  return { ...snapshot };
}

export function cloneOutcome<T>(outcome: JobOutcome<T>): JobOutcome<T> {
  return { ...outcome };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class JobService<T = unknown> {
  private records: Map<string,JobRecord<T>>;
  private queue: string[];
  private activeCount: number;
  private eventLimit: number;
  private retentionLimit: number;
  private maxConcurrency: number;
  private idleWaiters: Array<()=>void>;

  constructor(options?: JobServiceOptions) {
    this.records = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.idleWaiters = [];
    this.eventLimit = positiveJobServiceInteger(options?.eventLimit, JOB_DEFAULTS.jobEventLimit, 'jobEventLimit');
    this.retentionLimit = positiveJobServiceInteger(options?.retentionLimit, JOB_DEFAULTS.jobRetentionLimit, 'jobRetentionLimit');
    this.maxConcurrency = positiveJobServiceInteger(options?.maxConcurrency, JOB_DEFAULTS.jobMaxConcurrency, 'jobMaxConcurrency');
  }

  submit(kind: string, label: string, executor: JobExecutor<T>): JobSnapshot {
    const normalizedKind = String(kind ?? '').trim();
    const normalizedLabel = String(label ?? '').trim();
    if (!normalizedKind) throw new Error('Job kind must not be empty');
    if (!executor || typeof executor.run !== 'function') throw new Error('Job executor must provide run(ctx)');
    const id = randomUUID();
    const record: JobRecord<T> = {
      snapshot: {
        id,
        kind: normalizedKind,
        label: normalizedLabel || normalizedKind,
        state: 'queued',
        createdAt: new Date().toISOString(),
      },
      events: [],
      nextSeq: 1,
      controller: new AbortController(),
      executor,
      outcome: null,
      taskSettled: false,
      waiters: [],
    };
    this.records.set(id, record);
    this.appendEvent(record, 'queued');
    this.queue.push(id);
    this.pump();
    return cloneSnapshot(record.snapshot);
  }

  createManual(kind: string, label: string): JobSnapshot {
    const normalizedKind = String(kind ?? '').trim();
    const normalizedLabel = String(label ?? '').trim();
    if (!normalizedKind) throw new Error('Job kind must not be empty');
    const now = new Date().toISOString();
    const id = randomUUID();
    const record: JobRecord<T> = {
      snapshot: { id, kind: normalizedKind, label: normalizedLabel || normalizedKind, state: 'running', createdAt: now, startedAt: now },
      events: [], nextSeq: 1, controller: new AbortController(), executor: null,
      outcome: null, taskSettled: false, waiters: [],
    };
    this.records.set(id, record);
    this.appendEvent(record, 'queued');
    this.appendEvent(record, 'started');
    return cloneSnapshot(record.snapshot);
  }

  completeManual(id: string, value?: T): boolean {
    const record = this.records.get(id);
    if (!record || record.executor !== null || record.snapshot.state !== 'running') return false;
    this.finish(record, 'succeeded', value);
    record.taskSettled = true;
    this.resolveWaiters(record);
    this.prune();
    this.notifyIdle();
    return true;
  }

  failManual(id: string, error: string): boolean {
    const record = this.records.get(id);
    if (!record || record.executor !== null || record.snapshot.state !== 'running') return false;
    this.finish(record, 'failed', undefined, error);
    record.taskSettled = true;
    this.resolveWaiters(record);
    this.prune();
    this.notifyIdle();
    return true;
  }

  get(id: string): JobSnapshot|undefined {
    const record = this.records.get(id);
    return record ? cloneSnapshot(record.snapshot) : undefined;
  }

  list(): JobSnapshot[] {
    return [...this.records.values()]
      .map((record) => cloneSnapshot(record.snapshot))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  running(): JobSnapshot[] {
    return this.list().filter((job) => job.state === 'queued' || job.state === 'running');
  }

  result(id: string): JobOutcome<T>|null|undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    return record.outcome ? cloneOutcome(record.outcome) : null;
  }

  events(id: string, afterSeq?: number, limit?: number): JobEventPage<T>|undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    const cursor = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq as number)) : 0;
    const requestedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit as number)) : this.eventLimit;
    const boundedLimit = Math.min(requestedLimit, this.eventLimit);
    const earliestSeq = record.events[0]?.seq ?? record.nextSeq;
    const events = record.events
      .filter((event) => event.seq > cursor)
      .slice(0, boundedLimit)
      .map((event) => ({ ...event }));
    return {
      jobId: id,
      events,
      nextSeq: events.length > 0 ? events[events.length - 1].seq : cursor,
      earliestSeq,
      terminal: isTerminalJobState(record.snapshot.state),
      truncated: cursor < earliestSeq - 1,
    };
  }

  wait(id: string): Promise<JobOutcome<T>|undefined> {
    const record = this.records.get(id);
    if (!record) return Promise.resolve(undefined);
    if (record.outcome) return Promise.resolve(cloneOutcome(record.outcome));
    return new Promise((resolve) => {
      record.waiters.push((outcome) => resolve(cloneOutcome(outcome)));
    });
  }

  waitForIdle(timeoutMs?: number): Promise<boolean> {
    if (this.activeCount === 0 && this.queue.length === 0 && [...this.records.values()].every((record) => record.taskSettled)) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = (): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(true);
      };
      this.idleWaiters.push(waiter);
      if (timeoutMs !== undefined) {
        const timeout = positiveJobServiceInteger(timeoutMs, timeoutMs, 'timeoutMs');
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          this.idleWaiters = this.idleWaiters.filter((entry) => entry !== waiter);
          resolve(false);
        }, timeout);
        timer.unref?.();
      }
    });
  }

  cancel(id: string, reason?: string): boolean {
    const record = this.records.get(id);
    if (!record || isTerminalJobState(record.snapshot.state)) return false;
    const message = reason?.trim() || 'Cancelled';
    const wasQueued = record.snapshot.state === 'queued';
    try { record.controller.abort(message); } catch { record.controller.abort(); }
    this.finish(record, 'cancelled', undefined, message);
    if (wasQueued || record.executor === null) {
      record.executor = null;
      record.taskSettled = true;
      this.queue = this.queue.filter((queuedId) => queuedId !== id);
      this.resolveWaiters(record);
      this.prune();
      this.pump();
      this.notifyIdle();
    } else {
      // The caller sees cancellation now. The underlying executor still owns
      // its slot until its promise settles, even if it ignored AbortSignal.
      this.resolveWaiters(record);
    }
    return true;
  }

  cancelAll(reason?: string): number {
    let cancelled = 0;
    for (const job of this.running()) {
      if (this.cancel(job.id, reason)) cancelled += 1;
    }
    return cancelled;
  }

  private appendEvent(record: JobRecord<T>, type: string, data?: T | { error: string }): void {
    const event: JobEvent<T> = { seq: record.nextSeq++, ts: Date.now(), type };
    if (data !== undefined) event.data = data;
    record.events.push(event);
    if (record.events.length > this.eventLimit) {
      record.events.splice(0, record.events.length - this.eventLimit);
    }
    this.onRecordChanged(record);
  }

  /** Observe the current record before pruning. Overrides must not mutate it. */
  protected onRecordChanged(_record: JobObservation<T>): void {}

  private finish(record: JobRecord<T>, state: TerminalJobState, value?: T, error?: string): void {
    if (isTerminalJobState(record.snapshot.state)) return;
    record.snapshot.state = state;
    record.snapshot.finishedAt = new Date().toISOString();
    if (error) record.snapshot.error = error;
    record.outcome = { state };
    if (value !== undefined) record.outcome.value = value;
    if (error) record.outcome.error = error;
    this.appendEvent(record, state, error ? { error } : value);
  }

  private resolveWaiters(record: JobRecord<T>): void {
    if (!record.outcome) return;
    const waiters = record.waiters.splice(0);
    for (const resolve of waiters) resolve(record.outcome);
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) continue;
      const record = this.records.get(id);
      if (!record || record.snapshot.state !== 'queued' || !record.executor) continue;
      this.activeCount += 1;
      record.snapshot.state = 'running';
      record.snapshot.startedAt = new Date().toISOString();
      this.appendEvent(record, 'started');
      const context: JobTaskContext<T> = {
        signal: record.controller.signal,
        emit: (type, data) => {
          if (!isTerminalJobState(record.snapshot.state)) this.appendEvent(record, type, data);
        },
      };
      Promise.resolve()
        .then(() => record.executor!.run(context))
        .then((value) => {
          if (!isTerminalJobState(record.snapshot.state)) this.finish(record, 'succeeded', value);
        })
        .catch((error) => {
          if (!isTerminalJobState(record.snapshot.state)) this.finish(record, 'failed', undefined, errorMessage(error));
        })
        .finally(() => {
          record.executor = null;
          record.taskSettled = true;
          this.activeCount -= 1;
          this.resolveWaiters(record);
          this.prune();
          this.pump();
          this.notifyIdle();
        });
    }
  }

  private prune(): void {
    const terminal = [...this.records.values()]
      .filter((record) => record.taskSettled && isTerminalJobState(record.snapshot.state))
      .sort((a, b) => (a.snapshot.finishedAt ?? '').localeCompare(b.snapshot.finishedAt ?? ''));
    const removeCount = terminal.length - this.retentionLimit;
    for (let index = 0; index < removeCount; index += 1) {
      this.records.delete(terminal[index].snapshot.id);
    }
  }

  private notifyIdle(): void {
    if (this.activeCount !== 0 || this.queue.length !== 0) return;
    if ([...this.records.values()].some((record) => !record.taskSettled)) return;
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }
}
