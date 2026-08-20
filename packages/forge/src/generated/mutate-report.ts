import type { Mutant, MutationReport } from '@kernlang/agon-core';

/**
 * The one verdict every surface must print instead of a score when NOTHING was killed. A 0% score reads as 'weak tests'; the real cause is almost always that the suite never loaded the mutated file at all.
 */
export const MUTATE_ALL_SURVIVED_WARNING: string = 'every mutant survived — your tests may not be exercising the mutated source (prebuilt dist? workspace package imported from node_modules? wrong --test?) — try `--build "<your build cmd>"`';

/**
 * Spec Addendum A #4: the run produced a statistically meaningful pool (>= 5 mutants ran) and EVERY one survived. Not a weak-suite verdict — a run-validity verdict. Pure.
 */
export function allMutantsSurvived(report: MutationReport): boolean {
  if (!report.baselineOk) return false;
  const ran = report.killed + report.survived;
  return ran >= 5 && report.allSurvived === true && report.survived === ran;
}

/**
 * The line that replaces every success wording when killed + survived === 0. A run where nothing executed measured NOTHING about the tests; calling that 'no survivors' is the single most dishonest thing this mode could print. Pure.
 */
export function noMutantsRanLine(report: MutationReport): string {
  return `no mutants were run (${report.invalid} invalid / ${report.notRun} not run) — this run measured nothing about your tests`;
}

/**
 * THE mutation-report renderer — one implementation for every surface (`agon mutate`, the REPL, and `agon review --mutate`, which used to keep a second copy that drifted). Emits the all-survived warning FIRST (a 0% score is not a measurement), then the score, the honesty notes, and the survivors. `grouped: true` selects the review layout (indented heading, survivors grouped by file); the default is the flat mutate layout. Pure.
 */
export function formatMutationReportLines(report: MutationReport, survivors: Mutant[], opts?: {grouped?:boolean}): string[] {
  const grouped = opts?.grouped === true;
  const out: string[] = [];
  if (!report.baselineOk) {
    const why = report.baselineError ?? 'the sandbox baseline did not pass';
    out.push(grouped ? `  skipped — ${why}` : `mutation run aborted — ${why}`);
    return out;
  }
  const ran = report.killed + report.survived;
  // The warning LEADS: when nothing was killed the score is not a measurement.
  const warning = `⚠ ${MUTATE_ALL_SURVIVED_WARNING}`;
  if (allMutantsSurvived(report)) out.push(grouped ? `  ${warning}` : warning);
  let pct = 'n/a';
  if (report.score !== null) pct = `${Math.round(report.score * 100)}%`;
  const scoreLine = `${pct} — ${report.killed}/${ran} mutants killed, ${report.survived} survived`;
  out.push(grouped ? `  Mutation score ${scoreLine}` : `mutation score ${scoreLine}`);
  if (report.killedByTimeout > 0) out.push(`  ${report.killedByTimeout} killed by timeout (the mutated code hung — a hang counts as detected)`);
  if (report.invalid > 0) out.push(`  ${report.invalid} invalid (did not typecheck/build) — excluded from the score`);
  if (report.notRun > 0) {
    let why = 'aborted';
    if (report.budgetExhausted) why = 'budget';
    out.push(`  ${report.notRun} mutants not run (${why})`);
  }
  if (survivors.length === 0) {
    // Same honesty rule as mutateVerdictLine: "kills every mutant" is a claim
    // about the whole pool, so it needs the whole pool to have run.
    if (ran === 0) out.push(`  ⚠ ${noMutantsRanLine(report)}`);
    else if (report.invalid === 0 && report.notRun === 0) out.push('  ✓ no survivors — the tests kill every mutant on the mutated lines');
    else out.push(`  ⚠ no survivors among the ${ran} mutant(s) that ran — ${report.invalid} invalid, ${report.notRun} not run, so this is not a clean sweep`);
    return out;
  }
  // A semantic survivor names the lens it was proposed under: "the security
  // lens found a hole your tests ignore" is a different finding from "an
  // engine free-associated a bug", and the report must not blur the two.
  const label = (m: Mutant): string => (m.origin === 'semantic'
    ? `semantic/${m.engine ?? '?'}${m.lens ? ` lens:${m.lens}` : ''}`
    : m.operator);
  if (grouped) {
    const byFile = new Map<string, Mutant[]>();
    for (const m of survivors) {
      const key = m.file ?? '(unknown file)';
      const bucket = byFile.get(key);
      if (bucket) bucket.push(m);
      else byFile.set(key, [m]);
    }
    out.push(`  SURVIVORS (${survivors.length}) — wrong code your tests called green:`);
    for (const [file, mutants] of byFile) {
      out.push(`    ${file}`);
      for (const m of mutants) {
        out.push(`      L${m.line}  ${label(m)}  [${m.class}]`);
        out.push(`        - ${m.before.trim()}`);
        out.push(`        + ${m.after.trim()}`);
        if (m.rationale) out.push(`        why: ${m.rationale}`);
      }
    }
    return out;
  }
  for (const m of survivors) {
    out.push(`  ▸ ${m.file ?? '?'}:${m.line}  ${label(m)}  [${m.class}]`);
    out.push(`      - ${m.before.trim()}`);
    out.push(`      + ${m.after.trim()}`);
    if (m.rationale) out.push(`      why: ${m.rationale}`);
  }
  return out;
}

/**
 * The ` (lens: x)` fragment the verdict carries when the semantic panel was steered. Empty when no survivor was proposed under a lens — a mechanical run must never claim a focus it did not have. Pure.
 */
export function mutateLensSuffix(survivors: Mutant[]): string {
  const lenses: string[] = [];
  for (const m of survivors) {
    const lens = (m.lens ?? '').trim();
    if (lens && !lenses.includes(lens)) lenses.push(lens);
  }
  return lenses.length > 0 ? ` (lens: ${lenses.join(', ')})` : '';
}

/**
 * The single headline every surface prints after the findings — the CLI's `Verdict:` line, the REPL's dispatch and `agon call mutate`. All-survived outranks the survivor count (a 0% score is a broken RUN before it is a weak suite), a run where nothing executed can never claim success, and a CLEAN SWEEP (`your tests kill every mutant`) is only claimed when every generated mutant reached a verdict — invalid or not-run mutants downgrade it to `no survivors among the N that ran`. Pure.
 */
export function mutateVerdictLine(report: MutationReport, survivors: Mutant[]): {level:'success'|'warning', text:string} {
  if (allMutantsSurvived(report)) {
    return { level: 'warning', text: `${MUTATE_ALL_SURVIVED_WARNING} (${survivors.length} survivor(s) listed above)` };
  }
  // No survivors AND nothing ran is not a clean sweep — it is an empty run.
  if (report.killed + report.survived === 0) {
    return { level: 'warning', text: `${noMutantsRanLine(report)}.` };
  }
  if (survivors.length === 0) {
    // "your tests kill every mutant" is a claim about the WHOLE pool, so it
    // may only be made when the whole pool actually reached a verdict. With
    // invalid or not-run mutants the honest headline names what was measured
    // and what was not — otherwise a run that graded 1 of 40 mutants (39
    // invalid, or cancelled) prints a clean sweep.
    const ranCount = report.killed + report.survived;
    if (report.invalid === 0 && report.notRun === 0) {
      return { level: 'success', text: 'no survivors — your tests kill every mutant on the mutated lines.' };
    }
    const gaps: string[] = [];
    if (report.invalid > 0) gaps.push(`${report.invalid} invalid`);
    if (report.notRun > 0) gaps.push(`${report.notRun} not run`);
    return {
      level: 'warning',
      text: `no survivors among the ${ranCount} mutant(s) that ran (${gaps.join(', ')}) — the rest reached no verdict, so this is not a clean sweep.`,
    };
  }
  return { level: 'warning', text: `${survivors.length} survivor(s)${mutateLensSuffix(survivors)} — wrong code your tests called green. Advisory only: strengthen the assertions that should have failed.` };
}

/**
 * The advisory verdict block for `agon mutate`: score, timeout/invalid/not-run accounting, the all-survived warning, and one line per survivor. A thin join over formatMutationReportLines — the renderer lives in ONE place. Pure.
 */
export function formatMutateVerdict(report: MutationReport, survivors: Mutant[]): string {
  return formatMutationReportLines(report, survivors).join('\n');
}

/**
 * The line appended to a red baseline when mutate itself removed the sandbox's prebuilt output. Without it the user reads 'test command fails in the sandbox' and blames their deps. Pure.
 */
export function staleDistHint(cleared: string[]): string {
  return `the sandbox has no prebuilt ${cleared.join(', ')} — mutate cleared it because you are mutating that package's SOURCE, and a prebuilt bundle would make every mutant "survive". Pass \`--build "<build cmd>"\` so each mutant is compiled before the tests run.`;
}
