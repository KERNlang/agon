import type { CesarPlan } from './execution-model.js';
import { cancelCesarPlan, createPlanProposal } from './execution-state.js';
import { formatCesarPlanMarkdown } from './formatter.js';
import { createPlanStepSanitizer } from './step-validation.js';
import type { PlanStepEstimator } from './step-validation.js';

export interface PlanProposalPublicationEffects {
  estimator: PlanStepEstimator;
  agenticAutoMode(): boolean;
  markdownPath(id: string): string;
  writeMarkdown(path: string, markdown: string): void;
  persist(plan: CesarPlan): void;
  proposed(): CesarPlan | undefined;
  active(): CesarPlan | null | undefined;
  clearProposal(): void;
  notify(message: string): void;
  publish(plan: CesarPlan, markdown: string, path: string): void;
}

/** Persist the replacement before retiring any existing approval opportunity. */
export function publishPlanProposal(args: Record<string, unknown>, host: PlanProposalPublicationEffects): CesarPlan {
  const { steps, dropped } = createPlanStepSanitizer(host.estimator)(args.steps);
  if (dropped > 0) host.notify(`Dropped ${dropped} malformed plan step${dropped === 1 ? '' : 's'} from the proposal.`);
  let plan = createPlanProposal(typeof args.intent === 'string' ? args.intent : '', steps);
  plan = { ...plan,
    autoApprove: host.agenticAutoMode() || args.autoApprove === true ? true : undefined,
    selfReview: typeof args.selfReview === 'boolean' ? args.selfReview : undefined };
  const path = host.markdownPath(plan.id);
  plan = { ...plan, planFilePath: path };
  const markdown = formatCesarPlanMarkdown(plan);
  host.writeMarkdown(path, markdown);
  host.persist(plan);

  for (const prior of [host.proposed(), host.active()]) {
    if (prior?.state === 'awaiting_approval' && prior.id !== plan.id) {
      try { host.persist(cancelCesarPlan(prior)); } catch { /* legacy best-effort supersede cleanup */ }
    }
  }
  const proposed = host.proposed();
  if (proposed?.state === 'awaiting_approval' && proposed.id !== plan.id) host.clearProposal();
  host.publish(plan, markdown, path);
  return plan;
}

export interface PlanRejectionEffects {
  clearProposal(id: string): void;
  setActive(plan: null): void;
  persist(plan: CesarPlan): void;
  writeMarkdown(plan: CesarPlan): void;
  cancelled(plan: CesarPlan): void;
  notify(message: string): void;
  recordRejection(message: string): void;
  warn(message: string): void;
}

/** Preserve the visible rejection even if a best-effort persistence effect fails. */
export function rejectPlanProposal(pending: CesarPlan | null, host: PlanRejectionEffects): boolean {
  if (!pending) return false;
  host.clearProposal(pending.id);
  const cancelled = cancelCesarPlan(pending);
  host.setActive(null);
  try { host.persist(cancelled); }
  catch (error) { host.warn(`[plan] failed to persist cancelled Cesar plan: ${(error as Error).message ?? error}`); }
  if (cancelled.planFilePath) {
    try { host.writeMarkdown(cancelled); }
    catch (error) { host.warn(`[plan] failed to write cancelled Cesar plan file: ${(error as Error).message ?? error}`); }
  }
  host.cancelled(cancelled);
  host.notify(`Plan rejected — ${cancelled.intent} (${cancelled.id}) cancelled.`);
  try {
    host.recordRejection(`[plan rejected] I rejected the proposed plan "${cancelled.intent}" (${cancelled.id}). Do not re-propose that same plan — ask what should change, or act on my next instruction.`);
  } catch (error) {
    host.warn(`[plan] failed to record plan rejection in the chat session: ${(error as Error).message ?? error}`);
  }
  return true;
}
