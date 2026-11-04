import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { BoundedProcessRunner } from './candidate-process.js';
import { runBoundedCandidateProcess } from './candidate-process.js';
import { DurableHostError } from './host-errors.js';
import { nodeHostIo, pathExists, writeNewImmutableFile, type HostIo } from './host-io.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import { makeTreeRemovable } from './removable-tree.js';

export type SetupActionKind = 'python-environment' | 'native-helper' | 'wasm-asset' | 'download-asset';

export interface SetupActionDefinition {
  readonly id: string;
  readonly packageId: string;
  readonly kind: SetupActionKind;
  readonly executable: string;
  readonly executableHash: `sha256:${string}`;
  readonly args: readonly string[];
  readonly declaredOutputs: readonly string[];
  readonly requiresNetwork: boolean;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface SetupActionPlan {
  readonly schemaVersion: 1;
  readonly action: SetupActionDefinition;
  readonly installationId: string;
  readonly installationPrefix: string;
  readonly networkPolicy: 'online' | 'frozen-offline';
  readonly approvalReasons: readonly string[];
  readonly planHash: `sha256:${string}`;
}

export interface SetupActionReceipt {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly planHash: `sha256:${string}`;
  readonly packageId: string;
  readonly actionId: string;
  readonly outcome: 'passed' | 'failed' | 'rolled-back';
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly outputTruncated: boolean;
  readonly rolledBackOutputs: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

function contained(root: string, candidate: string, label: string): string {
  if (!candidate || isAbsolute(candidate) || candidate.includes('\0')) throw new TypeError(`${label} must be a safe relative path`);
  const absolute = resolve(root, candidate);
  const relation = relative(resolve(root), absolute);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw new TypeError(`${label} escapes the installation prefix`);
  return absolute;
}

async function fileHash(io: HostIo, path: string): Promise<`sha256:${string}`> {
  return `sha256:${createHash('sha256').update(await io.readFile(path)).digest('hex')}`;
}

export async function createSetupActionPlan(
  definition: SetupActionDefinition,
  installation: { readonly installationId: string; readonly installationPrefix: string },
  networkPolicy: SetupActionPlan['networkPolicy'],
  io: HostIo = nodeHostIo,
): Promise<SetupActionPlan> {
  if (!/^[a-z][a-z0-9._-]*$/.test(definition.id) || !definition.packageId.trim()) throw new TypeError('setup action identity is malformed');
  if (!/^sha256:[a-f0-9]{64}$/.test(definition.executableHash)) throw new TypeError('setup executable hash is malformed');
  if (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs < 1 || definition.timeoutMs > 15 * 60_000) throw new TypeError('setup timeout is out of bounds');
  if (!Number.isSafeInteger(definition.maxOutputBytes) || definition.maxOutputBytes < 1 || definition.maxOutputBytes > 16 * 1024 * 1024) throw new TypeError('setup output bound is invalid');
  if (new Set(definition.declaredOutputs).size !== definition.declaredOutputs.length) throw new TypeError('setup outputs must be unique');
  const executable = contained(installation.installationPrefix, definition.executable, 'setup executable');
  for (const output of definition.declaredOutputs) contained(installation.installationPrefix, output, 'setup output');
  if (await fileHash(io, executable) !== definition.executableHash) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'setup executable integrity mismatch');
  if (networkPolicy === 'frozen-offline' && definition.requiresNetwork) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'network setup action is unavailable in frozen-offline mode');
  const unsigned = Object.freeze({
    schemaVersion: 1 as const,
    action: Object.freeze({ ...definition, args: Object.freeze([...definition.args]), declaredOutputs: Object.freeze([...definition.declaredOutputs].sort()) }),
    installationId: installation.installationId,
    installationPrefix: resolve(installation.installationPrefix),
    networkPolicy,
    approvalReasons: Object.freeze([
      `setup-action:${definition.packageId}:${definition.id}`,
      ...(definition.requiresNetwork ? ['network-access'] : []),
      ...definition.declaredOutputs.map((path) => `write:${path}`).sort(),
    ]),
  });
  return Object.freeze({ ...unsigned, planHash: sha256Canonical(unsigned) });
}

export async function executeSetupAction(
  plan: SetupActionPlan,
  approvedPlanHash: string,
  options: {
    readonly receiptsRoot: string;
    readonly runner?: BoundedProcessRunner;
    readonly io?: HostIo;
    readonly now?: () => Date;
  },
): Promise<SetupActionReceipt> {
  if (approvedPlanHash !== plan.planHash) throw new DurableHostError('MOD_TRANSACTION_CONFLICT', 'setup approval does not match exact preview');
  const io = options.io ?? nodeHostIo;
  const now = options.now ?? (() => new Date());
  const runner = options.runner ?? runBoundedCandidateProcess;
  const executable = contained(plan.installationPrefix, plan.action.executable, 'setup executable');
  if (await fileHash(io, executable) !== plan.action.executableHash) throw new DurableHostError('MOD_TRANSACTION_FAILED', 'setup executable changed after approval');
  const startedAt = now().toISOString();
  let result: Awaited<ReturnType<BoundedProcessRunner>> | null = null;
  let outcome: SetupActionReceipt['outcome'] = 'failed';
  const rolledBackOutputs: string[] = [];
  try {
    result = await runner({
      executable,
      args: [...plan.action.args],
      cwd: resolve(plan.installationPrefix),
      env: {
        AGON_SETUP_ACTION_ID: plan.action.id,
        AGON_SETUP_INSTALLATION_ID: plan.installationId,
        AGON_SETUP_NETWORK_POLICY: plan.networkPolicy,
      },
      timeoutMs: plan.action.timeoutMs,
      maxOutputBytes: plan.action.maxOutputBytes,
    });
    if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error('bounded setup subprocess failed');
    outcome = 'passed';
  } catch (error) {
    for (const output of [...plan.action.declaredOutputs].reverse()) {
      const path = contained(plan.installationPrefix, output, 'setup output');
      if (!await pathExists(io, path)) continue;
      await makeTreeRemovable(io, path).catch(() => undefined);
      await io.rm(path, { recursive: true, force: true });
      rolledBackOutputs.push(output);
    }
    outcome = rolledBackOutputs.length > 0 ? 'rolled-back' : 'failed';
  }
  const receipt: SetupActionReceipt = Object.freeze({
    schemaVersion: 1,
    receiptId: randomUUID(),
    planHash: plan.planHash,
    packageId: plan.action.packageId,
    actionId: plan.action.id,
    outcome,
    exitCode: result?.exitCode ?? null,
    timedOut: result?.timedOut ?? false,
    outputTruncated: result?.outputTruncated ?? false,
    rolledBackOutputs: Object.freeze(rolledBackOutputs),
    startedAt,
    finishedAt: now().toISOString(),
  });
  const receiptPath = contained(options.receiptsRoot, `${receipt.receiptId}.json`, 'setup receipt');
  await io.mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  await writeNewImmutableFile(io, receiptPath, `${canonicalJson(receipt)}\n`);
  if (receipt.outcome !== 'passed') throw new DurableHostError('MOD_TRANSACTION_FAILED', 'setup action failed and declared outputs were rolled back', { receipt });
  return receipt;
}
