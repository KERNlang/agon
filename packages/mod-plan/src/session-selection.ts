import type { CesarPlan } from './execution-model.js';

/** Only session selection data crosses this boundary, never a CLI context. */
export interface PlanSessionSnapshot {
  readonly proposedPlan?: CesarPlan | null;
  readonly activePlan?: CesarPlan | null;
}

/**
 * Return true for natural approval replies users type after Cesar says go/run it.
 */
export function isCesarPlanApprovalInput(input: string): boolean {
  const text = String(input ?? '').trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/[ \t\n\r\f\v]+/g, ' ');
  return /^(?:y|yes|yes go|yes please|go|go ahead|ok go|okay go|ok do it|okay do it|ok do so|okay do so|run|run it|start|start it|approve|approved|do it|do so|proceed|execute|ok|okay|sure)$/i.test(text);
}

/**
 * Return true for approval phrases strong enough to recover a saved pending plan even when no plan panel is active.
 */
export function isStrongCesarPlanApprovalInput(input: string): boolean {
  const text = String(input ?? '').trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/[ \t\n\r\f\v]+/g, ' ');
  return /^(?:yes go|go|go ahead|ok go|okay go|ok do it|okay do it|ok do so|okay do so|run|run it|start|start it|approve|approved|do it|do so|proceed|execute)$/i.test(text);
}

/**
 * Find the most relevant pending Cesar plan: proposed plan first, active plan second, then latest saved awaiting_approval plan.
 */
export function selectPendingPlan(session: PlanSessionSnapshot, listSavedPlans: () => readonly CesarPlan[]): CesarPlan | null {
  const proposed = session.proposedPlan;
  if (proposed && proposed.state === 'awaiting_approval') {
    return proposed;
  }
  const active = session.activePlan;
  if (active && active.state === 'awaiting_approval') {
    return active;
  }
  const saved = listSavedPlans().filter(p => p.state === 'awaiting_approval').sort((a: CesarPlan, b: CesarPlan) => b.createdAt.localeCompare(a.createdAt));
  return saved[0] ?? null;
}

/**
 * Return the in-session paused/running plan if any. No disk fallback — stale persisted plans must be resumed explicitly via `/plan resume <id>` so innocuous words like 'go' or 'continue' cannot resurrect them.
 */
export function selectResumablePlan(session: PlanSessionSnapshot): CesarPlan | null {
  const active = session.activePlan;
  if (active && (active.state === 'paused' || active.state === 'running')) {
    return active;
  }
  return null;
}

/**
 * Treat natural approval text as /approve only when a live pending plan is visible in this session.
 */
export function shouldApprovePendingCesarPlanInput(input: string, session: PlanSessionSnapshot): boolean {
  const text = String(input ?? '').trim();
  if (!text || text.startsWith('/')) {
    return false;
  }
  const proposed = session.proposedPlan;
  const active = session.activePlan;
  const hasLivePending = proposed && proposed.state === 'awaiting_approval' || active && active.state === 'awaiting_approval';
  return !(!hasLivePending) && isCesarPlanApprovalInput(text);
}

/**
 * Return true when the user is clearly telling a paused/running plan to continue.
 */
export function isCesarPlanResumeInput(input: string): boolean {
  const text = String(input ?? '').trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/[ \t\n\r\f\v]+/g, ' ');
  return /^(?:go|run|resume|continue|proceed|start)(?:\b|$)/i.test(text) || /^(?:do it|do so|keep going|carry on|ok do last part|do last part|last part)$/i.test(text);
}

/**
 * Return true for short status checks that should be answered from plan state instead of routed to Cesar chat.
 */
export function isCesarPlanStatusInput(input: string): boolean {
  const text = String(input ?? '').trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/[ \t\n\r\f\v]+/g, ' ');
  return /^(?:done|done yet|status|progress|what happened|what went wrong|what did you do|what yu do|what you do|why stop|why stopped|why did it stop|are you doing something|are you still working|still working|is it running|where are we)$/i.test(text);
}

/**
 * Render a concise persisted plan status so Cesar chat cannot hallucinate whether a plan is running.
 */
export function formatCesarPlanRuntimeStatus(plan: CesarPlan): string {
  const total = plan.steps.length;
  const done = plan.steps.filter(s => s.state === 'done').length;
  const failed = plan.steps.find(s => s.state === 'failed');
  const current = plan.steps.find(s => s.state === 'running') ?? plan.steps.find(s => s.state === 'pending') ?? plan.steps.find(s => s.state === 'blocked');
  const lines = [`Plan ${plan.id.slice(0, 12)} is ${plan.state}: ${done}/${total} steps done.`];
  if (current) {
    lines.push(`Next: ${current.description}`);
  }
  if (failed) {
    lines.push(`Blocked: ${failed.description}${failed.result?.error ? ` — ${failed.result.error}` : ''}`);
  }
  if (plan.state === 'paused' || plan.state === 'running') {
    lines.push('Use /plan resume or say "go" to continue it.');
  }
  return lines.join('\n');
}
