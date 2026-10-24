import { describe, expect, it } from 'vitest';
import * as owner from '@kernlang/agon-mod-plan';
import { buildResumePromptContext, skipCompletedSteps } from '@kernlang/agon-mod-plan';
import type { CesarPlan, CesarPlanStep } from '@kernlang/agon-mod-plan';
import * as cliQueries from '../../packages/cli/src/signals/dispatch/plan-queries.js';

function fixture(cycles = 0): CesarPlan {
  const states = ['done', 'skipped', 'failed', 'failed', 'blocked', 'running', 'pending', 'cancelled'] as const;
  const steps: CesarPlanStep[] = states.map((state, index) => ({
    id: `s${index}`, description: `step ${index}`, type: index === 3 ? 'review' : 'self',
    state, estimatedTokens: 10, estimatedCostUsd: 1,
    ...(index === 4 ? { dependsOn: ['s2'] } : {}),
    result: { status: 'failure', actualTokens: 2, actualCostUsd: 0.5, durationMs: 3, output: `out-${index}` },
    completedAt: '2026-01-01T00:00:00.000Z',
  }));
  return {
    id: 'cplan-resume-fixture', state: 'paused', intent: 'fixture', steps,
    totalEstimatedTokens: 80, totalEstimatedCostUsd: 8,
    totalActualTokens: 16, totalActualCostUsd: 4,
    stepContext: { s0: 'retain context' }, createdAt: '2026-01-01T00:00:00.000Z',
    reviewCyclesUsed: cycles, activeStepId: 's5', currentStepId: 's5',
  };
}

describe('legacy Plan resume characterization', () => {
  it('counts only done steps as done and excludes skipped steps from remaining cost', () => {
    const plan = fixture();
    const snapshot = structuredClone(plan);
    expect(buildResumePromptContext(plan)).toStrictEqual({
      doneCount: 1, failedCount: 2, remainingCount: 6, failedStep: plan.steps[2],
      remainingCostUsd: 6, remainingTokens: 60,
    });
    expect(plan).toStrictEqual(snapshot);
  });

  it.each([0, 1, 2, 3])('preserves the raw resume envelope at %i review cycles', cycles => {
    const plan = fixture(cycles);
    const snapshot = structuredClone(plan);
    const result = skipCompletedSteps(plan);
    expect(result).toStrictEqual({ ...snapshot, steps: [
      { ...snapshot.steps[0], state: 'skipped' },
      { ...snapshot.steps[1], state: 'skipped' },
      { ...snapshot.steps[2], state: 'pending', result: undefined },
      cycles >= 2 ? snapshot.steps[3] : { ...snapshot.steps[3], state: 'pending', result: undefined },
      snapshot.steps[4],
      { ...snapshot.steps[5], state: 'pending' },
      { ...snapshot.steps[6], state: 'pending' },
      { ...snapshot.steps[7], state: 'pending' },
    ] });
    expect(plan).toStrictEqual(snapshot);
    expect(result).not.toBe(plan);
  });

  it('handles an empty plan without inventing a failed step', () => {
    const plan = { ...fixture(), steps: [] };
    expect(buildResumePromptContext(plan)).toStrictEqual({
      doneCount: 0, failedCount: 0, remainingCount: 0, failedStep: null,
      remainingCostUsd: 0, remainingTokens: 0,
    });
    expect(skipCompletedSteps(plan)).toStrictEqual(plan);
  });
});

describe('physical Plan resume ownership', () => {
  it('exports the policy through the package entrypoint', () => {
    expect(owner).toHaveProperty('buildResumePromptContext', expect.any(Function));
    expect(owner).toHaveProperty('skipCompletedSteps', expect.any(Function));
    expect(owner).toHaveProperty('prepareCesarPlanResume', expect.any(Function));
  });

  it('does not expose retired resume-policy aliases through CLI queries', () => {
    expect(cliQueries).not.toHaveProperty('buildResumePromptContext');
    expect(cliQueries).not.toHaveProperty('skipCompletedSteps');
  });

  it('prepares a resume without resetting cost or completed work', () => {
    const plan = fixture(2);
    const snapshot = structuredClone(plan);
    expect(owner.prepareCesarPlanResume(plan, 'resume')).toStrictEqual({
      ...snapshot, state: 'running', steps: [
        { ...snapshot.steps[0], state: 'skipped' },
        { ...snapshot.steps[1], state: 'skipped' },
        { ...snapshot.steps[2], state: 'pending', result: undefined },
        snapshot.steps[3], snapshot.steps[4],
        { ...snapshot.steps[5], state: 'pending' },
        { ...snapshot.steps[6], state: 'pending' },
        { ...snapshot.steps[7], state: 'pending' },
      ],
    });
    expect(plan).toStrictEqual(snapshot);
  });

  it('restarts steps and costs while retaining the historical envelope', () => {
    const plan = fixture(2);
    const snapshot = structuredClone(plan);
    const result = owner.prepareCesarPlanResume(plan, 'restart');
    expect(result.steps.map(step => step.state)).toEqual([
      'pending', 'pending', 'pending', 'pending', 'blocked', 'pending', 'pending', 'pending',
    ]);
    expect(result.steps.every(step => step.result === undefined)).toBe(true);
    expect(result).toStrictEqual({
      ...snapshot, state: 'running', totalActualTokens: 0, totalActualCostUsd: 0,
      steps: snapshot.steps.map((step, index) => ({ ...step, state: index === 4 ? 'blocked' : 'pending', result: undefined })),
    });
    expect(plan).toStrictEqual(snapshot);
  });
});
