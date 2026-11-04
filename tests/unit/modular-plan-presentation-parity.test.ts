import { afterEach, expect, it, vi } from 'vitest';
import { PlanCostEstimator } from '../../packages/mod-plan/src/cost-estimator.js';
import { createPlanStepSanitizer } from '../../packages/mod-plan/src/step-validation.js';
import { formatCesarPlanMarkdown, formatStepType } from '../../packages/mod-plan/src/formatter.js';
import { CESAR_STEP_TYPES } from '../../packages/mod-plan/src/execution-model.js';
import type { CesarPlan, CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

const price = vi.hoisted(() => vi.fn((engine: string, tokens: number) => engine.length * tokens / 100000));
vi.mock('../../packages/core/src/signals/token-tracker.js', () => ({ estimateCost: price }));
import { PlanCostEstimator as LegacyCost, planCostEstimator as legacyCost } from '../fixtures/modular-plan-cost-legacy.js';
import { sanitizePlanSteps as legacySanitize } from '../fixtures/modular-plan-validation-legacy.js';
import { formatCesarPlanMarkdown as legacyFormat, formatStepType as legacyType } from '../fixtures/modular-plan-formatter-legacy.js';
import { planCostEstimator as coreCost, sanitizePlanSteps as coreSanitize } from '../../packages/core/src/cesar/plan-cost-estimator.js';

afterEach(() => { vi.restoreAllMocks(); price.mockClear(); legacyCost.reset(); coreCost.reset(); });

it('keeps every legacy step type in the parity matrix', () => {
  expect(CESAR_STEP_TYPES).toEqual(['self', 'forge', 'teamforge', 'delegate', 'brainstorm', 'campfire',
    'tribunal', 'pipeline', 'review', 'agent', 'team-agent']);
});

it('shares the Core estimator with its compatibility sanitizer', () => {
  coreCost.recordStepCompletion('self', 100, 0.1);
  coreCost.recordStepCompletion('self', 300, 0.3);
  expect(coreSanitize([{ type: 'self', id: 'test', description: 'shared history', estimatedCostUsd: -1 }]).steps[0])
    .toMatchObject({ estimatedTokens: 200, estimatedCostUsd: 0.2 });
});

it('preserves defaults, first-engine pricing, fallback and every rolling history update', () => {
  const actual = new PlanCostEstimator(price);
  const legacy = new LegacyCost();
  for (const type of [...CESAR_STEP_TYPES, 'unknown']) {
    for (const engines of [[], ['a'], ['long-engine', 'b'], ['a', 'b', 'c']]) {
      expect(actual.estimate(type, engines)).toEqual(legacy.estimate(type, engines));
    }
  }
  for (let round = 0; round < 65; round++) {
    for (const type of ['self', 'forge']) {
      actual.recordStepCompletion(type, round * 123 + 1, round / 97);
      legacy.recordStepCompletion(type, round * 123 + 1, round / 97);
      expect(actual.estimate(type, ['a', 'b'])).toEqual(legacy.estimate(type, ['a', 'b']));
      expect(actual.estimate('review', [])).toEqual(legacy.estimate('review', []));
    }
  }
  actual.reset(); legacy.reset();
  expect(actual.estimate('forge', [])).toEqual(legacy.estimate('forge', []));
});

it('keeps estimator instances independent and does not price historical averages', () => {
  const first = new PlanCostEstimator(price);
  const second = new PlanCostEstimator(price);
  first.recordStepCompletion('forge', 1, 1);
  first.recordStepCompletion('forge', 3, 3);
  price.mockClear();
  expect(first.estimate('forge', ['a'])).toEqual({ tokens: 2, costUsd: 2 });
  expect(price).not.toHaveBeenCalled();
  expect(second.estimate('forge', ['a'])).toEqual({ tokens: 15000, costUsd: 0.15 });
});

it('preserves sanitization and estimator authority rather than trusting supplied costs', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.25);
  const estimator = new PlanCostEstimator(price);
  const sanitize = createPlanStepSanitizer(estimator);
  const cases: unknown[] = [undefined, null, {}, 'steps', 42, true, [],
    [null, {}, { type: 'unknown' }],
    CESAR_STEP_TYPES.map((type, index) => ({ type, id: 'step-' + index, description: 'valid', engines: ['a', 'bb'],
      estimatedTokens: -1, estimatedCostUsd: -1 })),
    [{ type: 'forge', id: '../escape', description: ' ', engines: [], exports: 'artifact', imports: 'prior',
      dependsOn: ['before'], parallel: true, fitnessCmd: 'verify', verifyCmd: 'check', rationale: 'why' }],
    [{ type: 'delegate', engine: 'a', description: 'keep whitespace ', id: 'GOOD' }],
  ];
  for (const input of cases) expect(sanitize(input)).toEqual(legacySanitize(input));
  for (const owner of [estimator, legacyCost]) {
    owner.recordStepCompletion('forge', 100, 0.4);
    owner.recordStepCompletion('forge', 200, 0.6);
  }
  expect(sanitize([{ type: 'forge' }])).toEqual(legacySanitize([{ type: 'forge' }]));
  expect(sanitize([{ type: 'forge' }]).steps[0]).toMatchObject({ estimatedTokens: 150, estimatedCostUsd: 0.5 });
});

it('preserves exact Markdown across step types, states, estimates and actual results', () => {
  for (const type of CESAR_STEP_TYPES) {
    for (const state of ['planning', 'awaiting_approval', 'running', 'paused', 'done', 'cancelled'] as const) {
      for (const actual of [false, true]) {
        const step: CesarPlanStep = { id: 's1', type, description: 'Keep original text',
          engines: ['one', 'two'], engine: 'one', estimatedTokens: 12345, estimatedCostUsd: 0.12,
          fitnessCmd: 'echo "test"', verifyCmd: 'verify', rationale: 'because',
          dependsOn: ['before'], imports: ['input'], exports: ['output'], tribunalMode: 'red-team',
          ...(actual ? { state: 'done' as const, result: { status: 'success' as const, actualTokens: 23456,
            actualCostUsd: 0.4567, durationMs: 1234, output: 'done' } } : {}),
        };
        const plan: CesarPlan = { id: 'cplan-fixture', intent: 'A plan', state, steps: [step],
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          activeStepId: null, stepContext: {}, totalEstimatedTokens: 12345, totalEstimatedCostUsd: 0.12,
          totalActualTokens: actual ? 23456 : 0, totalActualCostUsd: actual ? 0.4567 : 0,
          ...(actual ? { planFilePath: '/fixture/plan.md', planningCost: { tokens: 4000, costUsd: 0.03 } } : {}),
        };
        expect(formatStepType(step)).toBe(legacyType(step));
        expect(formatCesarPlanMarkdown(plan)).toBe(legacyFormat(plan));
        expect(formatCesarPlanMarkdown(plan)).toContain('## Shell Commands');
      }
    }
  }
});
