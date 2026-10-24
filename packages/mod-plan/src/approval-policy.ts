import type { CesarPlan } from './execution-model.js';

export interface PlanApprovalConfig {
  cesarAutoApproveMode?: string;
  cesarAutoApproveMaxCostUsd?: number | null;
}

export interface PlanApprovalEffects {
  estimateReviewCostUsd(): number;
}

/** The host owns the task lease; Plan supplies each step and shell boundary. */
export type PlanActionEvaluator = (action: string, text: string) => {
  decision: string;
  reason: string;
};

function looseEq(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return a === b;
}

export interface AutoApproveDecision {
  approve: boolean;
  reason: string;
  adjustedCostUsd: number;
}

const mutatingStepTypes: ReadonlySet<string> = new Set(['forge', 'teamforge', 'pipeline', 'agent', 'team-agent', 'delegate', 'self']);

/** Compatibility snapshot. Mutating this set never changes approval authority. */
export const MUTATING_STEP_TYPES: Set<string> = new Set(mutatingStepTypes);

/**
 * Decide whether a plan qualifies for autonomous execution without user confirmation.
 */
export function evaluatePlanAutoApproval(plan: CesarPlan, config: PlanApprovalConfig, effects: PlanApprovalEffects): AutoApproveDecision {
  // An unrecognized mode value must not fall through the whitelist gates
  // (it would behave like 'always' without a ceiling) — clamp to safe-only.
  const rawMode = config.cesarAutoApproveMode ?? 'safe-only';
  const mode = ['off', 'safe-only', 'cost-bounded', 'always'].includes(rawMode) ? rawMode : 'safe-only';
  const maxCostUsd = config.cesarAutoApproveMaxCostUsd;
  // Gate 0: global off switch
  if (mode === 'off') {
    return { approve: false, reason: 'autoApprove disabled (cesarAutoApproveMode=off)', adjustedCostUsd: plan.totalEstimatedCostUsd };
  }
  // Gate 1: plan must opt in
  if (plan.autoApprove !== true) {
    return { approve: false, reason: 'plan did not request autoApprove', adjustedCostUsd: plan.totalEstimatedCostUsd };
  }
  // Gate 2: whitelist floor — safe-only rejects any mutating step type
  const mutatingSteps = plan.steps.filter((s) => mutatingStepTypes.has(s.type));
  if (mode === 'safe-only' && mutatingSteps.length > 0) {
    const types = Array.from(new Set(mutatingSteps.map((s) => s.type))).join(', ');
    return { approve: false, reason: `safe-only mode rejects mutating step types: ${types}`, adjustedCostUsd: plan.totalEstimatedCostUsd };
  }
  // Gate 3: fitnessCmd interlock — shell commands need user inspect
  // unless the user explicitly opted into 'always'
  const fitnessSteps = plan.steps.filter((s) => s.fitnessCmd && s.fitnessCmd.trim().length > 0);
  if (mode !== 'always' && fitnessSteps.length > 0) {
    return { approve: false, reason: `fitnessCmd present in ${fitnessSteps.length} step(s); user must inspect before auto-approve`, adjustedCostUsd: plan.totalEstimatedCostUsd };
  }
  // Gate 4: cost ceiling, with review cycles folded in
  let adjustedCostUsd = plan.totalEstimatedCostUsd;
  const wantsReview = plan.selfReview !== false && mutatingSteps.length > 0;
  if (wantsReview) {
    const reviewEstimate = { costUsd: effects.estimateReviewCostUsd() };
    adjustedCostUsd += 2 * reviewEstimate.costUsd;
  }
  const costCeilingUsd = maxCostUsd ?? adjustedCostUsd;
  if ((mode === 'cost-bounded' || mode === 'always') && !looseEq(maxCostUsd, null)) {
    if (adjustedCostUsd > costCeilingUsd) {
      return { approve: false, reason: `estimated cost $${adjustedCostUsd.toFixed(2)} exceeds ceiling $${costCeilingUsd.toFixed(2)}`, adjustedCostUsd: adjustedCostUsd };
    }
  }
  // cost-bounded with no ceiling configured = same as 'always' but explicit
  return { approve: true, reason: `${mode} policy passed (cost $${adjustedCostUsd.toFixed(4)})`, adjustedCostUsd: adjustedCostUsd };
}

/**
 * Agentic AUTO executes routine plans without a second approval loop, but only after every step passes the same task lease used by direct tools: the step type + full boundary text at the action level, and ONLY the real shell commands (fitnessCmd/verifyCmd, never prose descriptions) through the Bash boundary classifier. Explicit autoApprove=off remains a kill switch.
 */
export function evaluateAgenticPlanAutoApproval(plan: CesarPlan, config: PlanApprovalConfig, effects: PlanApprovalEffects, evaluateAction?: PlanActionEvaluator): AutoApproveDecision {
  if (config.cesarAutoApproveMode === 'off') return evaluatePlanAutoApproval(plan, config, effects);
  if (!evaluateAction) return { approve: false, reason: 'agentic task lease unavailable', adjustedCostUsd: plan.totalEstimatedCostUsd };
  if (plan.autoApprove !== true) return { approve: false, reason: 'plan did not request autoApprove', adjustedCostUsd: plan.totalEstimatedCostUsd };

  for (const step of plan.steps) {
    const boundaryText = [step.description, step.fitnessCmd, step.verifyCmd].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
    const actionDecision = evaluateAction(step.type, boundaryText);
    if (actionDecision.decision !== 'allow') {
      return { approve: false, reason: `step ${step.id} requires boundary approval (${actionDecision.reason})`, adjustedCostUsd: plan.totalEstimatedCostUsd };
    }
    const commandText = [step.fitnessCmd, step.verifyCmd].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
    if (commandText) {
      const commandDecision = evaluateAction('Bash', commandText);
      if (commandDecision.decision !== 'allow') {
        return { approve: false, reason: `step ${step.id} contains an interactive boundary (${commandDecision.reason})`, adjustedCostUsd: plan.totalEstimatedCostUsd };
      }
    }
  }

  const agenticConfig: PlanApprovalConfig = { ...config, cesarAutoApproveMode: 'always' };
  return evaluatePlanAutoApproval(plan, agenticConfig, effects);
}
