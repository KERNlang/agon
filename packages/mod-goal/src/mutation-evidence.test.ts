import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { explicitCheckBlocker, gradeMutationAssessment } from './mutation-evidence.js';

const outcome = (file: string, status: string, invalidCause?: string) => ({
  status, ...(invalidCause ? { invalidCause } : {}),
  mutant: { file, class: 'high-signal' as const, line: 1, operator: 'op' },
});

const assessment = (outcomes: any[], invalid = outcomes.filter(o => o.status === 'invalid').length) => ({
  ok: true,
  report: { baselineOk: true, aborted: false, budgetExhausted: false, notRun: 0, invalid, generated: outcomes.length, outcomes },
});

describe('gradeMutationAssessment', () => {
  it('goal-multilang: grades a mixed report and excludes non-compiling mutants', () => {
    const result = gradeMutationAssessment(assessment([outcome('a.go', 'killed'), outcome('a.go', 'invalid', 'non-compiling')]));
    expect(result).toEqual({ ok: true, graded: [outcome('a.go', 'killed')], nonCompiling: 1 });
  });

  it('goal-multilang: a file whose every mutant is non-compiling is not evidence', () => {
    const result = gradeMutationAssessment(assessment([
      outcome('a.go', 'killed'), outcome('b.go', 'invalid', 'non-compiling'), outcome('b.go', 'invalid', 'non-compiling'),
    ]));
    expect(result).toEqual({ ok: false, error: 'mutation assessment produced no gradable mutants for b.go (2 non-compiling)', nonCompiling: 2 });
  });

  it.each([
    ['an unplaceable mutant', [outcome('a.go', 'killed'), outcome('a.go', 'invalid', 'unplaceable')]],
    ['an unknown status', [outcome('a.go', 'killed'), outcome('a.go', 'error')]],
    ['a blank file', [outcome(' ', 'killed')]],
    ['an unknown class', [{ ...outcome('a.go', 'killed'), mutant: { ...outcome('a.go', 'killed').mutant, class: 'other' } }]],
  ])('goal-multilang: %s is fatal', (_label, outcomes) => {
    expect(gradeMutationAssessment(assessment(outcomes)).ok).toBe(false);
  });

  it.each([
    ['not ok', { ok: false }],
    ['a red baseline', { baselineOk: false }],
    ['an aborted run', { aborted: true }],
    ['an exhausted budget', { budgetExhausted: true }],
    ['unrun mutants', { notRun: 1 }],
    ['a generated count that disagrees', { generated: 2 }],
  ])('goal-multilang: %s is fatal', (_label, patch: Record<string, unknown>) => {
    const base = assessment([outcome('a.go', 'killed')]);
    const mutation = 'ok' in patch ? { ...base, ...patch } : { ...base, report: { ...base.report, ...patch } };
    expect(gradeMutationAssessment(mutation)).toEqual({ ok: false, error: 'mutation assessment failed: incomplete verification evidence', nonCompiling: 0 });
  });

  it('goal-multilang: a report of only non-compiling mutants is not evidence', () => {
    expect(gradeMutationAssessment(assessment([outcome('a.go', 'invalid', 'non-compiling')])))
      .toEqual({ ok: false, error: 'mutation assessment produced no gradable mutants (1 non-compiling)', nonCompiling: 1 });
  });

  it('goal-multilang: a diff that generated no mutants grades as empty evidence', () => {
    expect(gradeMutationAssessment(assessment([]))).toEqual({ ok: true, graded: [], nonCompiling: 0 });
  });

  it('goal-multilang: only an invalid mutant counts as non-compiling', () => {
    expect(gradeMutationAssessment(assessment([outcome('a.go', 'killed', 'non-compiling')])))
      .toEqual({ ok: true, graded: [outcome('a.go', 'killed', 'non-compiling')], nonCompiling: 0 });
  });

  it('goal-multilang: an invalid count that disagrees with the outcomes is fatal', () => {
    const result = gradeMutationAssessment(assessment([outcome('a.go', 'killed'), outcome('a.go', 'invalid', 'non-compiling')], 0));
    expect(result.ok).toBe(false);
  });
});

describe('explicitCheckBlocker', () => {
  const diff = (file: string) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,1 @@\n-int a = 1;\n+int a = 2;\n`;

  it('goal-multilang: a C diff without a check names the file and both flags', () => {
    expect(explicitCheckBlocker(diff('src/a.c'), tmpdir())).toBe(
      'mutation needs an explicit compile check for src/a.c: rerun goal with --mutate-typecheck "<cmd>" or --mutate-build "<cmd>"');
  });

  it.each([
    ['a build command', 'make', undefined],
    ['a typecheck command', undefined, 'cc -fsyntax-only src/a.c'],
  ])('goal-multilang: %s clears the C block', (_label, build, typecheck) => {
    expect(explicitCheckBlocker(diff('src/a.c'), tmpdir(), build, typecheck)).toBeUndefined();
  });

  it('goal-multilang: a blank command does not count as a check', () => {
    expect(explicitCheckBlocker(diff('src/a.c'), tmpdir(), '  ', ' ')).toBeDefined();
  });
});
