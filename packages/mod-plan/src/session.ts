import type { CommandResult, InvocationContext, Json, ModServices, PlanSessionRequest } from '@kernlang/agon-mod-api';

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
