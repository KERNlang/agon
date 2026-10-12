import { approvePlan, startPlan, cancelPlan, resetStepForRetry } from '@kernlang/agon-support-worktree';
import type { Plan, WorktreePlanRuntime } from '@kernlang/agon-support-worktree';
import { isExplicitApproval } from '@kernlang/agon-support-verification';

export type WorktreePlanEvent =
  | { type: 'warning' | 'info' | 'success'; message: string }
  | { type: 'plan'; plan: Plan }
  | { type: 'plan-list'; plans: Plan[] };

/** The host supplies session access and effects, not approval or retry policy. */
export interface WorktreePlanHost {
  current(): Plan | null;
  setCurrent(plan: Plan): void;
  load(id: string): Plan | null;
  list(limit: number): Plan[];
  save(plan: Plan): void;
  emit(event: WorktreePlanEvent): void;
  ask(question: string): Promise<string>;
  forge(plan: Plan): Promise<void>;
  readonly stateRuntime?: WorktreePlanRuntime;
}

export async function showWorktreePlan(host: WorktreePlanHost, planId?: string): Promise<void> {
  let plan: Plan | null = null;

  if (planId) {
    plan = host.load(planId);
    if (!plan) {
      host.emit({ type: 'warning', message: `Plan not found: ${planId}` });
      return;
    }
  } else {
    plan = host.current();
    if (!plan) {
      const recent = host.list(1);
      if (recent.length > 0) {
        plan = recent[0];
      } else {
        host.emit({ type: 'info', message: 'No plans yet. Run /forge or build to create one.' });
        return;
      }
    }
  }

  host.emit({ type: 'plan', plan });

  // Ask for approval only for a draft.
  if (plan.state === 'draft') {
    if (host.current() !== plan) host.setCurrent(plan);
    const answer = (await host.ask('Approve plan? Type y or yes to approve.')).trim();
    if (host.current() !== plan || plan.state !== 'draft') {
      host.emit({ type: 'info', message: 'Plan changed while approval was pending. Show the current plan before approving.' });
      return;
    }
    // The question host also returns an empty answer when a permission prompt
    // dismisses this question. Absence of an answer cannot authorize execution.
    if (!answer) {
      host.emit({ type: 'info', message: 'Plan remains draft. Use /approve to approve it explicitly.' });
      return;
    }
    if (!isExplicitApproval(answer)) {
      const cancelled = cancelPlan(plan, host.stateRuntime);
      host.setCurrent(cancelled);
      host.save(cancelled);
      host.emit({ type: 'success', message: 'Plan cancelled.' });
    } else {
      const approved = approvePlan(plan, host.stateRuntime);
      host.setCurrent(approved);
      host.save(approved);
      host.emit({ type: 'success', message: 'Plan approved.' });

      if (approved.action.type === 'forge') {
        await host.forge(approved);
      } else {
        host.emit({ type: 'info', message: 'Run the build again to execute.' });
      }
    }
  }
}

export function listWorktreePlans(host: Pick<WorktreePlanHost, 'list' | 'emit'>): void {
  const plans = host.list(20);
  host.emit({ type: 'plan-list', plans: plans });
}

export async function approveWorktreePlan(host: WorktreePlanHost): Promise<void> {
  const current = host.current();
  if (!current) {
    host.emit({ type: 'warning', message: 'No active plan to approve.' });
    return;
  }
  if (current.state !== 'draft') {
    host.emit({ type: 'warning', message: `Plan is ${current.state}, not draft.` });
    return;
  }

  const plan = approvePlan(current, host.stateRuntime);
  host.setCurrent(plan);
  host.save(plan);
  host.emit({ type: 'success', message: 'Plan approved.' });

  if (plan.action.type === 'forge') {
    await host.forge(plan);
  } else {
    host.emit({ type: 'info', message: 'Run the build again to execute.' });
  }
}

export async function retryWorktreePlan(host: WorktreePlanHost): Promise<void> {
  const current = host.current();
  if (!current) {
    host.emit({ type: 'warning', message: 'No active plan to retry.' });
    return;
  }
  if (current.state !== 'paused' && current.state !== 'failed') {
    host.emit({ type: 'warning', message: `Plan is ${current.state} — only paused/failed plans can be retried.` });
    return;
  }

  const failedStep = current.steps.find((s) => s.result.state === 'failed');
  if (!failedStep) {
    host.emit({ type: 'info', message: 'No failed step found. Re-run the command to restart.' });
    return;
  }

  host.emit({ type: 'info', message: `Retrying from: ${failedStep.label}` });
  let plan = resetStepForRetry(host.current()!, failedStep.id);
  host.setCurrent(plan);
  host.save(plan);

  if (plan.action.type === 'forge') {
    plan = startPlan(plan, host.stateRuntime);
    host.setCurrent(plan);
    host.save(plan);
    await host.forge(plan);
  } else {
    host.emit({ type: 'info', message: 'Plan reset to approved. Run the build again to execute.' });
  }
}

export function cancelWorktreePlan(host: WorktreePlanHost): void {
  const current = host.current();
  if (!current) {
    host.emit({ type: 'warning', message: 'No active plan to cancel.' });
    return;
  }
  if (current.state === 'completed' || current.state === 'cancelled') {
    host.emit({ type: 'warning', message: `Plan already ${current.state}.` });
    return;
  }
  const plan = cancelPlan(current, host.stateRuntime);
  host.setCurrent(plan);
  host.save(plan);
  host.emit({ type: 'success', message: 'Plan cancelled.' });
}
