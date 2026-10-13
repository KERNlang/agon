/**
 * Normalize the forge mode string; anything unrecognised is 'implement'.
 */
export function resolveForgeMode(mode?: string): 'implement'|'improve'|'validate' {
  const value = String(mode ?? 'implement').toLowerCase();
  if (value === 'improve' || value === 'validate') {
    return value as 'improve' | 'validate';
  }
  return 'implement';
}

export function resolveForgeRequireDiff(mode: 'implement'|'improve'|'validate', requireDiff?: boolean): boolean {
  if (typeof requireDiff === 'boolean') {
    return requireDiff;
  }
  return mode === 'implement';
}

export function resolveForgeAcceptReviewOutput(mode: 'implement'|'improve'|'validate', acceptReviewOutput?: boolean): boolean {
  if (typeof acceptReviewOutput === 'boolean') {
    return acceptReviewOutput;
  }
  return mode !== 'implement';
}

/**
 * Classify a zero-diff forge attempt. Keeps validation/no-op outcomes distinct from failed dispatch/tool-loop exhaustion.
 */
export function classifyNoDiffForgeResult(opts: {stdout:string, timedOut:boolean, exitCode:number, fitnessPassed:boolean, baselinePasses:boolean, mode:'implement'|'improve'|'validate', requireDiff:boolean, acceptReviewOutput:boolean}): {status:string,pass:boolean,score:number,engineCompleted:boolean,reason:string} {
  const stdout = String(opts.stdout ?? '');
  const normalized = stdout.replace(/\s+/g, ' ').trim();
  const toolLoopLimit = /tool loop limit|step tool loop limit|maximum tool loop|reached the \d+[- ]step tool loop limit/i.test(normalized);
  const engineCompleted = !opts.timedOut && Number(opts.exitCode) === 0 && !toolLoopLimit;
  const usefulReport = normalized.length >= 80;
  const noOpText = /\b(already|no changes?|nothing to change|no patch needed|already implemented|looks good|validated|no action needed)\b/i.test(normalized);

  if (toolLoopLimit) {
    return { status: 'no_patch_tool_limit', pass: false, score: 0, engineCompleted: false, reason: 'tool_loop_limit' };
  }
  if (!engineCompleted) {
    return { status: 'no_candidate_diff', pass: false, score: 0, engineCompleted: false, reason: opts.timedOut ? 'dispatch_timeout' : `dispatch_exit_${opts.exitCode}` };
  }
  if (!opts.fitnessPassed) {
    return { status: 'fitness_failed_no_diff', pass: false, score: 0, engineCompleted: true, reason: 'fitness_failed' };
  }
  if (noOpText && opts.baselinePasses) {
    const pass = !opts.requireDiff;
    return { status: 'no_op_validation', pass, score: pass ? 65 : 0, engineCompleted: true, reason: 'baseline_already_satisfied' };
  }
  if (usefulReport && (opts.acceptReviewOutput || opts.mode === 'validate')) {
    return { status: 'no_diff_but_report', pass: true, score: 60, engineCompleted: true, reason: 'review_output' };
  }
  if (!opts.requireDiff) {
    return { status: 'no_candidate_diff', pass: true, score: 50, engineCompleted: true, reason: 'diff_not_required' };
  }
  return { status: 'no_candidate_diff', pass: false, score: 0, engineCompleted: true, reason: 'diff_required' };
}
