import { defineCommand } from 'citty';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EngineRegistry, ensureAgonHome, loadConfig,
  createRunDir, writeRunStatus, printRunSummary,
} from '@agon/core';
import type { RunStatusEngine } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import { resolveReviewTarget, runReviewCore, selectReviewEngine } from '../generated/handlers/review.js';
import { fail, header, info, warn, bold } from '../output.js';

export const reviewCommand = defineCommand({
  meta: {
    name: 'review',
    description: 'Run a non-interactive AI review of a diff target',
  },
  args: {
    target: {
      type: 'positional',
      description: 'Review target: uncommitted, branch:NAME, or commit:SHA',
      required: false,
      default: 'uncommitted',
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
  },
  async run({ args }) {
    ensureAgonHome();
    const cwd = process.cwd();
    const config = loadConfig(cwd);

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());
    const adapter = createCliAdapter(registry);

    const ctx = {
      config,
      registry,
      adapter,
      activeEngines: () => registry.activeIds(config),
    } as any;

    let target;
    try {
      target = resolveReviewTarget(args.target, cwd);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (!target.diff.trim()) {
      warn(`No diff found for ${target.label}.`);
      return;
    }

    const requested = args.engines
      ? args.engines.split(',').map((s) => s.trim()).filter(Boolean)
      : [selectReviewEngine(args.engine, ctx)];

    if (args.quiet) process.env.AGON_QUIET = '1';
    const startedAt = new Date().toISOString();
    const { path: outputDir } = createRunDir({
      mode: 'review',
      label: args.label,
    });

    const quiet = process.env.AGON_QUIET === '1';
    if (!quiet) {
      header(`Review: ${target.label}`);
      info(`Engines: ${requested.join(', ')}`);
    }

    // Authoritative outcome tracking. Each engine's status is one of:
    //   'ok'             — the review parser found the sentinel AND no blocking findings
    //   'blocking'       — review parsed cleanly but flagged blocking findings (the
    //                      orchestrator needs to know "the review failed your code",
    //                      not "the review succeeded"); confirmed in codex review
    //                      0.98-confidence on the previous draft of this file
    //   'parse-failure'  — engine returned prose but no sentinel JSON block (the Opus
    //                      feedback's "buried warning" case — now a structured status)
    //   'error'          — engine dispatch threw (timeout, missing binary, etc.)
    const engineStatuses: RunStatusEngine[] = [];
    for (const engineId of requested) {
      const engineStart = Date.now();
      if (!quiet) {
        console.log('');
        header(`Reviewer: ${bold(engineId)}`);
      }
      try {
        const result = await runReviewCore(target.diff, target.label, engineId, ctx);
        // Always write per-engine output, even in quiet mode — it's the
        // record orchestrators read after the run.
        try {
          writeFileSync(
            join(outputDir, `${engineId}-output.txt`),
            result.response ?? '',
          );
        } catch (writeErr) {
          // Per-engine write failures shouldn't kill the run.
          if (!quiet) warn(`${engineId}: failed to write output file (${writeErr instanceof Error ? writeErr.message : String(writeErr)})`);
        }
        if (!quiet) console.log(result.response);
        if (result.parseFailed) {
          if (!quiet) warn(`${engineId}: review parser did not find the sentinel JSON block.`);
          engineStatuses.push({
            id: engineId,
            status: 'parse-failure',
            durationMs: Date.now() - engineStart,
            detail: 'no sentinel JSON in response',
          });
        } else if (result.blocking) {
          if (!quiet) warn(`${engineId}: blocking findings reported.`);
          engineStatuses.push({
            id: engineId,
            status: 'blocking',
            durationMs: Date.now() - engineStart,
            detail: 'blocking findings',
          });
        } else {
          engineStatuses.push({
            id: engineId,
            status: 'ok',
            durationMs: Date.now() - engineStart,
            detail: 'parsed cleanly',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!quiet) fail(`${engineId}: ${message}`);
        engineStatuses.push({
          id: engineId,
          status: 'error',
          durationMs: Date.now() - engineStart,
          detail: message,
        });
      }
    }

    const okCount = engineStatuses.filter((e) => e.status === 'ok').length;
    // Summary names EVERY non-ok / non-skipped engine, grouped by failure
    // mode (blocking + parse-failure + error). Pre-fix the summary text
    // only named parse-failures, which hid hard engine crashes under a
    // misleading "X/Y reviewed cleanly" message.
    const failureGroups: string[] = [];
    for (const failureStatus of ['blocking', 'parse-failure', 'error', 'timeout'] as const) {
      const matched = engineStatuses
        .filter((e) => e.status === failureStatus)
        .map((e) => e.id);
      if (matched.length > 0) failureGroups.push(`${matched.join(', ')}: ${failureStatus}`);
    }
    const status = {
      mode: 'review',
      label: args.label,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: engineStatuses,
      summary: failureGroups.length > 0
        ? `${okCount}/${requested.length} reviewed cleanly; ${failureGroups.join('; ')}`
        : `${okCount}/${requested.length} reviewed cleanly`,
      ok: okCount === requested.length,
    };
    writeRunStatus(outputDir, status);
    printRunSummary(status);
  },
});
