import type { Awaitable, CommandResult, InvocationContext, Json, ModServices, PlanSessionRequest } from '@kernlang/agon-mod-api';

export interface PlanSessionDispatchResult {
  readonly handled: boolean;
  readonly ranAsJob: boolean;
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
