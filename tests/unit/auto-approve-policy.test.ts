import { describe, it, expect } from 'vitest';
import { applyAgenticAutoApprovePolicy, applyAutoApprovePolicy } from '../../packages/cli/src/generated/cesar/auto-approve-policy.js';
import { createTaskExecutionLease } from '../../packages/cli/src/generated/cesar/task-execution-lease.js';
import { createCesarPlan } from '../../packages/core/src/generated/cesar/plan.js';
import type { AgonConfig } from '../../packages/core/src/generated/models/types.js';
import type { CesarPlan, CesarPlanStep, CesarStepType } from '../../packages/core/src/generated/cesar/plan.js';

const makeStep = (id: string, type: CesarStepType, overrides?: Partial<CesarPlanStep>): CesarPlanStep => ({
  id,
  type,
  description: `${type} step`,
  estimatedTokens: 1000,
  estimatedCostUsd: 0.01,
  ...overrides,
});

const makePlan = (
  steps: CesarPlanStep[],
  flags: Partial<Pick<CesarPlan, 'autoApprove' | 'selfReview'>> = {},
): CesarPlan => {
  const plan = createCesarPlan('test intent', steps);
  return {
    ...plan,
    state: 'awaiting_approval' as const,
    autoApprove: flags.autoApprove,
    selfReview: flags.selfReview,
    totalEstimatedCostUsd: steps.reduce((s, x) => s + x.estimatedCostUsd, 0),
    totalEstimatedTokens: steps.reduce((s, x) => s + x.estimatedTokens, 0),
  };
};

const cfg = (overrides: Partial<AgonConfig> = {}) => ({
  cesarAutoApproveMode: 'safe-only',
  ...overrides,
} as AgonConfig);

describe('applyAutoApprovePolicy', () => {
  describe('Gate 0 — global off switch', () => {
    it('rejects when mode is off, even if plan opts in', () => {
      const plan = makePlan([makeStep('s', 'brainstorm')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, cfg({ cesarAutoApproveMode: 'off' }));
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('off');
    });
  });

  describe('Gate 1 — plan opt-in required', () => {
    it('rejects when plan does not request autoApprove', () => {
      const plan = makePlan([makeStep('s', 'brainstorm')]); // no autoApprove
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('did not request');
    });

    it('rejects when autoApprove is explicitly false', () => {
      const plan = makePlan([makeStep('s', 'brainstorm')], { autoApprove: false });
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(false);
    });
  });

  describe('Gate 2 — safe-only whitelist (Tribunal fix #1)', () => {
    it('approves brainstorm/tribunal/campfire/review under safe-only', () => {
      const plan = makePlan(
        [
          makeStep('s1', 'brainstorm'),
          makeStep('s2', 'tribunal'),
          makeStep('s3', 'campfire'),
          makeStep('s4', 'review'),
        ],
        { autoApprove: true },
      );
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(true);
    });

    it('rejects forge under safe-only', () => {
      const plan = makePlan([makeStep('s', 'forge')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('safe-only');
    });

    it('rejects delegate under safe-only (tribunal fix #1)', () => {
      const plan = makePlan([makeStep('s', 'delegate')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('delegate');
    });

    it('rejects self under safe-only (tribunal fix #1)', () => {
      const plan = makePlan([makeStep('s', 'self')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('self');
    });

    it('rejects agent under safe-only', () => {
      const plan = makePlan([makeStep('s', 'agent')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(false);
    });

    it('rejects team-agent under safe-only', () => {
      const plan = makePlan([makeStep('s', 'team-agent')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(false);
    });
  });

  describe('Gate 3 — fitnessCmd interlock (Tribunal fix #7)', () => {
    it('rejects any plan with a fitnessCmd unless mode is always', () => {
      const plan = makePlan(
        [makeStep('s', 'forge', { fitnessCmd: 'rm -rf ~' })],
        { autoApprove: true },
      );
      const decision = applyAutoApprovePolicy(
        plan,
        cfg({ cesarAutoApproveMode: 'cost-bounded', cesarAutoApproveMaxCostUsd: 100 }),
      );
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('fitnessCmd');
    });

    it('allows fitnessCmd under always mode', () => {
      const plan = makePlan(
        [makeStep('s', 'forge', { fitnessCmd: 'npm test' })],
        { autoApprove: true },
      );
      const decision = applyAutoApprovePolicy(
        plan,
        cfg({ cesarAutoApproveMode: 'always', cesarAutoApproveMaxCostUsd: 100 }),
      );
      expect(decision.approve).toBe(true);
    });

    it('ignores empty fitnessCmd', () => {
      const plan = makePlan(
        [makeStep('s', 'brainstorm', { fitnessCmd: '   ' })],
        { autoApprove: true },
      );
      const decision = applyAutoApprovePolicy(plan, cfg());
      expect(decision.approve).toBe(true); // brainstorm under safe-only
    });
  });

  describe('Gate 4 — cost ceiling with review-cycle adjustment (Tribunal fix #11)', () => {
    it('approves cost-bounded plan under ceiling', () => {
      const plan = makePlan([makeStep('s', 'brainstorm', { estimatedCostUsd: 0.05 })], { autoApprove: true });
      const decision = applyAutoApprovePolicy(
        plan,
        cfg({ cesarAutoApproveMode: 'cost-bounded', cesarAutoApproveMaxCostUsd: 1.0 }),
      );
      expect(decision.approve).toBe(true);
    });

    it('rejects cost-bounded plan over ceiling', () => {
      const plan = makePlan([makeStep('s', 'brainstorm', { estimatedCostUsd: 5.0 })], { autoApprove: true });
      const decision = applyAutoApprovePolicy(
        plan,
        cfg({ cesarAutoApproveMode: 'cost-bounded', cesarAutoApproveMaxCostUsd: 1.0 }),
      );
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('exceeds ceiling');
    });

    it('folds 2× review cost into the ceiling check for mutating plans', () => {
      // Plan is $0.09 raw. Under always-mode + selfReview default true, the
      // policy adds 2 × review cost (~$0.04 default) to make $0.17. With a
      // $0.10 ceiling, this should reject — without the review fold-in it
      // would slip through.
      const plan = makePlan(
        [
          makeStep('s', 'forge', { estimatedCostUsd: 0.09, fitnessCmd: '' }),
          // No fitnessCmd so the interlock doesn't trip; testing cost gate alone.
        ],
        { autoApprove: true },
      );
      const decision = applyAutoApprovePolicy(
        plan,
        cfg({ cesarAutoApproveMode: 'always', cesarAutoApproveMaxCostUsd: 0.10 }),
      );
      expect(decision.approve).toBe(false);
      expect(decision.adjustedCostUsd).toBeGreaterThan(plan.totalEstimatedCostUsd);
    });

    it('does not fold review cost when selfReview is false', () => {
      const plan = makePlan(
        [makeStep('s', 'forge', { estimatedCostUsd: 0.09 })],
        { autoApprove: true, selfReview: false },
      );
      const decision = applyAutoApprovePolicy(
        plan,
        cfg({ cesarAutoApproveMode: 'always', cesarAutoApproveMaxCostUsd: 0.10 }),
      );
      expect(decision.approve).toBe(true);
      expect(decision.adjustedCostUsd).toBeCloseTo(plan.totalEstimatedCostUsd, 5);
    });

    it('does not fold review cost for non-mutating plans', () => {
      const plan = makePlan(
        [makeStep('s', 'brainstorm', { estimatedCostUsd: 0.09 })],
        { autoApprove: true },
      );
      const decision = applyAutoApprovePolicy(
        plan,
        cfg({ cesarAutoApproveMode: 'cost-bounded', cesarAutoApproveMaxCostUsd: 0.10 }),
      );
      expect(decision.approve).toBe(true);
      expect(decision.adjustedCostUsd).toBeCloseTo(0.09, 5);
    });

    it('approves cost-bounded with no ceiling configured', () => {
      const plan = makePlan([makeStep('s', 'brainstorm')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, cfg({ cesarAutoApproveMode: 'cost-bounded' }));
      expect(decision.approve).toBe(true);
    });
  });

  describe('default mode is safe-only', () => {
    it('falls back to safe-only when cesarAutoApproveMode is unset', () => {
      const plan = makePlan([makeStep('s', 'forge')], { autoApprove: true });
      const decision = applyAutoApprovePolicy(plan, {} as AgonConfig);
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('safe-only');
    });
  });

  describe('agentic AUTO ownership', () => {
    it('executes a routine mutating plan without a second approval loop', () => {
      const plan = makePlan([
        makeStep('edit', 'self', { description: 'Update the local renderer', verifyCmd: 'npm test' }),
      ], { autoApprove: true });
      const lease = createTaskExecutionLease('update the renderer and test it', true, '/repo', undefined, 'agentic');

      const decision = applyAgenticAutoApprovePolicy(plan, cfg(), lease);
      expect(decision.approve).toBe(true);
    });

    it('stops at an external side-effect boundary', () => {
      const plan = makePlan([
        makeStep('publish', 'self', { description: 'Push the finished branch', verifyCmd: 'git push origin main' }),
      ], { autoApprove: true });
      const lease = createTaskExecutionLease('finish the local implementation', true, '/repo', undefined, 'agentic');

      const decision = applyAgenticAutoApprovePolicy(plan, cfg(), lease);
      expect(decision.approve).toBe(false);
      expect(decision.reason).toContain('boundary');
    });

    it('respects the explicit plan auto-approval kill switch', () => {
      const plan = makePlan([makeStep('edit', 'self')], { autoApprove: true });
      const lease = createTaskExecutionLease('update the renderer', true, '/repo', undefined, 'agentic');
      expect(applyAgenticAutoApprovePolicy(plan, cfg({ cesarAutoApproveMode: 'off' }), lease).approve).toBe(false);
    });

    it('does not treat prose descriptions as shell commands', () => {
      const plan = makePlan([
        makeStep('state', 'self', { description: 'Push the selected items into component state and re-render' }),
      ], { autoApprove: true });
      const lease = createTaskExecutionLease('update the picker state handling', true, '/repo', undefined, 'agentic');
      expect(applyAgenticAutoApprovePolicy(plan, cfg(), lease).approve).toBe(true);
    });

    it('still fences real commands in fitness and verify fields', () => {
      const plan = makePlan([
        makeStep('escape', 'self', { description: 'Snapshot the config', verifyCmd: 'cp config.json ../backup/config.json' }),
      ], { autoApprove: true });
      const lease = createTaskExecutionLease('snapshot the config', true, '/repo', undefined, 'agentic');
      expect(applyAgenticAutoApprovePolicy(plan, cfg(), lease).approve).toBe(false);
    });
  });
});
