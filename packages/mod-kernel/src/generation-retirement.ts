import { join, relative } from 'node:path';
import type { GenerationPointer } from './durable-host.js';
import { parseGenerationPointer, parseGenerationRetirementEvidence, parseHostTransactionJournal, validateGenerationContents, type GenerationRetirementEvidence } from './host-contracts.js';
import { DurableHostError } from './host-errors.js';
import { pathExists, readJson, type HostIo } from './host-io.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import { assertNoSymlinkComponents } from './folder-mod-bounds.js';

export interface ManagedGenerationCollectionPlan {
  readonly schemaVersion: 3;
  readonly kind: 'generation-retention';
  readonly transactionId: string;
  readonly hostRoot: string;
  readonly selectedPointer: GenerationPointer;
  readonly rollbackWindowMs: number;
  readonly observedAt: string;
  readonly generations: readonly GenerationRetirementEvidence[];
  readonly planHash: `sha256:${string}`;
}

export interface GenerationRetirementJournal {
  readonly schemaVersion: 2;
  readonly kind: 'generation-retention';
  readonly plan: ManagedGenerationCollectionPlan;
  readonly phases: readonly ('pending' | 'staged' | 'removed' | 'cancelled')[];
}

export function parseGenerationCollectionPlan(value: unknown): ManagedGenerationCollectionPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('collection plan must be an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'generations,hostRoot,kind,observedAt,planHash,rollbackWindowMs,schemaVersion,selectedPointer,transactionId'
    || input.schemaVersion !== 3 || input.kind !== 'generation-retention'
    || typeof input.transactionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.transactionId)
    || typeof input.hostRoot !== 'string' || !input.hostRoot.startsWith('/')
    || !Number.isSafeInteger(input.rollbackWindowMs) || (input.rollbackWindowMs as number) < 0
    || typeof input.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observedAt))
    || !Array.isArray(input.generations) || input.generations.length === 0) throw new TypeError('collection plan shape is invalid');
  const selectedPointer = parseGenerationPointer(input.selectedPointer);
  const generations = input.generations.map(parseGenerationRetirementEvidence);
  const ids = generations.map(entry => entry.manifest.generation);
  if (new Set(ids).size !== ids.length || ids.includes(selectedPointer.generation)) throw new TypeError('collection targets duplicate or include the selected generation');
  const { planHash, ...unsigned } = input;
  if (planHash !== sha256Canonical(unsigned)) throw new TypeError('collection plan hash does not match');
  return Object.freeze({ schemaVersion: 3, kind: 'generation-retention', transactionId: input.transactionId,
    hostRoot: input.hostRoot, selectedPointer, rollbackWindowMs: input.rollbackWindowMs as number,
    observedAt: input.observedAt, generations: Object.freeze(generations), planHash: planHash as `sha256:${string}` });
}

export function parseGenerationRetirementJournal(value: unknown): GenerationRetirementJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('retirement journal must be an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'kind,phases,plan,schemaVersion'
    || input.schemaVersion !== 2 || input.kind !== 'generation-retention') throw new TypeError('retirement journal shape is invalid');
  const plan = parseGenerationCollectionPlan(input.plan);
  if (!Array.isArray(input.phases) || input.phases.length !== plan.generations.length
    || input.phases.some(phase => !['pending', 'staged', 'removed', 'cancelled'].includes(phase))) throw new TypeError('retirement phases are invalid');
  return Object.freeze({ schemaVersion: 2, kind: 'generation-retention', plan,
    phases: Object.freeze([...input.phases]) as GenerationRetirementJournal['phases'] });
}

/** Read only committed retirement identities. Never return executable bytes. */
export async function readRetiredGenerations(root: string, io: HostIo, options: {
  readonly claim?: { readonly transactionId: string; readonly generations: readonly number[] };
  readonly restorePendingPermissions?: boolean;
} = {}): Promise<ReadonlyMap<number, GenerationRetirementEvidence>> {
  const directory = join(root, 'purge-transactions');
  const result = new Map<number, GenerationRetirementEvidence>();
  if (!await pathExists(io, directory)) return result;
  await assertNoSymlinkComponents(root, relative(root, directory));
  for (const entry of await io.readdir(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.json')) continue;
    const path = join(directory, entry.name);
    try {
      await assertNoSymlinkComponents(root, relative(root, path));
      if (!entry.isFile()) throw new TypeError('purge journal must be a regular file');
      const input = await readJson<Record<string, unknown>>(io, path);
      // Version 1 belongs to ordinary data purge, which cannot target generations.
      if (input?.schemaVersion === 1 && Object.keys(input).sort().join(',') === 'phases,planHash,schemaVersion') continue;
      const journal = parseGenerationRetirementJournal(input);
      if (journal.plan.hostRoot !== root || entry.name !== `${journal.plan.transactionId}.json`) throw new TypeError('retirement journal location does not match its plan');
      if (options.claim?.transactionId === journal.plan.transactionId) continue;
      for (const [index, evidence] of journal.plan.generations.entries()) {
        if (journal.phases[index] === 'cancelled') continue;
        const generation = evidence.manifest.generation;
        if (options.claim?.generations.includes(generation)) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'generation is reserved by another approved retention plan', { generation, transactionId: journal.plan.transactionId });
        const original = join(root, 'generations', String(generation).padStart(16, '0'));
        const staged = join(root, 'purge-staging', journal.plan.transactionId, String(index));
        for (const target of [original, staged]) {
          try { await assertNoSymlinkComponents(root, relative(root, target)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        const originalExists = await pathExists(io, original);
        const stagedExists = await pathExists(io, staged);
        if (journal.phases[index] === 'pending') {
          if (!originalExists || stagedExists) throw new DurableHostError('MOD_RESTART_REQUIRED', 'resume the approved retention plan before host recovery', { transactionId: journal.plan.transactionId, generation });
          if (options.restorePendingPermissions) {
            await validateRetirementDirectory(root, io, original, evidence);
            await io.chmod(original, 0o555);
            await io.syncDirectory(original);
          }
          continue;
        }
        if (originalExists || (journal.phases[index] === 'removed' && stagedExists)) throw new TypeError('retired generation namespace contains replacement bytes');
        for (const receipt of evidence.receipts) {
          const transactionPath = join(root, 'transactions', `${receipt.transactionId}.json`);
          await assertNoSymlinkComponents(root, relative(root, transactionPath));
          const transaction = parseHostTransactionJournal(await readJson<unknown>(io, transactionPath));
          if (canonicalJson(transaction) !== canonicalJson(receipt.journal)) throw new TypeError('retirement evidence differs from the current selection journal');
        }
        const previous = result.get(generation);
        if (previous && canonicalJson(previous) !== canonicalJson(evidence)) throw new TypeError('retirement journals disagree about a generation');
        result.set(generation, evidence);
      }
    } catch (error) {
      if (error instanceof DurableHostError) throw error;
      throw new DurableHostError('MOD_GENERATION_CORRUPT', 'cannot verify retired generation history', { path, cause: String(error) }, { cause: error });
    }
  }
  return result;
}

/** Validate original or quarantined bytes against the same generation contract. */
export async function validateRetirementDirectory(hostRoot: string, io: HostIo, root: string, evidence: GenerationRetirementEvidence): Promise<void> {
  const files: Record<string, Uint8Array> = Object.create(null);
  const pending = [''];
  while (pending.length) {
    const prefix = pending.pop()!;
    await assertNoSymlinkComponents(hostRoot, relative(hostRoot, join(root, prefix)));
    for (const entry of await io.readdir(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      await assertNoSymlinkComponents(hostRoot, relative(hostRoot, join(root, path)));
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files[path] = await io.readFile(join(root, path));
      else throw new TypeError('retirement directory contains a non-regular entry');
    }
  }
  const manifest = JSON.parse(new TextDecoder().decode(files['generation.json']));
  delete files['generation.json'];
  const validated = validateGenerationContents(manifest, evidence.manifest.generation, evidence.manifest.kernelVersion, files);
  if (canonicalJson(validated) !== canonicalJson(evidence.manifest)) throw new TypeError('directory differs from the approved generation');
}
