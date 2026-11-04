import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { expect, it } from 'vitest';
import { evaluatePlanAutoApproval } from '../../packages/mod-plan/src/approval-policy.js';
import { isCesarPlanApprovalInput, isStrongCesarPlanApprovalInput } from '../../packages/mod-plan/src/session-selection.js';
import type { CesarPlan } from '@kernlang/agon-mod-plan';

// Reviewed language snapshots. Keep explicit confirmations (y/yes only) separate
// from natural-language replies to a visible pending Plan.
const approvals = [
  'y', 'yes', 'yes go', 'yes please', 'go', 'go ahead', 'ok go', 'okay go',
  'ok do it', 'okay do it', 'ok do so', 'okay do so', 'run', 'run it', 'start',
  'start it', 'approve', 'approved', 'do it', 'do so', 'proceed', 'execute', 'ok', 'okay', 'sure',
].sort();
const strongApprovals = [
  'yes go', 'go', 'go ahead', 'ok go', 'okay go', 'ok do it', 'okay do it',
  'ok do so', 'okay do so', 'run', 'run it', 'start', 'start it', 'approve',
  'approved', 'do it', 'do so', 'proceed', 'execute',
].sort();
const words = [...new Set([...approvals.flatMap(phrase => phrase.split(' ')), 'never', 'not', 'maybe'])];
const phrases = ['', ...words, ...words.flatMap(first => words.map(second => `${first} ${second}`)),
  ...words.flatMap(first => words.flatMap(second => words.map(third => `${first} ${second} ${third}`)))];

type PhraseCheck = (input: string) => boolean;
function accepted(check: PhraseCheck): string[] {
  return phrases.filter(check).sort();
}

it('freezes the natural approval phrase list over one-, two- and three-word inputs', () => {
  expect(accepted(isCesarPlanApprovalInput)).toEqual(approvals);
  expect(accepted(isStrongCesarPlanApprovalInput)).toEqual(strongApprovals);
});

it('retains punctuation and whitespace normalization without accepting extra clauses', () => {
  for (const phrase of approvals) {
    expect(isCesarPlanApprovalInput(` \t${phrase.toUpperCase().replaceAll(' ', '\n\t')}?! `), phrase).toBe(true);
    expect(isCesarPlanApprovalInput(`${phrase} but not now`), phrase).toBe(false);
    expect(isCesarPlanApprovalInput(`/approve ${phrase}`), phrase).toBe(false);
  }
  for (const phrase of strongApprovals) {
    expect(isStrongCesarPlanApprovalInput(` ${phrase.toUpperCase()}! `), phrase).toBe(true);
  }
});

const plan: CesarPlan = { id: 'cost-boundary', intent: 'fixture', state: 'awaiting_approval',
  steps: [{ id: 'one', type: 'self', description: 'fixture', estimatedTokens: 1, estimatedCostUsd: 14 }],
  stepContext: {}, createdAt: '2026-01-01T00:00:00.000Z', autoApprove: true,
  totalEstimatedTokens: 1, totalEstimatedCostUsd: 14, totalActualTokens: 0, totalActualCostUsd: 0 };

const costCases = ['cost-bounded', 'always'].flatMap(mode => [false, true].flatMap(review => {
  const adjusted = review ? 20 : 14;
  return [-1, 0, 1].map(offset => ({ mode, review, adjusted, ceiling: adjusted + offset, approve: offset >= 0 }));
}));

it.each(costCases)('checks $mode at ceiling $ceiling with review=$review', ({ mode, review, adjusted, ceiling, approve }) => {
  const decision = evaluatePlanAutoApproval({ ...plan, selfReview: review },
    { cesarAutoApproveMode: mode, cesarAutoApproveMaxCostUsd: ceiling }, { estimateReviewCostUsd: () => 3 });
  expect(decision.approve).toBe(approve);
  expect(decision.adjustedCostUsd).toBe(adjusted);
});

// Compile mutated copies in memory. Production files and package dist stay
// untouched, and type-only imports disappear during compilation.
function compile(source: string): Record<string, unknown> {
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const exports: Record<string, unknown> = {};
  runInNewContext(outputText, { exports }, { timeout: 1000 });
  return exports;
}
function mutateOnce(source: string, before: string, after: string): string {
  expect(source.split(before)).toHaveLength(2);
  return source.replace(before, after);
}

const selectionSource = readFileSync(new URL('../../packages/mod-plan/src/session-selection.ts', import.meta.url), 'utf8');
it.each([
  { name: 'adds an unapproved phrase', before: '|okay|sure)', after: '|okay|sure|never)' },
  { name: 'removes a supported phrase', before: '|okay|sure)', after: '|okay)' },
  { name: 'allows trailing instructions', before: '|okay|sure)$/i', after: '|okay|sure)/i' },
])('kills the phrase mutant that $name', ({ before, after }) => {
  const baseline = compile(selectionSource).isCesarPlanApprovalInput as PhraseCheck;
  const mutant = compile(mutateOnce(selectionSource, before, after)).isCesarPlanApprovalInput as PhraseCheck;
  expect(accepted(baseline)).toEqual(approvals);
  expect(accepted(mutant)).not.toEqual(approvals);
});

const costSource = readFileSync(new URL('../../packages/mod-plan/src/approval-policy.ts', import.meta.url), 'utf8');
it.each([
  { name: 'rejects equality', replacement: 'adjustedCostUsd >= costCeilingUsd' },
  { name: 'ignores the ceiling', replacement: 'false' },
])('kills the cost mutant that $name', ({ replacement }) => {
  const baseline = compile(costSource).evaluatePlanAutoApproval as typeof evaluatePlanAutoApproval;
  const mutant = compile(mutateOnce(costSource, 'adjustedCostUsd > costCeilingUsd', replacement))
    .evaluatePlanAutoApproval as typeof evaluatePlanAutoApproval;
  const observations = (evaluate: typeof evaluatePlanAutoApproval) => costCases.map(({ mode, review, ceiling }) =>
    evaluate({ ...plan, selfReview: review }, { cesarAutoApproveMode: mode, cesarAutoApproveMaxCostUsd: ceiling },
      { estimateReviewCostUsd: () => 3 }).approve);
  const expected = costCases.map(item => item.approve);
  expect(observations(baseline)).toEqual(expected);
  expect(observations(mutant)).not.toEqual(expected);
});
