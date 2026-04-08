import { describe, it, expect, beforeEach } from 'vitest';
import { planCostEstimator } from '../../packages/core/src/generated/plan-cost-estimator.js';
import { tracker } from '../../packages/core/src/generated/token-tracker.js';

describe('PlanCostEstimator', () => {
  beforeEach(() => {
    tracker.reset();
    planCostEstimator.reset();
  });

  it('returns default estimates when no history', () => {
    const est = planCostEstimator.estimate('forge', ['claude', 'codex', 'gemini']);
    expect(est.tokens).toBeGreaterThan(0);
    expect(est.costUsd).toBeGreaterThan(0);
  });

  it('uses historical averages when available', () => {
    planCostEstimator.recordStepCompletion('forge', 14000, 0.10);
    planCostEstimator.recordStepCompletion('forge', 16000, 0.12);
    const est = planCostEstimator.estimate('forge', ['claude', 'codex']);
    expect(est.tokens).toBe(15000); // average of 14000 and 16000
    expect(est.costUsd).toBeCloseTo(0.11, 2);
  });

  it('estimates different costs for different step types', () => {
    const forgeEst = planCostEstimator.estimate('forge', ['claude', 'codex', 'gemini']);
    const selfEst = planCostEstimator.estimate('self', []);
    expect(forgeEst.tokens).toBeGreaterThan(selfEst.tokens);
  });

  it('scales default estimate by engine count', () => {
    const twoEngines = planCostEstimator.estimate('forge', ['claude', 'codex']);
    const threeEngines = planCostEstimator.estimate('forge', ['claude', 'codex', 'gemini']);
    expect(threeEngines.tokens).toBeGreaterThan(twoEngines.tokens);
  });
});
