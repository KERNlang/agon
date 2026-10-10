import type { CesarPlan } from './execution-model.js';
import { createCesarPlan, exitCesarPlan } from './execution-state.js';

/** Exit effects are synchronous. Hosts must not return promises. */
export interface PlanExitSessionEffects {
  persist(plan: CesarPlan): void;
  clearProposalAndMarkExited(): void;
  setInactive(): void;
  cancelled?(original: CesarPlan): void;
  notify?(message: string): void;
}

/** Exiting cannot cancel work owned by a live session or another process. */
export function planExitRefusal(current: CesarPlan | null | undefined): string | undefined {
  if (current?.state === 'running') {
    return '[BLOCKED] A plan is currently RUNNING. ExitPlanMode cannot abandon a running plan (it may have in-flight jobs/worktrees). Tell the user to cancel it (type /cancel) or wait for the active step to finish.';
  }
  return undefined;
}

/** Interactive escape hatch; running plans require the owning cancellation flow. */
export function exitPlanSession(reason: string, current: CesarPlan | null | undefined, host: PlanExitSessionEffects): string {
  const text = (reason && reason.trim()) ? reason.trim() : 'no reason given';
  const refusal = planExitRefusal(current);
  if (refusal) return refusal;
  if (current && ['planning', 'awaiting_approval', 'paused'].includes(current.state)) {
    try { host.persist(exitCesarPlan(current, text)); } catch { /* legacy best-effort archive */ }
    host.clearProposalAndMarkExited();
    host.setInactive();
    host.cancelled?.(current);
  }
  host.notify?.(`Left plan mode — ${text}`);
  return `[PLAN_EXITED] Left plan mode (${text}). You are now live: investigate and act directly with tools, or answer the user. Do NOT propose a plan again this turn.`;
}

export interface PlanTaskSessionEffects {
  setActive(plan: CesarPlan | null): void;
  prepare(): void;
  route(input: string): Promise<boolean>;
  proposed(): CesarPlan | undefined;
  acceptProposal(plan: CesarPlan): Promise<void>;
}

/** Plan owns lifecycle decisions; the host supplies router and UI effects. */
export async function startPlanTaskSession(task: string, host: PlanTaskSessionEffects): Promise<{ handled: true; ranAsJob?: true }> {
  host.setActive(createCesarPlan(task, []));
  host.prepare();
  const wasJob = await host.route('[PLAN MODE] ' + task);
  const proposed = host.proposed();
  if (proposed?.state === 'awaiting_approval') {
    await host.acceptProposal(proposed);
  } else if (wasJob) {
    return { handled: true, ranAsJob: true };
  } else {
    host.setActive(null);
  }
  return { handled: true };
}

export interface PlanResumeSessionEffects {
  load(id: string): CesarPlan | null;
  current(): CesarPlan | null;
  resume(plan: CesarPlan): Promise<void>;
  notify(level: 'warning' | 'info', message: string): void;
}

/** No argument selects only session state, never an implicit disk plan. */
export async function resumePlanSession(argument: string | undefined, host: PlanResumeSessionEffects): Promise<void> {
  const explicit = (argument ?? '').trim();
  let plan: CesarPlan | null;
  if (explicit) {
    const tail = explicit.split(/[\\/]/).pop() ?? explicit;
    const id = tail.endsWith('.json') ? tail.slice(0, -5) : tail;
    plan = host.load(id);
    if (!plan) {
      host.notify('warning', 'No plan found for id "' + id + '". Tip: `ls ~/.agon/plans` to list saved plan IDs.');
      return;
    }
  } else {
    plan = host.current();
    if (!plan) {
      host.notify('info', 'No active plan in this session. Pass an ID to resume a saved plan: `/plan resume <plan-id>`.');
      return;
    }
  }
  await host.resume(plan);
}
