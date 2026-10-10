import type { CesarPlan } from './execution-model.js';
import { buildResumePromptContext, prepareCesarPlanResume } from './resume-policy.js';

export interface PlanResumeApprovalEffects {
  available(): boolean;
  notify(level: 'info' | 'error', message: string): void;
  choose(prompt: string, choices: { key: string; label: string; color: string }[], defaultKey: string): Promise<string>;
  execute(plan: CesarPlan): Promise<unknown>;
}

/** Approval is valid only while the selected host generation remains available. */
export async function runPlanResumeApproval(plan: CesarPlan, host: PlanResumeApprovalEffects): Promise<void> {
  if (!host.available()) return;
  const ctx = buildResumePromptContext(plan);
  const lines = [
    `Resume plan: ${plan.intent}`,
    `${ctx.doneCount}/${plan.steps.length} steps completed · ${ctx.remainingCount} remaining`,
  ];
  if (ctx.failedCount > 0 && ctx.failedStep) {
    lines.push(`Failed step: ${ctx.failedStep.description}${ctx.failedStep.result?.error ? ` — ${ctx.failedStep.result.error}` : ''}`);
  }
  if (ctx.remainingCostUsd > 0) {
    lines.push(`Estimated cost to finish: ~${ctx.remainingTokens.toLocaleString()} tokens · $${ctx.remainingCostUsd.toFixed(2)}`);
  }
  host.notify('info', lines.join('\n'));

  const answer = await host.choose('Resume this plan?', [
    { key: '1', label: 'Resume — continue from where it stopped', color: '#4ade80' },
    { key: '2', label: 'Restart — rerun all steps from the beginning', color: '#fbbf24' },
    { key: '3', label: 'Cancel — keep the plan paused', color: '#ef4444' },
  ], '1');
  const trimmed = answer.trim().toLowerCase();

  // The choice UI resolves Enter to its selected key. An empty or unexpected
  // response is not permission to resume (it can also come from dismissal).
  if (!['1', 'resume', '2', 'r', 'restart'].includes(trimmed)) {
    host.notify('info', 'Plan resume cancelled.');
    return;
  }
  // The operator can change the modular generation while this prompt is open.
  // A prior approval surface check cannot authorize execution in a stale host.
  if (!host.available()) return;

  const restart = trimmed === '2' || trimmed === 'r' || trimmed === 'restart';
  let runningPlan: CesarPlan;
  try {
    runningPlan = prepareCesarPlanResume(plan, restart ? 'restart' : 'resume');
  } catch (error) {
    host.notify('error', error instanceof Error ? error.message : String(error));
    return;
  }
  if (restart) {
    host.notify('info', `Restarting plan from step 1: ${plan.intent}`);
  } else {
    host.notify('info', `Resuming plan: ${plan.intent} (${plan.id})`);
  }

  await host.execute(runningPlan);
}
