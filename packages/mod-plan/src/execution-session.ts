import type { CesarPlan } from './execution-model.js';
import { createPlanCallbacks } from './execution-callbacks.js';
import type { PlanCallbackHost } from './execution-callbacks.js';
import { createPlanCoordinator } from './execution-coordinator.js';
import type { PlanCoordinatorHost } from './execution-coordinator.js';
import { selectPendingPlan } from './session-selection.js';
import type { PlanSessionSnapshot } from './session-selection.js';
import { evaluatePlanAutoApproval, evaluateAgenticPlanAutoApproval } from './approval-policy.js';
import type { PlanApprovalConfig, PlanApprovalEffects, PlanActionEvaluator } from './approval-policy.js';
import { activatePlanProposal, approvePlanProposal, rejectPlanProposal } from './proposal-workflow.js';
import type { PlanRejectionEffects } from './proposal-workflow.js';
import { runPlanResumeApproval } from './resume-workflow.js';
import type { PlanResumeApprovalEffects } from './resume-workflow.js';

export interface PlanExecutionSessionHost {
  assertAvailable(): void;
  captureAuthority(): () => void;
  snapshot(): PlanSessionSnapshot;
  listSaved(): readonly CesarPlan[];
  approval(): { config: PlanApprovalConfig; agentic: boolean; evaluateAction?: PlanActionEvaluator };
  approvalEffects: PlanApprovalEffects;
  callbacks: PlanCallbackHost;
  coordinator: Omit<PlanCoordinatorHost, 'callbacks'>;
  rejection: PlanRejectionEffects;
  choose: PlanResumeApprovalEffects['choose'];
}

/** Compose Plan policy from raw host effects. Construction performs no effects. */
export function createPlanExecutionSession(host: PlanExecutionSessionHost) {
  const notify = (level: 'info' | 'error' | 'warning', message: string) => host.coordinator.notify(level, message);
  function available(assertCurrent?: () => void): boolean {
    try {
      assertCurrent?.();
      host.assertAvailable();
      return true;
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  const callbacks = (plan: CesarPlan) => createPlanCallbacks(plan, host.callbacks);
  async function invoke(plan: CesarPlan): Promise<boolean> {
    if (!available()) return false;
    await createPlanCoordinator({ ...host.coordinator, callbacks }).executeApprovedPlan(plan);
    return true;
  }
  async function execute(plan: CesarPlan): Promise<void> { await invoke(plan); }
  const pending = () => selectPendingPlan(host.snapshot(), () => host.listSaved());
  return {
    callbacks,
    execute,
    approvePending: () => approvePlanProposal(pending(), execute),
    cancelPending: () => rejectPlanProposal(pending(), host.rejection),
    async resume(plan: CesarPlan): Promise<void> {
      if (!available()) return;
      let assertCurrent: () => void;
      try { assertCurrent = host.captureAuthority(); }
      catch (error) {
        notify('error', error instanceof Error ? error.message : String(error));
        return;
      }
      await runPlanResumeApproval(plan, {
        available: () => available(assertCurrent), notify,
        choose: (prompt, choices, defaultKey) => host.choose(prompt, choices, defaultKey), execute,
      });
    },
    async propose(plan: CesarPlan): Promise<void> {
      await activatePlanProposal(plan, {
        policy: proposed => {
          if (!available()) return { approve: false,
            reason: 'Plan is unavailable in the selected modular generation', adjustedCostUsd: proposed.totalEstimatedCostUsd };
          const approval = host.approval();
          return approval.agentic
            ? evaluateAgenticPlanAutoApproval(proposed, approval.config, host.approvalEffects, approval.evaluateAction)
            : evaluatePlanAutoApproval(proposed, approval.config, host.approvalEffects);
        },
        notify, execute: invoke,
        setActive: value => host.coordinator.setActivePlan(value),
        clearProposal: id => host.coordinator.clearProposal?.(id),
      });
    },
  };
}
