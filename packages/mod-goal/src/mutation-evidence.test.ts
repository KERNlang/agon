import { describe, expect, it } from 'vitest';

import { gradeMutationAssessment } from './mutation-evidence.js';

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

  it('goal-multilang: an invalid count that disagrees with the outcomes is fatal', () => {
    const result = gradeMutationAssessment(assessment([outcome('a.go', 'killed'), outcome('a.go', 'invalid', 'non-compiling')], 0));
    expect(result.ok).toBe(false);
  });
});
