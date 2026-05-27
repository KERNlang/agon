import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCesarPlan, approveCesarPlan, advanceCesarStep, cancelCesarPlan, exitCesarPlan, saveCesarPlan, loadCesarPlan, listCesarPlans, cesarPlanJsonPath, cesarPlanMarkdownPath } from '../../packages/core/src/generated/cesar/plan.js';
import type { CesarPlan, CesarPlanStep } from '../../packages/core/src/generated/cesar/plan.js';
import { executePlan } from '../../packages/core/src/generated/cesar/plan-executor.js';

const makeStep = (id: string, overrides?: Partial<CesarPlanStep>): CesarPlanStep => ({
  id,
  type: 'self',
  description: 'test step',
  estimatedTokens: 1000,
  estimatedCostUsd: 0.01,
  ...overrides,
});

describe('CesarPlan state machine', () => {
  it('exitCesarPlan cancels the plan and records the exit reason + timestamp', () => {
    const plan = createCesarPlan('refactor everything', [makeStep('s1'), makeStep('s2')]);
    const exited = exitCesarPlan(plan, '  single-file rename, faster live  ');
    expect(exited.state).toBe('cancelled');
    expect(exited.steps.every(s => s.state === 'cancelled')).toBe(true);
    expect(exited.exitReason).toBe('single-file rename, faster live'); // trimmed
    expect(exited.exitedAt).toBeDefined();
    expect(exited.id).toBe(plan.id); // same plan id — archived, not a new plan
  });

  it('exitCesarPlan falls back to a placeholder reason when none given', () => {
    const exited = exitCesarPlan(createCesarPlan('task', [makeStep('s1')]), '   ');
    expect(exited.exitReason).toBe('no reason given');
    expect(exited.state).toBe('cancelled');
  });

  it('creates a plan in planning state', () => {
    const plan = createCesarPlan('add rate limiting', [makeStep('scan')]);
    expect(plan.state).toBe('planning');
    expect(plan.intent).toBe('add rate limiting');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].state).toBe('pending');
    expect(plan.updatedAt).toBeDefined();
    expect(plan.currentStepId).toBeNull();
    expect(plan.activeStepId).toBeNull();
  });

  it('approves a plan and transitions to running', () => {
    let plan = createCesarPlan('task', [makeStep('s1')]);
    plan = { ...plan, state: 'awaiting_approval' as const };
    plan = approveCesarPlan(plan);
    expect(plan.state).toBe('running');
    expect(plan.approvedAt).toBeDefined();
    expect(plan.updatedAt).toBeDefined();
  });

  it('blocks steps with dependencies', () => {
    const plan = createCesarPlan('task', [
      makeStep('s1'),
      makeStep('s2', { dependsOn: ['s1'] }),
    ]);
    expect(plan.steps[0].state).toBe('pending');
    expect(plan.steps[1].state).toBe('blocked');
  });

  it('advances a step to done', () => {
    let plan = createCesarPlan('task', [makeStep('s1'), makeStep('s2')]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    plan = advanceCesarStep(plan, 's1', { status: 'success', actualTokens: 800, actualCostUsd: 0.008, durationMs: 5000, output: 'found patterns' });
    expect(plan.steps[0].state).toBe('done');
    expect(plan.steps[0].result?.actualTokens).toBe(800);
    expect(plan.totalActualTokens).toBe(800);
  });

  it('resolves dependencies when step completes', () => {
    let plan = createCesarPlan('task', [
      makeStep('s1'),
      makeStep('s2', { dependsOn: ['s1'] }),
    ]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    expect(plan.steps[1].state).toBe('blocked');
    plan = advanceCesarStep(plan, 's1', { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '' });
    expect(plan.steps[1].state).toBe('pending');
  });

  it('marks plan done when all steps complete', () => {
    let plan = createCesarPlan('task', [makeStep('s1')]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    plan = advanceCesarStep(plan, 's1', { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '' });
    expect(plan.state).toBe('done');
    expect(plan.completedAt).toBeDefined();
  });

  it('pauses plan on step failure', () => {
    let plan = createCesarPlan('task', [makeStep('s1'), makeStep('s2')]);
    plan = approveCesarPlan({ ...plan, state: 'awaiting_approval' as const });
    plan = advanceCesarStep(plan, 's1', { status: 'failure', actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '', error: 'no winner' });
    expect(plan.state).toBe('paused');
    expect(plan.steps[0].state).toBe('failed');
  });

  it('pauses instead of leaving a stale running plan when aborted between steps', async () => {
    const abort = new AbortController();
    const plan = approveCesarPlan({
      ...createCesarPlan('task', [makeStep('s1'), makeStep('s2')]),
      state: 'awaiting_approval' as const,
    });
    const updates: CesarPlan[] = [];

    const finalPlan = await executePlan(plan, {
      self: {
        execute: async () => {
          abort.abort();
          return {
            result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: 1, output: 'ok' },
          };
        },
      },
    }, {
      onStepStart: () => {},
      onStepDone: () => {},
      onPlanUpdate: (updated) => updates.push(updated),
      onBudgetWarning: () => {},
    }, abort.signal);

    expect(finalPlan.state).toBe('paused');
    expect(finalPlan.steps[0].state).toBe('done');
    expect(finalPlan.steps[1].state).toBe('pending');
    expect(updates.at(-1)?.state).toBe('paused');
  });

  it('publishes a running step update before a long executor finishes', async () => {
    const plan = approveCesarPlan({
      ...createCesarPlan('task', [makeStep('s1')]),
      state: 'awaiting_approval' as const,
    });
    const updates: CesarPlan[] = [];

    const finalPlan = await executePlan(plan, {
      self: {
        execute: async () => ({
          result: { status: 'success', actualTokens: 0, actualCostUsd: 0, durationMs: 1, output: 'ok' },
        }),
      },
    }, {
      onStepStart: () => {},
      onStepDone: () => {},
      onPlanUpdate: (updated) => updates.push(updated),
      onBudgetWarning: () => {},
    });

    expect(updates[0].steps[0].state).toBe('running');
    expect(updates[0].steps[0].startedAt).toBeDefined();
    expect(updates[0].currentStepId).toBe('s1');
    expect(updates[0].activeStepId).toBe('s1');
    expect(finalPlan.steps[0].state).toBe('done');
    expect(finalPlan.steps[0].completedAt).toBeDefined();
    expect(finalPlan.currentStepId).toBeNull();
    expect(finalPlan.activeStepId).toBeNull();
    expect(updates.at(-1)?.steps[0].state).toBe('done');
  });

  it('cancels a plan', () => {
    let plan = createCesarPlan('task', [makeStep('s1'), makeStep('s2')]);
    plan = cancelCesarPlan(plan);
    expect(plan.state).toBe('cancelled');
    expect(plan.steps.every(s => s.state === 'cancelled')).toBe(true);
  });

  it('persists plans under ~/.agon/plans with a stable markdown path', () => {
    const previousAgonHome = process.env.AGON_HOME;
    const agonHome = mkdtempSync(join(tmpdir(), 'agon-plan-test-'));

    try {
      process.env.AGON_HOME = agonHome;
      const plan = {
        ...createCesarPlan('show the whole plan', [makeStep('s1')]),
        state: 'awaiting_approval' as const,
      };

      saveCesarPlan(plan);

      const jsonPath = cesarPlanJsonPath(plan.id);
      const markdownPath = cesarPlanMarkdownPath(plan.id);
      expect(jsonPath).toBe(join(agonHome, 'plans', `${plan.id}.json`));
      expect(markdownPath).toBe(join(agonHome, 'plans', `${plan.id}.md`));
      expect(existsSync(jsonPath)).toBe(true);

      const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
      expect(raw.planFilePath).toBe(markdownPath);
      expect(loadCesarPlan(plan.id)?.planFilePath).toBe(markdownPath);
      expect(listCesarPlans().map(p => p.id)).toContain(plan.id);
    } finally {
      if (previousAgonHome === undefined) delete process.env.AGON_HOME;
      else process.env.AGON_HOME = previousAgonHome;
      rmSync(agonHome, { recursive: true, force: true });
    }
  });

  it('returns null for invalid plan ids', () => {
    expect(loadCesarPlan('!!!')).toBeNull();
  });

  it('does not invent markdown paths for legacy run plans without markdown files', () => {
    const previousAgonHome = process.env.AGON_HOME;
    const agonHome = mkdtempSync(join(tmpdir(), 'agon-plan-legacy-test-'));

    try {
      process.env.AGON_HOME = agonHome;
      const plan = {
        ...createCesarPlan('legacy plan', [makeStep('s1')]),
        state: 'awaiting_approval' as const,
      };
      const runsDir = join(agonHome, 'runs');
      mkdirSync(runsDir, { recursive: true });
      writeFileSync(join(runsDir, `${plan.id}.json`), JSON.stringify(plan, null, 2));

      const loaded = loadCesarPlan(plan.id);
      expect(loaded?.id).toBe(plan.id);
      expect(loaded?.planFilePath).toBeUndefined();

      const listed = listCesarPlans().find(p => p.id === plan.id);
      expect(listed?.planFilePath).toBeUndefined();
    } finally {
      if (previousAgonHome === undefined) delete process.env.AGON_HOME;
      else process.env.AGON_HOME = previousAgonHome;
      rmSync(agonHome, { recursive: true, force: true });
    }
  });
});
