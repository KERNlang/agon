import { describe, it, expect } from 'vitest';
import {
  createPlan,
  advanceStep,
  mergeStepResult,
  approvePlan,
  startPlan,
  cancelPlan,
  failPlan,
  resetStepForRetry,
} from '../../packages/core/src/plan.js';
import { PlanStateError } from '../../packages/core/src/errors.js';
import type { Plan, PlanStepInput, WorkspaceSnapshot, PlanAction } from '../../packages/core/src/plan.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeWorkspace(): WorkspaceSnapshot {
  return { id: 'ws-1', path: '/tmp/test', headSha: 'abc123', branch: 'main', dirty: false };
}

function makeAction(overrides?: Partial<PlanAction>): PlanAction {
  return { type: 'forge', task: 'fix the bug', fitnessCmd: 'npm test', engines: ['claude', 'codex'], ...overrides };
}

function makeSteps(): PlanStepInput[] {
  return [
    { id: 'baseline', kind: 'fitness', label: 'Baseline check', effects: ['exec'] },
    { id: 'dispatch', kind: 'dispatch', label: 'Dispatch engines', effects: ['exec', 'write', 'network'] },
    { id: 'score', kind: 'fitness', label: 'Score results', effects: ['exec', 'read'] },
    { id: 'winner', kind: 'dispatch', label: 'Determine winner', effects: ['read'] },
  ];
}

function makePlan(state?: Plan['state']): Plan {
  const plan = createPlan(makeAction(), makeWorkspace(), makeSteps());
  if (state && state !== 'draft') {
    return { ...plan, state };
  }
  return plan;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Plan Model — Transition Functions', () => {
  // ── mergeStepResult ──

  describe('mergeStepResult', () => {
    it('appends attempts instead of replacing', () => {
      let plan = makePlan('running');
      // First attempt
      plan = mergeStepResult(plan, 'baseline', {
        state: 'running',
        attempts: [{ startedAt: '2026-01-01T00:00:00Z' }],
      });
      expect(plan.steps[0].result.attempts).toHaveLength(1);

      // Second attempt — should append, not replace
      plan = mergeStepResult(plan, 'baseline', {
        state: 'completed',
        attempts: [{ startedAt: '2026-01-01T00:01:00Z', finishedAt: '2026-01-01T00:01:30Z' }],
      });
      expect(plan.steps[0].result.attempts).toHaveLength(2);
      expect(plan.steps[0].result.state).toBe('completed');
    });

    it('appends artifacts instead of replacing', () => {
      let plan = makePlan('running');
      plan = mergeStepResult(plan, 'winner', {
        state: 'running',
        artifacts: [{ type: 'manifest', path: '/a' }],
      });
      plan = mergeStepResult(plan, 'winner', {
        state: 'completed',
        artifacts: [{ type: 'patch', path: '/b', engineId: 'claude' }],
      });
      expect(plan.steps[3].result.artifacts).toHaveLength(2);
    });

    it('preserves existing state when partial has no state', () => {
      let plan = makePlan('running');
      plan = mergeStepResult(plan, 'baseline', { state: 'running' });
      plan = mergeStepResult(plan, 'baseline', {
        artifacts: [{ type: 'output', path: '/x' }],
      });
      expect(plan.steps[0].result.state).toBe('running');
    });

    it('transitions plan to paused on step failure', () => {
      let plan = makePlan('running');
      plan = mergeStepResult(plan, 'dispatch', { state: 'failed' });
      expect(plan.state).toBe('paused');
      expect(plan.currentStepId).toBe('dispatch');
    });

    it('advances to next pending step on completion', () => {
      let plan = makePlan('running');
      plan = mergeStepResult(plan, 'baseline', { state: 'completed' });
      expect(plan.currentStepId).toBe('dispatch');
      expect(plan.state).toBe('running');
    });

    it('completes plan when last step completes', () => {
      let plan = makePlan('running');
      plan = mergeStepResult(plan, 'baseline', { state: 'completed' });
      plan = mergeStepResult(plan, 'dispatch', { state: 'completed' });
      plan = mergeStepResult(plan, 'score', { state: 'completed' });
      plan = mergeStepResult(plan, 'winner', { state: 'completed' });
      expect(plan.state).toBe('completed');
      expect(plan.currentStepId).toBeNull();
    });

    it('returns plan unchanged for unknown stepId', () => {
      const plan = makePlan('running');
      const result = mergeStepResult(plan, 'nonexistent', { state: 'completed' });
      expect(result).toBe(plan);
    });
  });

  // ── approvePlan ──

  describe('approvePlan', () => {
    it('transitions draft → approved', () => {
      const plan = { ...makePlan('draft'), updatedAt: '2025-01-01T00:00:00Z' };
      const approved = approvePlan(plan);
      expect(approved.state).toBe('approved');
      expect(approved.updatedAt).not.toBe(plan.updatedAt);
    });

    it('throws PlanStateError on non-draft state', () => {
      const plan = makePlan('running');
      expect(() => approvePlan(plan)).toThrow(PlanStateError);
    });
  });

  // ── startPlan ──

  describe('startPlan', () => {
    it('transitions approved → running and sets currentStepId', () => {
      const plan = makePlan('draft');
      const approved = approvePlan(plan);
      const running = startPlan(approved);
      expect(running.state).toBe('running');
      expect(running.currentStepId).toBe('baseline');
    });

    it('throws PlanStateError on non-approved state', () => {
      const plan = makePlan('draft');
      expect(() => startPlan(plan)).toThrow(PlanStateError);
    });
  });

  // ── cancelPlan ──

  describe('cancelPlan', () => {
    it('cancels a draft plan', () => {
      const plan = makePlan('draft');
      expect(cancelPlan(plan).state).toBe('cancelled');
    });

    it('cancels a running plan', () => {
      const plan = makePlan('running');
      expect(cancelPlan(plan).state).toBe('cancelled');
    });

    it('cancels a paused plan', () => {
      const plan = makePlan('paused');
      expect(cancelPlan(plan).state).toBe('cancelled');
    });

    it('cancels a failed plan', () => {
      const plan = makePlan('failed');
      expect(cancelPlan(plan).state).toBe('cancelled');
    });

    it('throws PlanStateError on completed plan', () => {
      const plan = makePlan('completed');
      expect(() => cancelPlan(plan)).toThrow(PlanStateError);
    });

    it('throws PlanStateError on already cancelled plan', () => {
      const plan = makePlan('cancelled');
      expect(() => cancelPlan(plan)).toThrow(PlanStateError);
    });
  });

  // ── failPlan ──

  describe('failPlan', () => {
    it('transitions running → failed', () => {
      const plan = makePlan('running');
      const failed = failPlan(plan);
      expect(failed.state).toBe('failed');
    });

    it('transitions paused → failed', () => {
      const plan = makePlan('paused');
      const failed = failPlan(plan);
      expect(failed.state).toBe('failed');
    });

    it('records error on current step when provided', () => {
      let plan = makePlan('running');
      plan = { ...plan, currentStepId: 'dispatch' };
      const failed = failPlan(plan, 'Engine crashed');
      const dispatchStep = failed.steps.find((s) => s.id === 'dispatch')!;
      expect(dispatchStep.result.state).toBe('failed');
      expect(dispatchStep.result.attempts).toHaveLength(1);
      expect(dispatchStep.result.attempts[0].error).toBe('Engine crashed');
    });

    it('throws PlanStateError on draft plan', () => {
      const plan = makePlan('draft');
      expect(() => failPlan(plan)).toThrow(PlanStateError);
    });
  });

  // ── resetStepForRetry ──

  describe('resetStepForRetry', () => {
    it('resets failed step and subsequent steps to pending', () => {
      let plan = makePlan('running');
      // Complete baseline, fail dispatch
      plan = mergeStepResult(plan, 'baseline', { state: 'completed' });
      plan = mergeStepResult(plan, 'dispatch', {
        state: 'failed',
        attempts: [{ startedAt: '2026-01-01T00:00:00Z', error: 'timeout' }],
      });
      expect(plan.state).toBe('paused');

      const reset = resetStepForRetry(plan, 'dispatch');
      expect(reset.state).toBe('approved');
      expect(reset.currentStepId).toBe('dispatch');
      // Failed step reset to pending but keeps attempt history
      const dispatch = reset.steps.find((s) => s.id === 'dispatch')!;
      expect(dispatch.result.state).toBe('pending');
      expect(dispatch.result.attempts).toHaveLength(1); // history preserved
      // Subsequent steps also reset
      expect(reset.steps.find((s) => s.id === 'score')!.result.state).toBe('pending');
      expect(reset.steps.find((s) => s.id === 'winner')!.result.state).toBe('pending');
      // Prior steps untouched
      expect(reset.steps.find((s) => s.id === 'baseline')!.result.state).toBe('completed');
    });

    it('returns plan unchanged for non-failed step', () => {
      const plan = makePlan('running');
      const result = resetStepForRetry(plan, 'baseline');
      expect(result).toBe(plan);
    });

    it('returns plan unchanged for unknown stepId', () => {
      const plan = makePlan('running');
      const result = resetStepForRetry(plan, 'nonexistent');
      expect(result).toBe(plan);
    });
  });
});
