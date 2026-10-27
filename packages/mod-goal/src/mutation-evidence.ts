import { changedLinesFromDiff, filesNeedingExplicitCheck } from '@kernlang/agon-support-worktree';

export interface GoalMutationOutcome {
  status: string;
  invalidCause?: string;
  mutant: { file: string; class: 'high-signal' | 'equiv-prone'; line: number; operator: string; [key: string]: unknown };
}

export type GoalMutationEvidence =
  | { ok: true; graded: GoalMutationOutcome[]; nonCompiling: number }
  | { ok: false; error: string; nonCompiling: number };

const GRADED_STATUSES = ['killed', 'survived', 'timeout'];

function isNonCompiling(outcome: any): boolean {
  return outcome?.status === 'invalid' && outcome?.invalidCause === 'non-compiling';
}

/**
 * Turn a mutation assessment into gradable evidence. A mutant that does not compile proves nothing about the tests, so it is excluded from grading; every other invalid or incomplete result is fatal.
 */
export function gradeMutationAssessment(mutation: Record<string, any>): GoalMutationEvidence {
  const report = mutation.report;
  const outcomes: any[] = Array.isArray(report?.outcomes) ? report.outcomes : [];
  const nonCompiling = outcomes.filter(isNonCompiling).length;
  if (mutation.ok !== true || report?.baselineOk !== true || report.aborted === true ||
      report.budgetExhausted === true || report.notRun > 0 || (report.invalid ?? 0) !== nonCompiling ||
      !Array.isArray(report.outcomes) || report.generated !== outcomes.length || outcomes.some(outcome =>
        !(GRADED_STATUSES.includes(outcome?.status) || isNonCompiling(outcome)) ||
        typeof outcome?.mutant?.file !== 'string' || !outcome.mutant.file.trim() ||
        !['high-signal', 'equiv-prone'].includes(outcome?.mutant?.class))) {
    return { ok: false, error: `mutation assessment failed: ${String(mutation.error ?? 'incomplete verification evidence')}`, nonCompiling };
  }
  const graded = outcomes.filter(outcome => GRADED_STATUSES.includes(outcome.status));
  if (graded.length === 0 && nonCompiling > 0) {
    return { ok: false, error: `mutation assessment produced no gradable mutants (${nonCompiling} non-compiling)`, nonCompiling };
  }
  const gradedFiles = new Set(graded.map(outcome => outcome.mutant.file));
  const ungraded = outcomes.filter(outcome => !gradedFiles.has(outcome.mutant.file));
  if (ungraded.length > 0) {
    const files = [...new Set(ungraded.map(outcome => outcome.mutant.file))].join(', ');
    return { ok: false, error: `mutation assessment produced no gradable mutants for ${files} (${ungraded.length} non-compiling)`, nonCompiling };
  }
  return { ok: true, graded, nonCompiling };
}

/**
 * The configuration error for a diff that touches a compiled language with no default compile check, or undefined when mutation can run as configured.
 */
export function explicitCheckBlocker(taskDiff: string, repoRoot: string, buildCmd?: string, typecheckCmd?: string): string | undefined {
  const explicitCheck = Boolean(buildCmd?.trim() || typecheckCmd?.trim());
  const files = filesNeedingExplicitCheck(Object.keys(changedLinesFromDiff(taskDiff)), explicitCheck, repoRoot);
  if (files.length === 0) return undefined;
  return `mutation needs an explicit compile check for ${files.join(', ')}: rerun goal with --mutate-typecheck "<cmd>" or --mutate-build "<cmd>"`;
}
