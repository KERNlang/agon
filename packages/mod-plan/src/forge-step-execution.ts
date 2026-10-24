import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { CesarStepResult } from './execution-model.js';
import type { StepExecutor } from './executor.js';
import { buildPlanStepContext, resolvePlanStepEngines } from './panel-step-execution.js';

export interface PlanForgeProgress {
  id: string; status: string; elapsed: number; done: boolean; failed: boolean; score?: string;
}
export type PlanForgeUiEvent = { type: 'info' | 'warning'; message: string }
  | { type: 'progress-update'; engines: PlanForgeProgress[] } | { type: 'progress-clear' };
export type PlanForgeDispatch = (event: PlanForgeUiEvent) => void;

/** UI delivery is best effort. It must not replace the execution result. */
export function withPlanStepUiDiagnostics<E extends { type: string }>(dispatch: ((event: E) => void) | undefined): ((event: E) => void) | undefined {
  if (!dispatch) return undefined;
  return event => {
    try { dispatch(event); }
    catch { console.warn(`[agon:plan] UI event ${event.type} could not be delivered`); }
  };
}
export interface PlanForgeEvent { type: string; engineId?: string; data?: Record<string, unknown> }
export interface PlanForgeResult {
  pass: boolean; score?: number; diffLines?: number; filesChanged?: number; fitnessLogPath?: string; dispatchStdout?: string;
}
export interface PlanForgeManifest {
  winner: string | null; patches?: Record<string, string>; results?: Record<string, PlanForgeResult>;
  baselinePasses?: boolean; alreadySatisfied?: boolean; error?: string;
}
export interface PlanForgeHost {
  cwd: string;
  outputDir: string;
  assertAvailable(type: 'forge' | 'teamforge', signal?: AbortSignal): void;
  snapshot(): { tokens: number; cost: number };
  getDispatch(): PlanForgeDispatch | undefined;
  activeEngines?(): string[];
  mkdir(path: string): void;
  readPatch(path: string): { content: string } | null | undefined;
  applyPatch(cwd: string, content: string): { ok: boolean; error?: string };
  run(options: { task: string; fitnessCmd: string; cwd: string; forgeDir: string; engines?: string[]; hardened?: boolean; signal?: AbortSignal },
    onEvent: ((event: PlanForgeEvent) => void) | undefined, owner: 'forge' | 'teamforge'): Promise<PlanForgeManifest>;
}

export const emitPlanForgeProgress = (dispatch: PlanForgeDispatch | undefined, engines: string[] | undefined, engineStatus: Record<string,string>, startTime: number) => {
  if (!dispatch || !engines || engines.length === 0) return;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const progress: PlanForgeProgress[] = engines.map((id: string) => {
    const status = engineStatus[id] ?? 'preparing';
    return {
      id,
      status: status === 'done' ? `done (${engineStatus[`${id}:score`] ?? '?'})` : status,
      elapsed,
      done: status === 'done',
      failed: status === 'failed',
      score: engineStatus[`${id}:score`],
    };
  });
  dispatch({ type: 'progress-update', engines: progress });
};

export const notePlanForgeEvent = (event: PlanForgeEvent, dispatch: PlanForgeDispatch | undefined, engines: string[] | undefined, engineStatus: Record<string,string>, startTime: number) => {
  const id = String(event?.engineId ?? event?.data?.engineId ?? '');
  switch (event?.type) {
    case 'baseline:start':
      dispatch?.({ type: 'info', message: 'Forge baseline check...' });
      break;
    case 'baseline:done':
      if (event.data?.passes) dispatch?.({ type: 'warning', message: 'Baseline passes - fitness test may be non-discriminating' });
      break;
    case 'stage1:dispatch':
    case 'stage2:dispatch':
      if (id) engineStatus[id] = 'building';
      break;
    case 'engine:worktree':
      if (id) {
        engineStatus[id] = 'building';
        const worktreePath = String(event.data?.worktreePath ?? '');
        if (worktreePath && engineStatus[`${id}:worktree`] !== worktreePath) {
          engineStatus[`${id}:worktree`] = worktreePath;
          dispatch?.({ type: 'info', message: `Forge worktree ${id}: ${worktreePath}` });
        }
      }
      break;
    case 'engine:failed':
      if (id) {
        engineStatus[id] = 'failed';
        engineStatus[`${id}:score`] = '0';
        engineStatus[`${id}:error`] = String(event.data?.error ?? 'failed');
      }
      break;
    case 'stage1:accepted':
    case 'stage1:score':
    case 'stage2:score':
      if (id) {
        const passed = event.data?.pass !== false;
        engineStatus[id] = passed ? 'done' : 'failed';
        engineStatus[`${id}:score`] = String(event.data?.score ?? '?');
        if (!passed) engineStatus[`${id}:error`] = Number(event.data?.score ?? 0) === 0 ? 'no candidate changes or fitness failed' : 'fitness failed';
      }
      break;
    case 'winner:determined':
      if (event.data?.winner) {
        const winner = String(event.data.winner);
        engineStatus[winner] = 'done';
        engineStatus[`${winner}:score`] = String(event.data?.bestScore ?? engineStatus[`${winner}:score`] ?? '?');
        dispatch?.({ type: 'info', message: `Forge winner: ${winner}` });
      }
      break;
    case 'synthesis:start':
      dispatch?.({ type: 'info', message: 'Forge synthesis...' });
      break;
  }
  emitPlanForgeProgress(dispatch, engines, engineStatus, startTime);
};

export const startPlanForgeProgress = (dispatch: PlanForgeDispatch | undefined, engines: string[] | undefined, engineStatus: Record<string,string>, startTime: number): ReturnType<typeof setInterval> | null => {
  if (!dispatch || !engines || engines.length === 0) return null;
  dispatch({ type: 'info', message: `Forge engines: ${engines.join(', ')}` });
  emitPlanForgeProgress(dispatch, engines, engineStatus, startTime);
  return setInterval(() => emitPlanForgeProgress(dispatch, engines, engineStatus, startTime), 500);
};

export function applyPlanForgeWinner(host: Pick<PlanForgeHost, 'cwd' | 'readPatch' | 'applyPatch'>,
  manifest: PlanForgeManifest, assertCurrentAuthority: () => void): { ok: boolean; error?: string; artifact?: CesarStepResult['artifact'] } {
  assertCurrentAuthority();
  if (!manifest.winner) return isAlreadySatisfiedNoopForge(manifest)
    ? { ok: true, artifact: { status: 'not-needed', cwd: resolve(host.cwd), reason: 'already-satisfied' } }
    : { ok: false, error: 'No winner' };
  const patchPath: string | undefined = manifest.patches?.[manifest.winner];
  if (!patchPath) return { ok: false, error: `Winner ${manifest.winner} has no patchPath in manifest` };
  const patch = host.readPatch(patchPath);
  // A host callback can revoke authority even without an async boundary.
  assertCurrentAuthority();
  if (!patch) return { ok: false, error: `Failed to read patch at ${patchPath}` };
  const content = patch.content;
  const cwd = resolve(host.cwd);
  if (!content || content.trim().length === 0) {
    // Winner produced an empty diff — not an error, just nothing to apply.
    return { ok: true, artifact: { status: 'not-needed', cwd, reason: 'empty-patch' } };
  }
  const applied = host.applyPatch(host.cwd, content);
  return applied.ok ? { ...applied, artifact: { status: 'applied', cwd, patchPath,
    patchHash: `sha256:${createHash('sha256').update(content).digest('hex')}` } } : applied;
}

export const isAlreadySatisfiedNoopForge = (manifest: PlanForgeManifest): boolean => {
  // Forge reports a passing baseline or an all-no-change competition.
  if (manifest?.alreadySatisfied) return true;
  if (!manifest?.baselinePasses) return false;
  const results = Object.values(manifest.results ?? {});
  if (results.length === 0) return false;
  return results.every((r) => {
    if (!r) return false;
    const hasFitnessLog = typeof r.fitnessLogPath === 'string' && r.fitnessLogPath.length > 0;
    const noPatch = Number(r.diffLines ?? 0) === 0 && Number(r.filesChanged ?? 0) === 0;
    const zeroScore = Number(r.score ?? 0) === 0;
    const notDispatchCrash = !String(r.dispatchStdout ?? '').startsWith('ERROR:');
    return r.pass === false && hasFitnessLog && noPatch && zeroScore && notDispatchCrash;
  });
};

export function createForgeStepExecutors(host: PlanForgeHost): Record<'forge' | 'teamforge', StepExecutor> {
  const assertCurrentAuthority = (type: 'forge' | 'teamforge', signal?: AbortSignal): void => {
    signal?.throwIfAborted();
    host.assertAvailable(type, signal);
  };
  const wrap = (type: 'forge' | 'teamforge', execute: StepExecutor['execute']): StepExecutor => ({
    async execute(step, context, signal) {
      assertCurrentAuthority(type, signal);
      return execute(step, context, signal);
    },
  });
  
  return {
    forge: wrap('forge', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      const task = buildPlanStepContext(step, context);
      const engines = resolvePlanStepEngines(step, () => host.activeEngines?.() ?? []);
      const dispatch = withPlanStepUiDiagnostics(host.getDispatch());
      const engineStatus: Record<string,string> = {};
      let progressInterval: ReturnType<typeof setInterval> | null = null;
      try {
        const stepForgeDir = join(host.outputDir, step.id);
        host.mkdir(stepForgeDir);
        dispatch?.({ type: 'info', message: `Forge run dir: ${stepForgeDir}` });
        progressInterval = startPlanForgeProgress(dispatch, engines, engineStatus, startTime);
        assertCurrentAuthority('forge', signal);
        const manifest = await host.run(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd: host.cwd, forgeDir: stepForgeDir, engines, signal },
          dispatch && engines ? (event: PlanForgeEvent) => notePlanForgeEvent(event, dispatch, engines, engineStatus, startTime) : undefined,
          'forge',
        );
        assertCurrentAuthority('forge', signal);
        const after = host.snapshot();
  
        if (!manifest.winner) {
          const engineSummaries = Object.entries(manifest.results ?? {}).map(([id, r]) => {
            return `  ${id}: ${r.pass ? 'PASS' : 'FAIL'} (score: ${r.score ?? 'N/A'}, ${r.diffLines ?? 0} lines)`;
          }).join('\n');
          if (isAlreadySatisfiedNoopForge(manifest)) {
            const message = `Already satisfied: baseline fitness passed and all forge candidates left a clean worktree.\n${engineSummaries}`;
            return {
              result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: message,
                artifact: { status: 'not-needed', cwd: resolve(host.cwd), reason: 'already-satisfied' } },
              contextExport: 'Forge step already satisfied; no patch needed.',
            };
          }
          // Surface manifest.error (preflight/availability/execution failure
          // from the new never-throws contract) so the user sees the actual
          // cause instead of a generic "No winner" — which is misleading
          // when forge couldn't even dispatch (e.g. "No available engines").
          const errorReason = manifest.error
            ? `Forge error: ${manifest.error}`
            : 'No winner';
          const output = manifest.error
            ? `${errorReason}\n${engineSummaries}`
            : `No winner.\n${engineSummaries}`;
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output, error: errorReason },
          };
        }
  
        // FU-9: apply the winning patch to cwd so downstream review/
        // verify steps see real changes. Failure to apply = step failure.
        const applied = applyPlanForgeWinner(host, manifest, () => assertCurrentAuthority('forge', signal));
        if (!applied.ok) {
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner ${manifest.winner} but patch apply failed: ${applied.error}`, error: `patch apply failed: ${applied.error}` },
          };
        }
  
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner: ${manifest.winner} (patch applied to cwd)`, artifact: applied.artifact },
          contextExport: `Forge winner: ${manifest.winner}`,
        };
      } catch (err) {
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      } finally {
        if (progressInterval) clearInterval(progressInterval);
        dispatch?.({ type: 'progress-clear' });
      }
    }),
  
    teamforge: wrap('teamforge', async (step, context, signal) => {
      const startTime = Date.now();
      const before = host.snapshot();
      const task = buildPlanStepContext(step, context);
      const engines = resolvePlanStepEngines(step, () => host.activeEngines?.() ?? []);
      const dispatch = withPlanStepUiDiagnostics(host.getDispatch());
      const engineStatus: Record<string,string> = {};
      let progressInterval: ReturnType<typeof setInterval> | null = null;
      try {
        const stepForgeDir = join(host.outputDir, step.id);
        host.mkdir(stepForgeDir);
        dispatch?.({ type: 'info', message: `Team forge run dir: ${stepForgeDir}` });
        progressInterval = startPlanForgeProgress(dispatch, engines, engineStatus, startTime);
        assertCurrentAuthority('teamforge', signal);
        const manifest = await host.run(
          { task, fitnessCmd: step.fitnessCmd ?? 'echo "no fitness"', cwd: host.cwd, forgeDir: stepForgeDir, engines, hardened: true, signal },
          dispatch && engines ? (event: PlanForgeEvent) => notePlanForgeEvent(event, dispatch, engines, engineStatus, startTime) : undefined,
          'teamforge',
        );
        assertCurrentAuthority('teamforge', signal);
        const after = host.snapshot();
        if (!manifest.winner) {
          if (isAlreadySatisfiedNoopForge(manifest)) {
            return {
              result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: 'Already satisfied: baseline fitness passed and all team-forge candidates left a clean worktree.',
                artifact: { status: 'not-needed', cwd: resolve(host.cwd), reason: 'already-satisfied' } },
              contextExport: 'TeamForge step already satisfied; no patch needed.',
            };
          }
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: 'No winner' },
          };
        }
        // FU-9: apply winning patch to cwd.
        const applied = applyPlanForgeWinner(host, manifest, () => assertCurrentAuthority('teamforge', signal));
        if (!applied.ok) {
          return {
            result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner ${manifest.winner} but patch apply failed: ${applied.error}`, error: `patch apply failed: ${applied.error}` },
          };
        }
        return {
          result: { status: 'success', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: `Winner: ${manifest.winner} (patch applied to cwd)`, artifact: applied.artifact },
          contextExport: `TeamForge winner: ${manifest.winner}`,
        };
      } catch (err) {
        const after = host.snapshot();
        return { result: { status: 'failure', actualTokens: after.tokens - before.tokens, actualCostUsd: after.cost - before.cost, durationMs: Date.now() - startTime, output: '', error: err instanceof Error ? err.message : String(err) } };
      } finally {
        if (progressInterval) clearInterval(progressInterval);
        dispatch?.({ type: 'progress-clear' });
      }
    }),
  
  };
}
