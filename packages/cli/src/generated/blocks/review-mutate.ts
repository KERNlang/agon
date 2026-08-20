import { mkdirSync } from 'node:fs';

import { join } from 'node:path';

import { discoverGate } from '@kernlang/agon-core';

import type { Mutant, MutationReport, EngineRegistry, EngineAdapter } from '@kernlang/agon-core';

import { runMutate } from '@kernlang/agon-forge';

import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';

import { renderMutationLines } from './mutate-render.js';

export interface ReviewMutationOptions {
  repoRoot: string;
  diff: string;
  outputDir: string;
  registry: EngineRegistry;
  adapter: EngineAdapter;
  engines: string[];
  semantic: boolean;
  lens?: string;
  testCmd?: string;
  buildCmd?: string;
  typecheckCmd?: string;
  maxMutants?: number;
  perMutantTimeoutSec?: number;
  totalBudgetSec?: number;
  signal?: AbortSignal;
}

/**
 * The first non-empty line of a multi-line error, capped at 200 chars — enough for a reader to recognise WHY the advisory pass produced nothing, without dumping a whole stack trace into the review output. Pure.
 */
export function firstLine(text: string|undefined|null): string {
  const head = (text ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return head.length > 200 ? `${head.slice(0, 200)}…` : head;
}

/**
 * Read the `agon review --mutate-test/--mutate-build/--mutate-lens` passthrough off the raw citty args. Without them the advisory pass can only use the discovered gate, so a suite that runs against a prebuilt dist all-survives with no in-command remedy. citty keeps kebab-case flags as literal keys, so both spellings are read. Lives here (not in review.ts) so the review command file stays a thin caller.
 */
export function reviewMutateOverrides(args: Record<string,unknown>): { testCmd?: string; buildCmd?: string; lens?: string } {
  const str = (key: string): string | undefined => {
    const raw = args[key];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  };
  return {
    testCmd: str('mutate-test') ?? str('mutateTest'),
    buildCmd: str('mutate-build') ?? str('mutateBuild'),
    lens: str('mutate-lens') ?? str('mutateLens'),
  };
}

/**
 * Run the advisory mutation pass over an already-resolved review diff and return the lines to print (heading included). Artifacts land in `<outputDir>/mutation/`, never in the review dir itself — engine dispatch writes `<engineId>-output.txt` and would otherwise overwrite the review's own per-engine evidence. NEVER throws and NEVER signals failure to the caller — a missing test command, an empty diff or a runtime error all come back as one explanatory line, so the review's exit code and consensus stay untouched.
 */
export async function runReviewMutation(opts: ReviewMutationOptions): Promise<string[]> {
  const heading = '\n▸ MUTATION (advisory)';
  try {
    if (!opts.diff.trim()) return [heading, '  skipped — no diff to mutate'];
    const testCmd = (opts.testCmd ?? '').trim() || discoverGate(opts.repoRoot).command.trim();
    if (!testCmd) {
      return [heading, '  skipped — no test command discovered (add a package.json test script or a `fitness:` brief line, or run `agon mutate --test "<cmd>"`)'];
    }
    // Never the review's own run dir — see the header note on engine-output
    // collision. mkdir here so runMutate never has to create it under a
    // half-written review.
    const mutationDir = join(opts.outputDir, 'mutation');
    try { mkdirSync(mutationDir, { recursive: true }); } catch { /* runMutate reports a real IO failure */ }
    // A lens implies the panel here too — the standalone command makes that
    // decision in resolveMutatePanel, and the advisory section must not be the
    // one surface where `--mutate-lens` quietly does nothing.
    const lens = (opts.lens ?? '').trim();
    const semantic = opts.semantic || lens.length > 0;
    const result = await runMutate({
      repoRoot: opts.repoRoot,
      diff: opts.diff,
      testCmd,
      buildCmd: opts.buildCmd,
      typecheckCmd: opts.typecheckCmd,
      engines: semantic ? filterDefaultOrchestrationEngines(opts.engines) : [],
      registry: opts.registry,
      adapter: opts.adapter,
      semantic,
      lens: lens || undefined,
      maxMutants: opts.maxMutants ?? 25,
      perMutantTimeoutSec: opts.perMutantTimeoutSec ?? 120,
      totalBudgetSec: opts.totalBudgetSec ?? 600,
      outputDir: mutationDir,
      signal: opts.signal,
    });
    const lines = [heading, `  test command: ${testCmd}`];
    if (result.lens) lines.push(`  semantic lens: ${result.lens}${opts.semantic ? '' : ' (--mutate-lens implies the AI panel)'}`);
    lines.push(...renderMutationLines(result.report, result.survivors, { grouped: true }));
    // Swallowing the failure must not swallow the FORENSICS: name the reason
    // ONCE. A red baseline is already rendered by the renderer's `skipped —`
    // line; repeating result.error there printed the same (uncapped) log twice,
    // which is exactly what firstLine() exists to prevent.
    if (!result.ok) {
      const baselineWhy = firstLine(result.report?.baselineError);
      const runWhy = firstLine(result.error);
      if (runWhy && runWhy !== baselineWhy) lines.push(`  run failed — ${runWhy}`);
      else if (!baselineWhy) lines.push('  run failed — no reason reported');
      lines.push(`  (advisory only — the review verdict above is unaffected)`);
    }
    // Name a path only when one EXISTS. Synthesizing `<dir>/mutation-report.json`
    // sent readers to a file that was never written whenever the run died
    // before persistence.
    if (result.reportPath) lines.push(`  Report: ${result.reportPath}`);
    else lines.push(`  (no report written — the run produced nothing to persist; see ${mutationDir})`);
    return lines;
  } catch (err) {
    // Advisory means advisory: swallow everything — but always point at the
    // subdir, which is where a partial mutation-report.json would have landed.
    return [
      heading,
      `  skipped — mutation pass failed: ${err instanceof Error ? err.message : String(err)}`,
      `  (report, if any, under ${join(opts.outputDir, 'mutation')})`,
    ];
  }
}
