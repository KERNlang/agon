import { readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync, cpSync } from 'node:fs';

import { join, dirname, resolve } from 'node:path';

import { tmpdir } from 'node:os';

import { randomUUID } from 'node:crypto';

import { execFileSync } from 'node:child_process';

import type { EngineAdapter, EngineRegistry, Mutant, MutationReport } from '@kernlang/agon-core';

import { generateMutants, runMutants, worktreeCreate, worktreeRemoveBestEffort, headSha, resolveWithinRoot } from '@kernlang/agon-core';

import { compileChecksFor, explicitCheckNotice, filesNeedingExplicitCheck, profileFor } from '@kernlang/agon-support-worktree';

import { resolveMutateTargets } from './mutate-targets.js';

export { isMutableFile, mutationTargetsFromDiff } from './mutate-targets.js';

import { collectSemanticMutants, normalizeLens } from './mutate-semantic.js';

import type { SemanticTarget } from './mutate-semantic.js';

import { prepareNodeSandbox } from './mutate-sandbox.js';

import { formatMutateVerdict, staleDistHint } from './mutate-report.js';

export interface MutateOptions {
  repoRoot: string;
  testCmd: string;
  engines: string[];
  registry: EngineRegistry;
  adapter: EngineAdapter;
  semantic: boolean;
  maxMutants: number;
  perMutantTimeoutSec: number;
  totalBudgetSec: number;
  outputDir: string;
  diff?: string;
  files?: string[];
  typecheckCmd?: string;
  buildCmd?: string;
  semanticPerEngine?: number;
  lens?: string;
  timeout?: number;
  cwd?: string;
  signal?: AbortSignal;
  onEvent?: (e:{type:string,data?:Record<string,unknown>})=>void;
}

export interface MutateResult {
  ok: boolean;
  report: MutationReport;
  survivors: Mutant[];
  byFile: Record<string, Mutant[]>;
  verdict: string;
  costUsd: number;
  engineCalls: number;
  lens?: string;
  label: string;
  outputDir: string;
  panelHealth?: { requested:number; responded:number; degraded:boolean; notes:string[]; banner:string|null };
  reportPath?: string;
  error?: string;
}

/**
 * Per-file ceiling on the untracked work copied into the sandbox (5 MiB). A stray recording or database dump must not turn hydration into a minutes-long copy; the skip is logged so the cause of a red baseline is never a mystery.
 */
export const MAX_UNTRACKED_FILE_BYTES: number = 5242880;

/**
 * Ceiling on how many untracked files are copied. Beyond this the working tree is not 'uncommitted work' any more, and hydration would dominate the run.
 */
export const MAX_UNTRACKED_FILES: number = 2000;

/**
 * Collapse mutants that produce the SAME mutated line in the same place — (file, line, after). First wins, so a semantic mutant placed ahead of the mechanical pool keeps its rationale. Pure.
 */
export function dedupeMutants(mutants: Mutant[]): Mutant[] {
  const seen = new Set<string>();
  const out: Mutant[] = [];
  for (const m of mutants) {
    const key = `${m.file ?? ''}|${m.line}|${m.after}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Cap the pool at `max`: high-signal mutants first, then equiv-prone, then anything else, and inside each class ROUND-ROBIN across files so one hot file cannot eat the whole budget. Order within a file is preserved. Pure.
 */
export function selectMutants(mutants: Mutant[], max: number): Mutant[] {
  if (max <= 0) return [];
  if (mutants.length <= max) return mutants;
  const picked: Mutant[] = [];
  const known: string[] = ['high-signal', 'equiv-prone'];
  // The trailing bucket catches any class the Mutant type gains later: a new
  // value must never be silently excluded from every capped pool.
  const classes: string[] = [...known, ''];
  for (const cls of classes) {
    const byFile = new Map<string, Mutant[]>();
    for (const m of mutants) {
      const matches = cls === '' ? !known.includes(m.class) : m.class === cls;
      if (!matches) continue;
      const key = m.file ?? '';
      const queue = byFile.get(key);
      if (queue) queue.push(m);
      else byFile.set(key, [m]);
    }
    const queues = [...byFile.values()];
    let progressed = true;
    while (picked.length < max && progressed) {
      progressed = false;
      for (const queue of queues) {
        if (queue.length === 0) continue;
        const next = queue.shift();
        if (next) picked.push(next);
        progressed = true;
        if (picked.length >= max) break;
      }
    }
    if (picked.length >= max) break;
  }
  return picked;
}

/**
 * Make the HEAD sandbox match the user's working tree: apply `git diff --binary HEAD`, then copy EVERY untracked non-ignored regular file (not just the target sources — an untracked test, fixture, config or helper the suite needs would otherwise be missing and the baseline would fail for an invisible reason). Returns how many untracked files were copied. Throws the user-facing message when the patch will not apply (binary targets, submodules, partially-staged hunks are the known unsupported paths).
 */
function hydrateWorktree(repoRoot: string, worktree: string): number {
  let patch = '';
  try {
    patch = execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`could not read uncommitted changes (git diff HEAD failed): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (patch.trim()) {
    try {
      execFileSync('git', ['apply', '--binary', '--whitespace=nowarn', '-'], { cwd: worktree, input: patch, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim() ?? (err instanceof Error ? err.message : String(err));
      throw new Error(`uncommitted changes could not be applied to the sandbox — commit/stash or pass \`--diff <base>\` (git apply: ${detail.slice(0, 300)})`);
    }
  }
  let untracked: string[] = [];
  try {
    untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf-8' })
      .split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  } catch { /* nothing untracked we can see — the patch already covered tracked work */ }
  let copied = 0;
  let skipped = 0;
  for (const rel of untracked) {
    if (copied >= MAX_UNTRACKED_FILES) { skipped += 1; continue; }
    const src = join(repoRoot, rel);
    let dst = '';
    try { dst = resolveWithinRoot(worktree, rel); } catch { skipped += 1; continue; }
    let size = 0;
    try {
      const st = lstatSync(src);
      if (!st.isFile()) continue; // directories are implied, symlinks are not followed
      size = st.size;
    } catch { continue; }
    if (size > MAX_UNTRACKED_FILE_BYTES) { skipped += 1; continue; }
    try {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
      copied += 1;
    } catch { skipped += 1; }
  }
  if (skipped > 0) console.warn(`[agon] mutate: ${skipped} untracked file(s) were NOT copied into the sandbox (too large, too many, or unreadable)`);
  return copied;
}

/**
 * Resolve targets -> mechanical mutants -> hydrated HEAD sandbox -> optional semantic panel (dispatched FROM that sandbox) -> dedupe -> cap -> run -> verdict + mutation-report.json. Never throws: operational failures come back as ok:false with `error` and a verdict line the caller can print.
 */
export async function runMutate(opts: MutateOptions): Promise<MutateResult> {
  const repoRoot = resolve(opts.repoRoot);
  const testCmd = String(opts.testCmd ?? '').trim();
  const emptyReport = (): MutationReport => ({
    testCmd, worktree: '', generated: 0, killed: 0, survived: 0, invalid: 0,
    timeouts: 0, killedByTimeout: 0, notRun: 0, score: null, outcomes: [],
    budgetExhausted: false, aborted: false, allSurvived: false, baselineMs: 0, baselineOk: false,
    baselineError: undefined,
  });
  let label = 'mutate';
  let engineCalls = 0;
  // Normalized ONCE: the prompt, the events and every surface must name the
  // same lens, and the raw flag is user text that has not been capped yet.
  const lensKey = opts.semantic ? (normalizeLens(opts.lens)?.key ?? '') : '';
  const fail = (error: string): MutateResult => ({
    ok: false, report: emptyReport(), survivors: [], byFile: {},
    verdict: `mutate failed: ${error}`, costUsd: 0, engineCalls, label, outputDir: opts.outputDir, error,
    lens: lensKey || undefined,
  });

  if (!testCmd) return fail('no test command discovered — pass `--test <cmd>`');

  // ── 1. Targets ──
  const explicitCheck = Boolean(opts.buildCmd?.trim() || opts.typecheckCmd?.trim());
  const resolved = resolveMutateTargets({ repoRoot, diff: opts.diff, files: opts.files, allowGeneric: opts.semantic && explicitCheck, wantGeneric: opts.semantic });
  if (resolved.error) return fail(resolved.error);
  const targets = resolved.targets;
  if (resolved.skippedGeneric.length > 0) {
    const message = `semantic: skipping ${resolved.skippedGeneric.length} file(s) with no language profile (${resolved.skippedGeneric.join(', ')}) — pass --build or --typecheck so a mutant that does not compile is graded invalid, not killed`;
    opts.onEvent?.({ type: 'mutate:notice', data: { message, files: resolved.skippedGeneric } });
  }
  const needsCheck = filesNeedingExplicitCheck(Object.keys(targets), explicitCheck, repoRoot);
  for (const file of needsCheck) delete targets[file];
  if (needsCheck.length > 0) {
    opts.onEvent?.({ type: 'mutate:notice', data: { message: explicitCheckNotice(needsCheck), files: needsCheck } });
  }

  const sources: Record<string, string> = {};
  const sourceLines: Record<string, string[]> = {};
  for (const file of Object.keys(targets)) {
    const abs = join(repoRoot, file);
    if (!existsSync(abs)) { delete targets[file]; continue; }
    const text = readFileSync(abs, 'utf-8');
    sources[file] = text;
    sourceLines[file] = text.split('\n');
  }
  const targetFiles = Object.keys(targets);
  if (targetFiles.length === 0) {
    const skipped = [...resolved.skippedGeneric, ...needsCheck];
    const why = skipped.length > 0 ? ` (skipped without --build/--typecheck: ${skipped.join(', ')})` : '';
    return fail(`no mutable (non-test) source files in the target${why}`);
  }
  label = `mutate-${targetFiles.length}-file${targetFiles.length === 1 ? '' : 's'}`;
  opts.onEvent?.({ type: 'mutate:targets', data: { files: targetFiles.length, lines: Object.values(targets).reduce((n, l) => n + l.length, 0) } });

  // ── 2. Mechanical mutants ──
  const mechanical: Mutant[] = [];
  for (const file of targetFiles) {
    const profile = profileFor(file);
    if (profile) mechanical.push(...generateMutants(sources[file], targets[file], file, profile));
  }

  // ── 3. Isolated, hydrated sandbox — built BEFORE any engine sees the code ──
  const worktree = join(tmpdir(), `agon-mutate-${randomUUID().slice(0, 8)}`);
  let report: MutationReport;
  let clearedDist: string[] = [];
  let untrackedCopied = 0;
  let panelHealth: MutateResult['panelHealth'];
  try {
    worktreeCreate(repoRoot, worktree, headSha(repoRoot));
  } catch (err) {
    return fail(`worktree creation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    untrackedCopied = hydrateWorktree(repoRoot, worktree);
    const sandbox = prepareNodeSandbox(repoRoot, worktree, targetFiles);
    clearedDist = sandbox.clearedDist;
    opts.onEvent?.({
      type: 'mutate:sandbox',
      data: {
        worktree,
        mutants: mechanical.length,
        ...sandbox.eventData,
        untrackedCopied,
        ...(sandbox.node ? { needsBuild: clearedDist.length > 0 && !opts.buildCmd } : {}),
      },
    });

    // ── 4. Semantic mutants (panel fan-out FROM the sandbox, read-only) ──
    let semantic: Mutant[] = [];
    if (opts.semantic && opts.engines.length > 0) {
      const semTargets: SemanticTarget[] = targetFiles.map((file) => ({
        file,
        lines: targets[file]
          .map((line) => ({ line, text: sourceLines[file][line - 1] ?? '' }))
          .filter((l) => l.text.trim().length > 0),
      }));
      try {
        const sem = await collectSemanticMutants({
          targets: semTargets,
          sources: sourceLines,
          engines: opts.engines,
          registry: opts.registry,
          adapter: opts.adapter,
          perEngine: Math.max(1, opts.semanticPerEngine ?? 8),
          timeout: opts.timeout ?? 180,
          outputDir: opts.outputDir,
          cwd: worktree,
          lens: opts.lens,
          signal: opts.signal,
          onEvent: opts.onEvent,
        });
        semantic = sem.mutants;
        panelHealth = sem.panelHealth;
        engineCalls = sem.calls;
      } catch (err) {
        console.warn(`[agon] mutate: semantic panel failed, continuing with mechanical mutants only: ${err instanceof Error ? err.message : String(err)}`);
      }
      opts.onEvent?.({ type: 'mutate:semantic', data: { accepted: semantic.length, calls: engineCalls, lens: lensKey } });
    }

    // ── 5. Dedupe + cap (semantic first so its rationale survives the dedupe) ──
    const pool = selectMutants(dedupeMutants([...semantic, ...mechanical]), Math.max(1, opts.maxMutants));
    if (pool.length === 0) return fail('no mutants generated for the target lines');
    opts.onEvent?.({ type: 'mutate:pool', data: { total: pool.length, semantic: semantic.length, mechanical: mechanical.length } });

    report = await runMutants({
      worktree,
      mutants: pool,
      testCmd,
      perMutantTimeoutSec: opts.perMutantTimeoutSec,
      totalBudgetSec: opts.totalBudgetSec,
      typecheckCmd: opts.typecheckCmd,
      buildCmd: opts.buildCmd,
      compileChecks: explicitCheck ? undefined : compileChecksFor(targetFiles, repoRoot),
      signal: opts.signal,
      onProgress: (p) => opts.onEvent?.({ type: 'mutate:progress', data: { ...p } }),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    worktreeRemoveBestEffort(repoRoot, worktree);
  }

  // ── 6. Verdict + artifact ──
  // A red baseline right after we cleared the package's prebuilt output is
  // almost certainly OUR doing — say so instead of letting the user hunt deps,
  // and name what the sandbox was actually given.
  if (!report.baselineOk) {
    const extra: string[] = [];
    if (clearedDist.length > 0 && !opts.buildCmd) extra.push(staleDistHint(clearedDist));
    extra.push(`the sandbox was hydrated from your working tree (untracked files were copied: ${untrackedCopied})`);
    const base = report.baselineError ?? 'the sandbox baseline did not pass';
    report = { ...report, baselineError: `${base}${extra.map((e) => `\n  → ${e}`).join('')}` };
  }
  const survivors = report.outcomes.filter((o) => o.status === 'survived').map((o) => o.mutant);
  const byFile: Record<string, Mutant[]> = {};
  for (const m of survivors) {
    const key = m.file ?? '';
    const bucket = byFile[key];
    if (bucket) bucket.push(m);
    else byFile[key] = [m];
  }
  let reportPath: string | undefined;
  try {
    mkdirSync(opts.outputDir, { recursive: true });
    reportPath = join(opts.outputDir, 'mutation-report.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (err) {
    reportPath = undefined;
    console.warn(`[agon] mutate: could not write mutation-report.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  const verdict = formatMutateVerdict(report, survivors);
  opts.onEvent?.({ type: 'mutate:done', data: { score: report.score, survivors: survivors.length } });
  // A green baseline does not prove that later commands could run.
  const ok = report.baselineOk && !report.aborted && !report.baselineError;
  let error = report.baselineError;
  if (!error && report.aborted) error = `aborted — the run was cancelled after ${report.killed + report.survived} of ${report.generated} mutants had a verdict; the partial score is not evidence about your tests`;
  return {
    ok,
    report,
    survivors,
    byFile,
    verdict,
    costUsd: 0,
    engineCalls,
    lens: lensKey || undefined,
    label,
    outputDir: opts.outputDir,
    panelHealth,
    reportPath,
    error,
  };
}
