import { defineCommand } from 'citty';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EngineRegistry, ensureAgonHome, loadConfig,
  createRunDir, writeRunStatus, printRunSummary,
} from '@kernlang/agon-core';
import type { RunStatusEngine } from '@kernlang/agon-core';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import { resolveReviewTarget, runReviewCore, selectReviewEngine, extractReviewFindings } from '../generated/handlers/review.js';
import { buildConsensus, formatConsensusRow } from '../generated/blocks/consensus.js';
import { fail, header, info, warn, bold } from '../output.js';

// A captured "review" that is really just the claude TUI's collapsed-paste
// placeholder ("[Pasted text #1 +34 lines]") is not a review — it means the
// prompt never actually submitted (the pty paste bug). Treat it as no output
// rather than storing the placeholder as if it were a real reviewer verdict.
const PASTE_PLACEHOLDER_RE = /\[Pasted text(?:\s*#\d+)?\s*\+\d+\s*lines?\]/i;
// Global variant for stripping (the non-global one above is reused by .test(),
// which would carry lastIndex state if it were /g). Removes EVERY placeholder
// token so multi-placeholder captures can't evade the emptiness check.
const PASTE_PLACEHOLDER_STRIP_RE = /\[Pasted text(?:\s*#\d+)?\s*\+\d+\s*lines?\]/gi;
export function isPastePlaceholderOnly(text: string): boolean {
  const stripped = text.replace(PASTE_PLACEHOLDER_STRIP_RE, '').replace(/[\s·•]+/g, '');
  // If removing the placeholder(s) (and trivial separators/PR refs) leaves
  // almost nothing, the capture was the placeholder, not a review.
  return PASTE_PLACEHOLDER_RE.test(text) && stripped.replace(/PR#?\d+/gi, '').length < 16;
}

// Render findings counts as a consistent human tail: "1 blocking, 2 important,
// 3 nits" (zero categories omitted; "no findings" when the block was empty).
function formatSeverityCounts(c?: { blocking: number; important: number; nit: number; total: number }): string {
  if (!c || c.total === 0) return 'no findings';
  const parts: string[] = [];
  if (c.blocking) parts.push(`${c.blocking} blocking`);
  if (c.important) parts.push(`${c.important} important`);
  if (c.nit) parts.push(`${c.nit} ${c.nit === 1 ? 'nit' : 'nits'}`);
  return parts.join(', ');
}

export const reviewCommand = defineCommand({
  meta: {
    name: 'review',
    description: 'Run a non-interactive AI review of a diff target',
  },
  args: {
    target: {
      type: 'positional',
      description: 'Review target: uncommitted, branch:NAME, commit:SHA, or range:BASE...TARGET',
      required: false,
      default: 'uncommitted',
    },
    base: {
      type: 'string',
      description: 'Explicit diff base ref. With "uncommitted": diff working tree vs BASE. With "branch:NAME": diff BASE...NAME (checkout-independent).',
    },
    engine: {
      type: 'string',
      description: 'Specific engine for review',
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    label: {
      type: 'string',
      description: 'Human-readable suffix baked into the run dir name.',
    },
    quiet: {
      type: 'boolean',
      description: 'Suppress streaming output; stdout becomes only the run dir path + final summary. Per-engine output is still written to <run-dir>/<engineId>-output.txt.',
    },
    timeout: {
      type: 'string',
      description: 'Per-engine hard wall-clock timeout in seconds. When an engine exceeds it its dispatch is aborted and marked timeout; other engines are unaffected. Default: config.reviewTimeout or 420.',
    },
    maxParallel: {
      type: 'string',
      alias: 'p',
      description: 'Max engines to review concurrently. Default: all at once. Lower it (e.g. 2) if parallel API engines hit rate limits or first-chunk stalls.',
    },
    verbose: {
      type: 'boolean',
      alias: 'v',
      description: 'After the consensus summary, print each engine\'s FULL review inline (the raw walls). Without it, full reviews stay in the run dir (the pointer line is always printed).',
    },
  },
  async run({ args }) {
    ensureAgonHome();
    const cwd = process.cwd();
    const config = loadConfig(cwd);

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());
    const adapter = createCliAdapter(registry);

    // Resolve the per-engine hard timeout. CLI flag wins over config default.
    // We mutate the loaded config copy so runReviewCore's inner dispatchOpts
    // honor the SAME wall clock — the orchestrator-level abort below is then a
    // belt-and-suspenders that fires even if a dispatch path's own timeout
    // misbehaves (e.g. a kimi/zai API stream that stalls mid-response).
    const parsedTimeout = args.timeout != null ? Number(String(args.timeout).trim()) : NaN;
    const timeoutSec = Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? Math.floor(parsedTimeout)
      : ((config as any).reviewTimeout ?? (config as any).agentTimeout ?? 420);
    // Give the inner dispatch a grace buffer above the orchestrator wall clock
    // so the orchestrator's AbortController always fires FIRST — that keeps the
    // outcome classified as 'timeout' (deterministic) instead of racing the
    // dispatch's own timer (which would surface as an empty parse-failure). The
    // buffer is also the safety net if an abort somehow fails to propagate.
    (config as any).reviewTimeout = timeoutSec + 30;

    const ctx = {
      config,
      registry,
      adapter,
      activeEngines: () => registry.activeIds(config),
    } as any;

    // Definite-assignment assertion: the catch below always exits the process,
    // so target is assigned before any use — but kern-guard's stricter config
    // doesn't treat process.exit() as terminating, so assert it explicitly.
    let target!: { diff: string; label: string };
    try {
      target = resolveReviewTarget(args.target, cwd, args.base);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (!target.diff.trim()) {
      warn(`No diff found for ${target.label}.`);
      return;
    }

    // Dedupe AFTER alias resolution: 'kimi' and 'kimi-for-coding-k2p6' resolve
    // to the same id, and with parallel execution duplicates would otherwise
    // run concurrently and race on the same <engineId>-output.txt.
    const requested = args.engines
      ? Array.from(new Set(args.engines.split(',').map((s) => registry.resolveId(s.trim())).filter(Boolean)))
      : [selectReviewEngine(args.engine, ctx)];

    const parsedParallel = args.maxParallel != null ? Number(String(args.maxParallel).trim()) : NaN;
    const maxParallel = Number.isFinite(parsedParallel) && parsedParallel > 0
      ? Math.floor(parsedParallel)
      : requested.length;

    if (args.quiet) process.env.AGON_QUIET = '1';
    const startedAt = new Date().toISOString();
    const { path: outputDir } = createRunDir({
      mode: 'review',
      label: args.label,
    });

    const quiet = process.env.AGON_QUIET === '1';
    const concurrencyNote = requested.length > 1
      ? (maxParallel >= requested.length ? 'all in parallel' : `${maxParallel} at a time`)
      : 'single engine';
    if (!quiet) {
      header(`Review: ${target.label}`);
      info(`Repo: ${cwd}`);
      info(`Engines: ${requested.join(', ')} (${concurrencyNote})`);
      info(`Per-engine timeout: ${timeoutSec}s (auto-cancel, others unaffected)`);
    }

    // Each engine's status is one of: 'ok' | 'blocking' | 'parse-failure' |
    // 'unstructured' | 'timeout' | 'error'. Engines run in PARALLEL — each gets
    // its own AbortController + hard wall clock, so a slow-but-excellent reviewer
    // (codex) never blocks the others and a hung engine (kimi/zai API stall)
    // can't wedge the run. Total wall time is the slowest engine, not the sum.
    // Each engine's human output is buffered and flushed as ONE block when it
    // finishes — token-interleaving across concurrent engines would be unreadable.
    // Parsed findings per engine (only ok/blocking engines), fed to buildConsensus
    // after the run for the cross-engine tiered verdict.
    const findingsByEngine = new Map<string, unknown[]>();
    const captureFindings = (engineId: string, rawResponse: string) => {
      const raw = extractReviewFindings(rawResponse) || [];
      findingsByEngine.set(engineId, raw.map((x: any) => ({
        engine: engineId,
        severity: typeof x.severity === 'string' ? x.severity : (x.blocking ? 'blocking' : 'nit'),
        blocking: x.blocking,
        confidence: x.confidence,
        file: x.file, lines: x.lines, problem: x.problem, minimalFix: x.minimalFix,
      })));
    };
    const reviewEngine = async (engineId: string): Promise<RunStatusEngine> => {
      const engineStart = Date.now();
      const outputPath = join(outputDir, `${engineId}-output.txt`);
      const writeOutput = (text: string) => {
        try { writeFileSync(outputPath, text); }
        catch (writeErr) { if (!quiet) console.log(`\n⚠ ${engineId}: failed to write output file (${writeErr instanceof Error ? writeErr.message : String(writeErr)})`); }
      };
      // Flush a single labeled block so concurrent engines never interleave mid-line.
      const flush = (body: string[]) => { if (!quiet && body.length) console.log(`\n▸ Reviewer: ${bold(engineId)}\n${body.join('\n')}`); };
      // One dispatch attempt under its own wall clock. Pin the engine dispatch to
      // the SAME cwd the diff came from (process.cwd()). Without this cwdOverride,
      // runReviewCore falls back to resolveWorkingDir() = the active workspace — so
      // `agon review` run from repo X dispatched every engine into the
      // active-workspace repo (e.g. agon's own source) to gather file context,
      // while reviewing X's diff. The reviewers "never saw the code" the diff
      // referenced. Passing cwd keeps diff + engine context in one repo.
      const attempt = async (attemptTimeoutSec: number): Promise<
        { kind: 'ok'; result: Awaited<ReturnType<typeof runReviewCore>> } | { kind: 'timeout'; afterSec: number } | { kind: 'error'; message: string }
      > => {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, attemptTimeoutSec * 1000);
        try {
          const result = await runReviewCore(target.diff, target.label, engineId, ctx, controller.signal, undefined, cwd);
          // Keep partial text on disk for forensics, but the outcome is a timeout
          // regardless of what runReviewCore returned on abort.
          if (timedOut) { writeOutput(result.response ?? ''); return { kind: 'timeout', afterSec: attemptTimeoutSec }; }
          return { kind: 'ok', result };
        } catch (err) {
          if (timedOut) return { kind: 'timeout', afterSec: attemptTimeoutSec };
          return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
        } finally {
          clearTimeout(timer);
        }
      };
      // Transient flake (timeout / hard dispatch error) gets ONE retry at half
      // the wall clock before the seat is reported failed — a 6-engine review
      // must not quietly complete as a 4-engine committee. Parse failures are
      // NOT retried here; they already have their own in-band repair pass.
      let outcome = await attempt(timeoutSec);
      let retryNote = '';
      if (outcome.kind !== 'ok') {
        const firstKind = outcome.kind;
        // Half the wall clock, floored at 60s, but never LONGER than the first
        // attempt — a sub-120s --timeout must not get a bigger retry budget.
        const retryTimeoutSec = Math.min(timeoutSec, Math.max(60, Math.floor(timeoutSec / 2)));
        outcome = await attempt(retryTimeoutSec);
        retryNote = outcome.kind === 'ok'
          ? ` (${firstKind} on first attempt → retried OK)`
          : ` (${firstKind} → retried, failed again)`;
      }
      {
        if (outcome.kind === 'timeout') {
          // Report the wall clock that actually fired — the retry runs shorter
          // than the original timeoutSec, and diagnostics must not claim otherwise.
          flush([`⚠ timed out after ${outcome.afterSec}s — aborted${retryNote}.`]);
          return { id: engineId, status: 'timeout', durationMs: Date.now() - engineStart, detail: `exceeded ${outcome.afterSec}s per-engine timeout${retryNote}`, outputPath };
        }
        if (outcome.kind === 'error') {
          flush([`✖ ${outcome.message}${retryNote}`]);
          return { id: engineId, status: 'error', durationMs: Date.now() - engineStart, detail: `${outcome.message}${retryNote}`, outputPath };
        }
        const result = outcome.result;
        const rawResponse = result.response ?? '';
        writeOutput(rawResponse);
        // The full prose review is written to <outputPath> (writeOutput above).
        // We deliberately do NOT echo it inline — only a one-line status per
        // engine, then the cross-engine consensus. The consensus IS the
        // summary; the full text lives in the run dir for on-demand reading.
        // Every terminal path carries retryNote: a seat that only answered on
        // its second attempt must say so whatever verdict that answer produced.
        if (isPastePlaceholderOnly(rawResponse)) {
          // The capture is the claude TUI paste placeholder, not a review — the
          // prompt never submitted. Never count this as a real verdict.
          flush([`⚠ captured a paste placeholder, not a review (prompt likely never submitted)${retryNote}.`]);
          return { id: engineId, status: 'parse-failure', durationMs: Date.now() - engineStart, detail: `captured paste placeholder — prompt never submitted${retryNote}`, outputPath };
        }
        if (result.parseFailed && result.unstructured) {
          // Substantive prose review but no machine-parseable verdict even after
          // the repair retry. Still useful to a human — surface as a SUCCESS.
          flush([`${bold(engineId)}: unstructured (no machine verdict — full review in ${outputPath})${retryNote}`]);
          return { id: engineId, status: 'unstructured', durationMs: Date.now() - engineStart, detail: `unstructured review (no machine-parseable findings block)${retryNote}`, outputPath };
        }
        if (result.parseFailed) {
          flush([`⚠ returned no usable review output${retryNote}.`]);
          return { id: engineId, status: 'parse-failure', durationMs: Date.now() - engineStart, detail: `empty or unusable response${retryNote}`, outputPath };
        }
        const counts = formatSeverityCounts(result.severityCounts);
        captureFindings(engineId, rawResponse);
        if (result.blocking) {
          flush([`⚠ ${bold(engineId)}: blocking, ${counts}${retryNote}`]);
          return { id: engineId, status: 'blocking', durationMs: Date.now() - engineStart, detail: `blocking, ${counts}${retryNote}`, outputPath };
        }
        flush([`${bold(engineId)}: ok, ${counts}${retryNote}`]);
        return { id: engineId, status: 'ok', durationMs: Date.now() - engineStart, detail: `ok, ${counts}${retryNote}`, outputPath };
      }
    };

    // Concurrency-limited parallel runner. results[i] always corresponds to
    // requested[i] (stable order in the manifest) even though engines finish
    // out of order. Default cap = every engine at once; --max-parallel throttles.
    const engineStatuses: RunStatusEngine[] = new Array(requested.length);
    let cursor = 0;
    const pump = async (): Promise<void> => {
      for (;;) {
        const i = cursor++;
        if (i >= requested.length) return;
        engineStatuses[i] = await reviewEngine(requested[i]);
      }
    };
    const workerCount = Math.max(1, Math.min(maxParallel, requested.length));
    await Promise.all(Array.from({ length: workerCount }, () => pump()));

    // 'unstructured' is a successful review (useful prose, no machine verdict),
    // so it counts toward the reviewed total and never appears as a failure.
    const reviewedCount = engineStatuses.filter((e) => e.status === 'ok' || e.status === 'unstructured').length;
    const unstructuredCount = engineStatuses.filter((e) => e.status === 'unstructured').length;
    // Summary names EVERY genuine-failure engine, grouped by failure mode
    // (blocking + parse-failure + error + timeout). Pre-fix the summary text
    // only named parse-failures, which hid hard engine crashes under a
    // misleading "X/Y reviewed cleanly" message.
    const failureGroups: string[] = [];
    for (const failureStatus of ['blocking', 'parse-failure', 'error', 'timeout'] as const) {
      const matched = engineStatuses
        .filter((e) => e.status === failureStatus)
        .map((e) => e.id);
      if (matched.length > 0) failureGroups.push(`${matched.join(', ')}: ${failureStatus}`);
    }
    const reviewedNote = unstructuredCount > 0
      ? `${reviewedCount}/${requested.length} reviewed (${unstructuredCount} unstructured)`
      : `${reviewedCount}/${requested.length} reviewed cleanly`;
    const status = {
      mode: 'review',
      label: args.label,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: engineStatuses,
      requested,
      timeoutSec,
      summary: failureGroups.length > 0
        ? `${reviewedNote}; ${failureGroups.join('; ')}`
        : reviewedNote,
      ok: reviewedCount === requested.length,
    };
    writeRunStatus(outputDir, status);
    printRunSummary(status);

    // CONSENSUS — fold every engine's parsed findings into one tiered verdict
    // under the two-signal rule. ok/blocking engines contribute structured
    // findings; unstructured/parse-failure/timeout/error engines land in the
    // engineFailures lane (never a phantom blocker).
    const outcomes = requested.map((id) => {
      const st = engineStatuses.find((e) => e.id === id);
      const ok = st && (st.status === 'ok' || st.status === 'blocking');
      return ok
        ? { engine: id, status: 'ok', findings: (findingsByEngine.get(id) || []) as any[] }
        : { engine: id, status: st?.status ?? 'error', findings: [] as any[] };
    });
    const consensus = buildConsensus(outcomes as any);
    // Render each row via the shared KERN formatter so the CLI and the REPL
    // attribute identically: compact engine badges ([codex][kimi]) instead of
    // ×N, a `⚠ DISPUTED` prefix + indented per-engine stance lines when engines
    // materially disagree on the same clustered finding. `'  '` pad matches the
    // existing two-space indentation of the consensus block.
    const lines: string[] = [''];
    // Degraded-run honesty: fewer than quorum engines reviewed → warn BEFORE the
    // consensus so a 1/6 run isn't read as a real consensus. Not a hard block.
    if (consensus.degraded) lines.push(`  ${consensus.degraded.warning}`);
    lines.push(`▸ Consensus — ${consensus.summary}`);
    if (consensus.verified.length) { lines.push('  VERIFIED (actionable):'); for (const f of consensus.verified) for (const l of formatConsensusRow(f, '  ')) lines.push(l); }
    if (consensus.needsCheck.length) { lines.push('  NEEDS-CHECK (want a second opinion):'); for (const f of consensus.needsCheck) for (const l of formatConsensusRow(f, '  ')) lines.push(l); }
    if (consensus.speculative.length) lines.push(`  SPECULATIVE: ${consensus.speculative.length} low-confidence finding(s) — likely noise.`);
    if (consensus.nits.length) lines.push(`  NITS: ${consensus.nits.length}.`);
    console.log(lines.join('\n'));

    if (!quiet) info(`Full per-engine reviews: ${outputDir}`);

    // --verbose: print each engine's FULL review inline after the consensus, so
    // the raw walls are reachable without opening the run dir. The run-dir
    // pointer above still prints (the per-engine *-output.txt files remain the
    // canonical artifact); this just inlines them for convenience.
    if (args.verbose && !quiet) {
      // Soft per-engine cap so a 6-engine panel of full-prose reviews (each up
      // to the 100K diff-derived review) can't dump ~600KB to the terminal. Past
      // the cap we print the head and point at the canonical run-dir artifact.
      const VERBOSE_BODY_MAX = 50_000;
      for (const id of requested) {
        const st = engineStatuses.find((e) => e.id === id);
        let body = '';
        try {
          body = readFileSync(join(outputDir, `${id}-output.txt`), 'utf-8').trim();
        } catch { /* engine wrote no output (timeout/error before any text) */ }
        console.log(`\n${'─'.repeat(60)}\n▸ Full review: ${bold(id)}${st ? ` (${st.status})` : ''}\n${'─'.repeat(60)}`);
        if (body.length > VERBOSE_BODY_MAX) {
          console.log(`${body.slice(0, VERBOSE_BODY_MAX)}\n… [truncated — ${body.length} chars; full review in ${join(outputDir, `${id}-output.txt`)}]`);
        } else {
          console.log(body || '(no review text captured)');
        }
      }
    }
  },
});
