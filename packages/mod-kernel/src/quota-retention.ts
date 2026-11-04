import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import type { DurableModHost } from './durable-host.js';
import { atomicWrite, pathExists, readJson } from './host-io.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import { assertNoSymlinkComponents } from './folder-mod-bounds.js';
import { WriterFence, releaseLifecycleWriters } from './writer-lock.js';
import { parseGenerationCollectionPlan, type ManagedGenerationCollectionPlan } from './generation-retirement.js';
import { ManagedRetentionInspector, applyManagedGenerationCollection, applyManagedPurge,
  previewManagedGenerationCollection, previewQuotaInstallationPurge,
  type ManagedPurgePlan, type ManagedRetentionReport } from './lifecycle-recovery.js';

export interface RetentionCacheSnapshot {
  readonly path: string;
  readonly logicalBytes: number;
  readonly identity: string;
}

/** Inject the existing cache owner. The kernel never imports a support package. */
export interface RetentionCacheOwner {
  readonly path: string;
  inspect(): RetentionCacheSnapshot | null;
  evict(snapshot: RetentionCacheSnapshot): 'removed' | 'missing' | 'changed';
  recover?(): Promise<void>;
}

type QuotaStep =
  | { readonly kind: 'generation'; readonly plan: ManagedGenerationCollectionPlan; readonly logicalBytes: number }
  | { readonly kind: 'installation'; readonly plan: ManagedPurgePlan; readonly installationHash: `sha256:${string}`; readonly logicalBytes: number };

export interface ManagedQuotaPlan {
  readonly schemaVersion: 1;
  readonly kind: 'quota-retention';
  readonly transactionId: string;
  readonly hostRoot: string;
  readonly quotaBytes: number;
  readonly rollbackWindowMs: number;
  readonly cachePath: string | null;
  readonly cache: RetentionCacheSnapshot | null;
  readonly steps: readonly QuotaStep[];
  readonly planHash: `sha256:${string}`;
}

interface QuotaJournal {
  readonly schemaVersion: 1;
  readonly plan: ManagedQuotaPlan;
  state: 'running' | 'quota-met' | 'exhausted' | 'cancelled';
  cacheOutcome: 'pending' | 'consumed' | 'removed' | 'missing' | 'changed' | 'unknown' | 'not-applicable';
  nextStep: number;
  inFlight: boolean;
  cancelRequested: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const PLAN_LIMIT = 256 * 1024;
const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value));
const approvalBytes = (plan: ManagedQuotaPlan) => Buffer.byteLength(JSON.stringify({ schemaVersion: 2, kind: 'quota-collection', preview: plan }, null, 2) + '\n');

function shape(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new TypeError('quota record has unexpected fields');
}

function count(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError('quota byte counts and durations must be nonnegative safe integers');
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) { count(value); total += value; count(total); }
  return total;
}

export function parseManagedQuotaPlan(input: unknown): ManagedQuotaPlan {
  shape(input, ['schemaVersion', 'kind', 'transactionId', 'hostRoot', 'quotaBytes', 'rollbackWindowMs', 'cachePath', 'cache', 'steps', 'planHash']);
  const value = structuredClone(input) as unknown as ManagedQuotaPlan;
  if (value.schemaVersion !== 1 || value.kind !== 'quota-retention' || !UUID.test(value.transactionId)
    || typeof value.hostRoot !== 'string' || !isAbsolute(value.hostRoot)
    || (value.cachePath !== null && (typeof value.cachePath !== 'string' || !isAbsolute(value.cachePath)))) throw new TypeError('quota plan identity is invalid');
  count(value.quotaBytes); count(value.rollbackWindowMs);
  if (value.cache !== null) {
    shape(value.cache, ['path', 'logicalBytes', 'identity']);
    count(value.cache.logicalBytes);
    if (value.cache.path !== value.cachePath || typeof value.cache.identity !== 'string' || !value.cache.identity) throw new TypeError('quota cache identity is invalid');
  }
  if (!Array.isArray(value.steps)) throw new TypeError('quota steps must be an array');
  const transactions = new Set([value.transactionId]);
  const generations = new Set<number>();
  const installations = new Set<string>();
  let selection: number | null | undefined;
  for (const step of value.steps) {
    count(step.logicalBytes);
    if (step.kind === 'generation') {
      shape(step, ['kind', 'plan', 'logicalBytes']);
      const child = parseGenerationCollectionPlan(step.plan);
      if (child.hostRoot !== value.hostRoot || child.rollbackWindowMs !== value.rollbackWindowMs || child.generations.length !== 1) throw new TypeError('quota generation child does not match parent');
      const generation = child.generations[0]!.manifest.generation;
      if (generations.has(generation)) throw new TypeError('quota generation is duplicated');
      generations.add(generation);
      if (selection !== undefined && selection !== child.selectedPointer.generation) throw new TypeError('quota selections disagree');
      selection = child.selectedPointer.generation;
    } else if (step.kind === 'installation') {
      shape(step, ['kind', 'plan', 'installationHash', 'logicalBytes']);
      shape(step.plan, ['schemaVersion', 'transactionId', 'selectedGeneration', 'installationPaths', 'dataPaths', 'installationHash', 'installationMode', 'planHash']);
      const { planHash, ...unsigned } = step.plan;
      if (step.plan.schemaVersion !== 2 || planHash !== sha256Canonical(unsigned) || !HASH.test(step.installationHash)
        || step.plan.installationHash !== step.installationHash
        || !Number.isInteger(step.plan.installationMode) || step.plan.installationMode! < 0 || step.plan.installationMode! > 0o777
        || !Array.isArray(step.plan.installationPaths) || step.plan.installationPaths.length !== 1
        || !Array.isArray(step.plan.dataPaths) || step.plan.dataPaths.length !== 0) throw new TypeError('quota payload child is invalid');
      const path = step.plan.installationPaths[0]!;
      if (typeof path !== 'string' || !/^installations\/[a-f0-9]{32}$/.test(relative(value.hostRoot, path)) || installations.has(path)) throw new TypeError('quota payload path is invalid or duplicated');
      installations.add(path);
      if (step.plan.selectedGeneration !== null) count(step.plan.selectedGeneration);
      if (selection !== undefined && selection !== step.plan.selectedGeneration) throw new TypeError('quota selections disagree');
      selection = step.plan.selectedGeneration;
    } else throw new TypeError('quota step kind is invalid');
    if (!UUID.test(step.plan.transactionId) || transactions.has(step.plan.transactionId)) throw new TypeError('quota child transaction is invalid or duplicated');
    transactions.add(step.plan.transactionId);
  }
  const { planHash, ...unsigned } = value;
  if (planHash !== sha256Canonical(unsigned)) throw new TypeError('quota plan hash does not match');
  if (approvalBytes(value) > PLAN_LIMIT) throw new TypeError('quota approval exceeds 256 KiB');
  const freeze = (entry: unknown): void => {
    if (entry && typeof entry === 'object') { for (const child of Object.values(entry)) freeze(child); Object.freeze(entry); }
  };
  freeze(value);
  return value;
}

function newJournal(plan: ManagedQuotaPlan): QuotaJournal {
  return { schemaVersion: 1, plan, state: 'running', cacheOutcome: plan.cache ? 'pending' : 'not-applicable', nextStep: 0, inFlight: false, cancelRequested: false };
}

function evidenceBytes(plan: ManagedQuotaPlan): number {
  return sum([
    approvalBytes(plan),
    bytes({ ...newJournal(plan), cacheOutcome: 'not-applicable', nextStep: plan.steps.length }) + 1,
    ...plan.steps.map(step => bytes(step.kind === 'generation'
      ? { schemaVersion: 2, kind: 'generation-retention', plan: step.plan, phases: ['cancelled'] }
      : { schemaVersion: 1, planHash: step.plan.planHash, phases: ['cancelled'] }) + 1),
  ]);
}

async function observe(host: DurableModHost, quotaBytes: number, rollbackWindowMs: number, owner?: RetentionCacheOwner, recoverStaleWriters = false) {
  const report = await new ManagedRetentionInspector(host, { durationMs: rollbackWindowMs }).inspect({ recoverStaleWriters });
  if (recoverStaleWriters) await owner?.recover?.();
  const cache = owner?.inspect() ?? null;
  if (cache && cache.path !== owner?.path) throw new TypeError('cache owner returned a different path');
  const cacheBytes = cache?.logicalBytes ?? 0;
  count(cacheBytes);
  const path = owner ? relative(host.root, owner.path) : '';
  const outside = path.startsWith('..') || isAbsolute(path);
  const logicalBytes = sum([report.accounting.totalLogicalBytes, outside ? cacheBytes : 0]);
  return { report, cache, cacheBytes, logicalBytes, shortfallBytes: Math.max(0, logicalBytes - quotaBytes), quotaMet: logicalBytes <= quotaBytes };
}

export async function previewManagedQuotaCollection(host: DurableModHost, options: {
  readonly quotaBytes: number; readonly rollbackWindowMs: number; readonly cacheOwner?: RetentionCacheOwner;
}): Promise<{ readonly plan: ManagedQuotaPlan | null; readonly report: ManagedRetentionReport; readonly logicalBytes: number;
  readonly estimatedRemovedBytes: number; readonly estimatedEvidenceBytes: number }> {
  count(options.quotaBytes); count(options.rollbackWindowMs);
  const observation = await observe(host, options.quotaBytes, options.rollbackWindowMs, options.cacheOwner);
  const report = observation.report;
  if (observation.quotaMet) return { plan: null, report, logicalBytes: observation.logicalBytes, estimatedRemovedBytes: 0, estimatedEvidenceBytes: 0 };
  const eligible = report.generations.filter(generation => !generation.selected && generation.processLeaseIds.length === 0
    && generation.artifactLeaseIds.length === 0 && report.rollbackWindow?.generations.some(window => window.generation === generation.generation && !window.protected));
  const remaining = new Map(eligible.map(generation => [generation.generation, generation]));
  const steps: QuotaStep[] = [];
  const identity = { schemaVersion: 1 as const, kind: 'quota-retention' as const, transactionId: randomUUID(), hostRoot: host.root,
    quotaBytes: options.quotaBytes, rollbackWindowMs: options.rollbackWindowMs, cachePath: options.cacheOwner?.path ?? null,
    cache: observation.cache };
  const candidatePlan = (candidates: readonly QuotaStep[]): ManagedQuotaPlan => {
    const unsigned = { ...identity, steps: candidates };
    return { ...unsigned, planHash: sha256Canonical(unsigned) };
  };
  const append = async (ids: readonly number[], installation?: { installationId: string; logicalBytes: number }) => {
    const group: QuotaStep[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
      const generation = remaining.get(id)!;
      group.push({ kind: 'generation', plan: await previewManagedGenerationCollection(host, { generations: [id], rollbackWindowMs: options.rollbackWindowMs }), logicalBytes: generation.logicalBytes });
    }
    if (installation) group.push({ kind: 'installation', ...await previewQuotaInstallationPurge(host, installation.installationId, ids), logicalBytes: installation.logicalBytes });
    // A metadata-only group can retain more evidence than it removes.
    const childCost = sum(group.map(step => bytes(step) * 2 + (step.kind === 'generation' ? bytes(step.plan) : 0)));
    // Keep shared payload groups intact and budget the exact saved approval format.
    if (sum(group.map(step => step.logicalBytes)) > childCost
      && approvalBytes(candidatePlan([...steps, ...group])) <= PLAN_LIMIT) steps.push(...group);
    for (const id of ids) remaining.delete(id);
  };
  for (const installation of [...report.installations].sort((a, b) => Math.min(...a.generations) - Math.min(...b.generations) || a.installationId.localeCompare(b.installationId))) {
    if (installation.generations.every(id => remaining.has(id))) await append(installation.generations, installation);
  }
  for (const id of [...remaining.keys()].sort((a, b) => a - b)) await append([id]);
  for (const installation of report.unreferencedInstallations) await append([], installation);
  const plan = parseManagedQuotaPlan(candidatePlan(steps));
  const estimatedRemovedBytes = sum([observation.cacheBytes, ...steps.map(step => step.logicalBytes)]);
  const estimatedEvidenceBytes = evidenceBytes(plan);
  return { plan: estimatedRemovedBytes > estimatedEvidenceBytes ? plan : null, report, logicalBytes: observation.logicalBytes, estimatedRemovedBytes, estimatedEvidenceBytes };
}

/** Resume exact child identities. A terminal attempt never wakes to chase later growth. */
export async function applyManagedQuotaCollection(host: DurableModHost, input: ManagedQuotaPlan, approvedHash: string,
  options: { readonly cacheOwner?: RetentionCacheOwner; readonly cancelPending?: boolean } = {},
) {
  const plan = parseManagedQuotaPlan(input);
  if (plan.hostRoot !== host.root || approvedHash !== plan.planHash || (options.cacheOwner?.path ?? null) !== plan.cachePath) throw new TypeError('quota approval does not bind this host and cache owner');
  if (options.cancelPending !== undefined && typeof options.cancelPending !== 'boolean') throw new TypeError('cancelPending must be boolean');
  const lockPath = join(host.root, 'locks', 'quota-writer.json');
  const fence = await (await pathExists(host.hostIo, lockPath)
    ? WriterFence.recoverStale(lockPath, 'agon.kernel.retention', { io: host.hostIo })
    : WriterFence.acquire(lockPath, 'agon.kernel.retention', { io: host.hostIo }));
  const errors: unknown[] = [];
  try {
    const directory = join(host.root, 'retention-transactions');
    const path = join(directory, `${plan.transactionId}.json`);
    await host.hostIo.mkdir(directory, { recursive: true, mode: 0o700 });
    await assertNoSymlinkComponents(host.root, relative(host.root, directory));
    try { await assertNoSymlinkComponents(host.root, relative(host.root, path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let journal = newJournal(plan);
    if (await pathExists(host.hostIo, path)) {
      await assertNoSymlinkComponents(host.root, relative(host.root, path));
      const raw = await readJson<Record<string, unknown>>(host.hostIo, path);
      shape(raw, ['schemaVersion', 'plan', 'state', 'cacheOutcome', 'nextStep', 'inFlight', 'cancelRequested']);
      if (raw.schemaVersion !== 1 || canonicalJson(raw.plan) !== canonicalJson(plan)
        || !['running', 'quota-met', 'exhausted', 'cancelled'].includes(String(raw.state))
        || !['pending', 'consumed', 'removed', 'missing', 'changed', 'unknown', 'not-applicable'].includes(String(raw.cacheOutcome))
        || !Number.isSafeInteger(raw.nextStep) || Number(raw.nextStep) < 0 || Number(raw.nextStep) > plan.steps.length
        || typeof raw.inFlight !== 'boolean' || typeof raw.cancelRequested !== 'boolean'
        || (raw.inFlight && Number(raw.nextStep) === plan.steps.length)) throw new TypeError('quota journal is invalid');
      if ((raw.state !== 'running' && raw.inFlight) || (raw.state === 'exhausted' && raw.nextStep !== plan.steps.length)
        || (plan.cache === null && raw.cacheOutcome !== 'not-applicable')
        || (plan.cache !== null && raw.cacheOutcome === 'not-applicable')) throw new TypeError('quota journal progress is inconsistent');
      journal = raw as unknown as QuotaJournal;
      await host.hostIo.syncFile(path);
      await host.hostIo.syncDirectory(directory);
    }
    const save = async () => { await fence.assertOwned(); await atomicWrite(host.hostIo, path, `${canonicalJson(journal)}\n`); await host.hostIo.syncDirectory(host.root); };
    if (journal.state === 'running') {
      // Persist the stop request before child cleanup. Resume must not start later children.
      journal.cancelRequested ||= options.cancelPending === true;
      await save();
      const cancelPending = journal.cancelRequested;
      if (journal.cacheOutcome === 'consumed') {
        await options.cacheOwner?.recover?.();
        journal.cacheOutcome = 'unknown';
        await save();
      }
      if (!cancelPending && !journal.inFlight && (await observe(host, plan.quotaBytes, plan.rollbackWindowMs, options.cacheOwner, true)).quotaMet) journal.state = 'quota-met';
      if (journal.state === 'running' && journal.cacheOutcome === 'pending' && !cancelPending) {
        journal.cacheOutcome = 'consumed';
        await save();
        journal.cacheOutcome = options.cacheOwner!.evict(plan.cache!);
        await save();
      }
      while (journal.state === 'running' && journal.nextStep < plan.steps.length) {
        if (!journal.inFlight) {
          if (cancelPending) break;
          if ((await observe(host, plan.quotaBytes, plan.rollbackWindowMs, options.cacheOwner, true)).quotaMet) {
            journal.state = 'quota-met';
            break;
          }
          journal.inFlight = true;
          await save();
        }
        const step = plan.steps[journal.nextStep]!;
        // A killed child can leave its writers behind. Live writers still block.
        for (const childLock of [join(host.root, 'locks', 'lifecycle-writer.json'), host.paths.writerLock]) {
          if (await pathExists(host.hostIo, childLock)) {
            const recovered = await WriterFence.recoverStale(childLock, 'agon.kernel.retention', { io: host.hostIo });
            await recovered.release();
          }
        }
        if (step.kind === 'generation') await applyManagedGenerationCollection(host, step.plan, step.plan.planHash, { cancelPending });
        else await applyManagedPurge(host, step.plan, step.plan.planHash, { installationHash: step.installationHash, cancelPending });
        journal.nextStep++;
        journal.inFlight = false;
        await save();
        if (cancelPending) break;
      }
      if (journal.state === 'running') journal.state = cancelPending ? 'cancelled'
        : (await observe(host, plan.quotaBytes, plan.rollbackWindowMs, options.cacheOwner, true)).quotaMet ? 'quota-met' : 'exhausted';
      await save();
    }
    return { state: journal.state, cacheOutcome: journal.cacheOutcome, completedSteps: journal.nextStep,
      ...await observe(host, plan.quotaBytes, plan.rollbackWindowMs, options.cacheOwner, true) };
  } catch (error) { errors.push(error); throw error; }
  finally { await releaseLifecycleWriters([fence], errors); }
}
