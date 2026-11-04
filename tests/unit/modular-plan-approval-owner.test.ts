import { expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import * as physical from '@kernlang/agon-mod-plan';
import type { CesarPlan } from '@kernlang/agon-mod-plan';

const plan: CesarPlan = { id: 'approval', intent: 'change', state: 'awaiting_approval',
  steps: [{ id: 'step', type: 'self', description: 'change', estimatedTokens: 1, estimatedCostUsd: 14 }],
  stepContext: {}, createdAt: '2026-01-01T00:00:00.000Z', autoApprove: true,
  totalEstimatedTokens: 1, totalEstimatedCostUsd: 14, totalActualTokens: 0, totalActualCostUsd: 0 };

it('retires the unused CLI approval adapter', () => {
  expect(existsSync(new URL('../../packages/cli/src/cesar/auto-approve-policy.ts', import.meta.url))).toBe(false);
});

it('does not let callers change approval policy through the exported compatibility set', () => {
  const original = [...physical.MUTATING_STEP_TYPES];
  try {
    physical.MUTATING_STEP_TYPES.clear();
    const effects = { estimateReviewCostUsd: () => 3 };
    expect(physical.evaluatePlanAutoApproval(plan, { cesarAutoApproveMode: 'safe-only' }, effects).approve).toBe(false);
    expect(physical.evaluatePlanAutoApproval(plan, { cesarAutoApproveMode: 'cost-bounded', cesarAutoApproveMaxCostUsd: 19 }, effects).approve).toBe(false);
  } finally {
    physical.MUTATING_STEP_TYPES.clear();
    for (const type of original) physical.MUTATING_STEP_TYPES.add(type);
  }
});

it('adds both review cycles using an injected estimate, without a CLI context', () => {
  const estimateReviewCostUsd = vi.fn(() => 3);
  expect(physical.evaluatePlanAutoApproval(plan, { cesarAutoApproveMode: 'cost-bounded', cesarAutoApproveMaxCostUsd: 19 },
    { estimateReviewCostUsd })).toEqual({ approve: false,
    reason: 'estimated cost $20.00 exceeds ceiling $19.00', adjustedCostUsd: 20 });
  expect(estimateReviewCostUsd).toHaveBeenCalledOnce();
});

it('does not request estimates or action grants when approval is off', () => {
  const estimateReviewCostUsd = vi.fn(() => 3);
  const evaluateAction = vi.fn(() => ({ decision: 'allow', reason: 'fixture' }));
  expect(physical.evaluateAgenticPlanAutoApproval(plan, { cesarAutoApproveMode: 'off' },
    { estimateReviewCostUsd }, evaluateAction).approve).toBe(false);
  expect(estimateReviewCostUsd).not.toHaveBeenCalled();
  expect(evaluateAction).not.toHaveBeenCalled();
});

it('passes only command fields through the shell boundary, not descriptive prose', () => {
  const evaluateAction = vi.fn(() => ({ decision: 'allow', reason: 'fixture' }));
  const proposed: CesarPlan = { ...plan, selfReview: false, steps: [{ ...plan.steps[0],
    description: 'discuss production deletion', fitnessCmd: 'npm test', verifyCmd: 'npm run lint' }] };
  expect(physical.evaluateAgenticPlanAutoApproval(proposed, {}, { estimateReviewCostUsd: () => 0 }, evaluateAction).approve).toBe(true);
  expect(evaluateAction.mock.calls).toEqual([
    ['self', 'discuss production deletion\nnpm test\nnpm run lint'],
    ['Bash', 'npm test\nnpm run lint'],
  ]);
});
