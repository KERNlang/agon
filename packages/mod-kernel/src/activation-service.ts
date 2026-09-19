import type { CanonicalModLock } from './lock.js';
import { sha256Canonical } from './lock.js';
import type { CommitGenerationResult, GenerationPointer } from './durable-host.js';
import { DurableModHost } from './durable-host.js';
import { DurableHostError } from './host-errors.js';
import { rollbackGeneration } from './host-rollback.js';
import {
  DesiredStateConflictError,
  applyDesiredStatePlan,
  parseDesiredState,
  planDesiredStateChange,
  resolveDesiredState,
  type DesiredModState,
  type DesiredStateAction,
  type DesiredStatePlan,
  type FirstPartyModCatalog,
} from './desired-state.js';
import { assertSelectedLockIntegrity, assertSelectedLockPackageClosure } from './selected-lock-integrity.js';

export interface ActivationArtifacts {
  readonly lock: CanonicalModLock;
  readonly installedIndex: unknown;
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
}

export type ActivationArtifactBuilder = (
  desired: DesiredModState,
  effectiveModIds: readonly string[],
  effectivePackageIds: readonly string[],
) => ActivationArtifacts | Promise<ActivationArtifacts>;

export interface ActivationTransactionPlan {
  readonly schemaVersion: 1;
  readonly baseGeneration: number;
  readonly basePointerHash: `sha256:${string}`;
  readonly desired: DesiredStatePlan;
}

export interface ActivationRestartPolicy {
  readonly newSessions: 'immediate';
  readonly pinnedHosts: 'restart-required';
  readonly pinnedSurfaces: readonly ['tui', 'mcp', 'daemon', 'room-watcher', 'browser-host'];
}

export interface ActivationApplyResult extends CommitGenerationResult {
  readonly restartPolicy: ActivationRestartPolicy;
}

const RESTART_POLICY: ActivationRestartPolicy = Object.freeze({
  newSessions: 'immediate',
  pinnedHosts: 'restart-required',
  pinnedSurfaces: Object.freeze(['tui', 'mcp', 'daemon', 'room-watcher', 'browser-host'] as const),
});

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function pointerSubject(pointer: GenerationPointer): `sha256:${string}` {
  return sha256Canonical(pointer);
}

export class ModActivationService {
  constructor(
    readonly host: DurableModHost,
    readonly catalog: FirstPartyModCatalog,
    readonly buildArtifacts: ActivationArtifactBuilder,
  ) {}

  async readDesiredState(): Promise<DesiredModState> {
    try {
      const bytes = await this.host.hostIo.readFile(this.host.paths.desiredState);
      return parseDesiredState(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
      if (error instanceof DesiredStateConflictError) throw error;
      throw new DurableHostError('MOD_GENERATION_CORRUPT', 'selected desired-state snapshot is malformed or missing', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async preview(action: DesiredStateAction, now = new Date().toISOString()): Promise<ActivationTransactionPlan> {
    const pointer = await this.host.readCurrentPointer();
    if (!pointer) throw new DurableHostError('MOD_SAFE_MODE', 'activation requires a selected generation');
    await this.host.validateGeneration(pointer.generation);
    const current = await this.readDesiredState();
    return freeze({
      schemaVersion: 1,
      baseGeneration: pointer.generation,
      basePointerHash: pointerSubject(pointer),
      desired: planDesiredStateChange(this.catalog, current, action, now),
    });
  }

  async apply(plan: ActivationTransactionPlan): Promise<ActivationApplyResult> {
    const pointer = await this.host.readCurrentPointer();
    if (!pointer || pointer.generation !== plan.baseGeneration || pointerSubject(pointer) !== plan.basePointerHash) {
      throw new DesiredStateConflictError('selected generation changed after activation preview', {
        expectedGeneration: plan.baseGeneration,
        actualGeneration: pointer?.generation ?? null,
      });
    }
    const current = await this.readDesiredState();
    const desired = applyDesiredStatePlan(current, plan.desired);
    const resolved = resolveDesiredState(this.catalog, desired);
    const artifacts = await this.buildArtifacts(desired, resolved.effective, resolved.effectivePackages);
    const desiredStateHash = sha256Canonical(desired);
    if (artifacts.lock.desiredStateHash !== desiredStateHash) {
      throw new DurableHostError('MOD_TRANSACTION_FAILED', 'activation lock is not bound to the exact desired-state snapshot', {
        expected: desiredStateHash,
        actual: artifacts.lock.desiredStateHash,
      });
    }
    assertSelectedLockIntegrity(artifacts.lock, desired);
    assertSelectedLockPackageClosure(artifacts.lock, resolved.effectivePackages);
    const result = await this.host.commitGeneration({
      operation: plan.desired.operation,
      expectedBaseGeneration: plan.baseGeneration,
      lock: artifacts.lock,
      desiredState: desired,
      installedIndex: artifacts.installedIndex,
      files: artifacts.files,
    });
    return freeze({ ...result, restartPolicy: RESTART_POLICY });
  }

  async rollback(targetGeneration: number): Promise<{
    readonly pointer: GenerationPointer;
    readonly restartPolicy: ActivationRestartPolicy;
  }> {
    const result = await rollbackGeneration(this.host, targetGeneration);
    return freeze({ pointer: result.pointer, restartPolicy: RESTART_POLICY });
  }
}
