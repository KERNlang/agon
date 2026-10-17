import type { Awaitable, CommandResult, InvocationContext, Json, ModServices, PlanSessionRequest } from '@kernlang/agon-mod-api';
import { showWorktreePlan, listWorktreePlans, approveWorktreePlan, retryWorktreePlan, cancelWorktreePlan } from './worktree-workflow.js';
import type { WorktreePlanHost } from './worktree-workflow.js';
import { startPlanTaskSession, resumePlanSession } from './session-workflow.js';
import type { PlanTaskSessionEffects, PlanResumeSessionEffects } from './session-workflow.js';
import { shouldApprovePendingCesarPlanInput, selectResumablePlan, isCesarPlanResumeInput,
  isCesarPlanStatusInput, formatCesarPlanRuntimeStatus } from './session-selection.js';
import type { PlanSessionSnapshot } from './session-selection.js';
import type { CesarPlan } from './execution-model.js';

export interface PlanSessionDispatchResult {
  readonly handled: boolean;
  readonly ranAsJob: boolean;
}

export interface PlanNaturalInputEffects {
  snapshot(): PlanSessionSnapshot;
  assertAvailable(action: '/approve' | '/plan'): void;
  approve(): Promise<boolean>;
  resume(plan: CesarPlan): Promise<void>;
  notify(level: 'info' | 'error', message: string): void;
}

/** Natural replies use the same approval authority as explicit commands. */
export async function dispatchPlanNaturalInput(input: string, host: PlanNaturalInputEffects): Promise<boolean> {
  const approvePending = shouldApprovePendingCesarPlanInput(input, host.snapshot());
  const resumablePlan = selectResumablePlan(host.snapshot());
  const resumePending = resumablePlan !== null && isCesarPlanResumeInput(input);
  if (approvePending || resumePending) {
    try { host.assertAvailable(approvePending ? '/approve' : '/plan'); }
    catch (error) {
      host.notify('error', error instanceof Error ? error.message : String(error));
      return true;
    }
  }
  if (approvePending && await host.approve()) return true;
  if (resumablePlan && resumePending) {
    await host.resume(resumablePlan);
    return true;
  }
  if (resumablePlan && isCesarPlanStatusInput(input)) {
    host.notify('info', formatCesarPlanRuntimeStatus(resumablePlan));
    return true;
  }
  return false;
}

/** Auto emits its own tail event; background tasks have no synchronous tail. */
export function shouldEmitPlanPostDispatch(request: PlanSessionRequest, result: PlanSessionDispatchResult | null): boolean {
  return request.type !== 'auto' && result?.handled === true && !result.ranAsJob;
}

/** Host actions supply UI effects. This owner selects action order and fallback. */
export interface PlanSessionActions {
  show(planId?: string): Awaitable<void>;
  task(task: string): Awaitable<{ readonly handled: true; readonly ranAsJob?: true }>;
  resume(planId?: string): Awaitable<void>;
  list(): void;
  approvePending(): Promise<boolean>;
  approveLegacy(): Promise<void>;
  retry(): Promise<void>;
  cancelPending(): boolean;
  cancelLegacy(): void;
  auto(request: Extract<PlanSessionRequest, { type: 'auto' }>): Promise<PlanSessionDispatchResult | null>;
}

export interface PlanSessionEffects extends Pick<PlanSessionActions, 'approvePending' | 'cancelPending' | 'auto'> {
  worktree(): WorktreePlanHost;
  taskSession: PlanTaskSessionEffects;
  resumeSession: PlanResumeSessionEffects;
}

/** Compose the existing workflows without importing host command handlers. */
export function createPlanSessionActions(host: PlanSessionEffects): PlanSessionActions {
  return {
    show: planId => showWorktreePlan(host.worktree(), planId),
    list: () => listWorktreePlans(host.worktree()),
    approveLegacy: () => approveWorktreePlan(host.worktree()),
    retry: () => retryWorktreePlan(host.worktree()),
    cancelLegacy: () => cancelWorktreePlan(host.worktree()),
    task: task => startPlanTaskSession(task, host.taskSession),
    resume: planId => resumePlanSession(planId, host.resumeSession),
    approvePending: () => host.approvePending(),
    cancelPending: () => host.cancelPending(),
    auto: request => host.auto(request),
  };
}

/** Both generated contributions and legacy-shaped requests use this owner. */
export async function dispatchPlanSession(request: PlanSessionRequest, host: PlanSessionActions): Promise<PlanSessionDispatchResult | null> {
  switch (request.type) {
    case 'plan': await host.show(request.planId); break;
    case 'plan-task': {
      const result = await host.task(request.task);
      if (result.ranAsJob) return { handled: true, ranAsJob: true };
      break;
    }
    case 'plan-resume': await host.resume(request.planId); break;
    case 'plans': host.list(); break;
    case 'approve': if (!await host.approvePending()) await host.approveLegacy(); break;
    case 'retry': await host.retry(); break;
    case 'cancel': if (!host.cancelPending()) host.cancelLegacy(); break;
    case 'auto': return host.auto(request);
    default: return null;
  }
  return { handled: true, ranAsJob: false };
}

/** Interactive controls must not fall back to editing the most recent disk record. */
export async function runPlanSession(action: string, raw: Json, services: ModServices, context: InvocationContext): Promise<CommandResult> {
  context.signal.throwIfAborted();
  if (!services.planSession) return { exitCode: 2, stderr: 'No interactive Plan session is available.\n' };
  const input = raw as Record<string, Json>;
  let request: PlanSessionRequest;
  if (action === 'plan') {
    if (input.type === 'plan-task') {
      if (typeof input.task !== 'string' || !input.task.trim()) return { exitCode: 2, stderr: 'A Plan task is required.\n' };
      request = { type: 'plan-task', task: input.task };
    } else {
      request = { type: input.type === 'plan-resume' ? 'plan-resume' : 'plan',
        ...(typeof input.planId === 'string' && input.planId.trim() ? { planId: input.planId.trim() } : {}) };
    }
  } else if (action === 'auto') {
    request = { type: 'auto', input: typeof input.input === 'string' ? input.input : '', autoMode: true };
  } else if (action === 'plans' || action === 'approve' || action === 'retry' || action === 'cancel') {
    request = { type: action };
  } else return { exitCode: 2, stderr: `Unknown Plan session action: ${action}\n` };
  return services.planSession.run(request, context);
}
