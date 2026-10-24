import type { StepExecutor } from './executor.js';
import { createAgentReviewStepExecutors } from './agent-review-step-execution.js';
import type { PlanAgentReviewHost } from './agent-review-step-execution.js';
import { createPanelStepExecutors } from './panel-step-execution.js';
import type { PlanPanelStepHost } from './panel-step-execution.js';
import { createForgeStepExecutors } from './forge-step-execution.js';
import type { PlanForgeHost } from './forge-step-execution.js';
import { createPipelineStepExecutor } from './pipeline-step-execution.js';
import type { PlanPipelineHost, PlanPipelineRun, PlanPipelineIssue } from './pipeline-step-execution.js';
import { createSelfStepExecutor } from './self-step-execution.js';
import type { PlanSelfStepHost, PlanSelfEvent } from './self-step-execution.js';

export interface PlanStepExecutionHost<Event extends PlanSelfEvent, P extends { logicalPlanId: string }, R extends PlanPipelineRun, I extends PlanPipelineIssue> {
  assertAvailable(type: string, signal?: AbortSignal): void;
  withAuthority(
    signal: AbortSignal | undefined,
    assertAvailable: (signal?: AbortSignal) => void,
    run: (signal?: AbortSignal) => ReturnType<StepExecutor['execute']>,
  ): ReturnType<StepExecutor['execute']>;
  agentReview: PlanAgentReviewHost;
  panel: PlanPanelStepHost;
  forge: PlanForgeHost;
  pipeline: PlanPipelineHost<P, R, I>;
  self: PlanSelfStepHost<Event>;
}

/** Plan owns the step catalog. The host supplies effects and generation leases. */
export function createPlanStepExecutors<Event extends PlanSelfEvent, P extends { logicalPlanId: string }, R extends PlanPipelineRun, I extends PlanPipelineIssue>(
  host: PlanStepExecutionHost<Event, P, R, I>,
): Record<string, StepExecutor> {
  const wrap = (type: string, fn: StepExecutor['execute']): StepExecutor => ({
    execute: async (step, context, signal) => {
      host.assertAvailable(type, signal);
      return host.withAuthority(signal,
        childSignal => host.assertAvailable(type, childSignal),
        childSignal => fn(step, context, childSignal));
    },
  });
  const agentReview = createAgentReviewStepExecutors(host.agentReview);
  const panel = createPanelStepExecutors(host.panel);
  const forge = createForgeStepExecutors(host.forge);
  const pipeline = createPipelineStepExecutor(host.pipeline);
  return {
    self: wrap('self', createSelfStepExecutor(host.self).execute),
    ...Object.fromEntries(Object.entries(forge).map(([type, executor]) => [type, wrap(type, executor.execute)])),
    ...Object.fromEntries(Object.entries(panel).map(([type, executor]) => [type, wrap(type, executor.execute)])),
    pipeline: wrap('pipeline', pipeline.execute),
    review: wrap('review', agentReview.review.execute),
    agent: wrap('agent', agentReview.agent.execute),
    'team-agent': wrap('team-agent', agentReview['team-agent'].execute),
  };
}
