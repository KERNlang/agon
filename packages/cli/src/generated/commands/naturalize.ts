import { defineCommand } from 'citty';

import { readFileSync, writeFileSync } from 'node:fs';

import { EngineRegistry, loadConfig, createRunDir, writeRunStatus } from '@kernlang/agon-core';

import type { RunStatus } from '@kernlang/agon-core';

import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

import { createCliAdapter } from '@kernlang/agon-adapter-cli';

import { runNaturalize } from '@kernlang/agon-forge';

import { header, success, fail, info, bold, yellow, dim } from '../blocks/output-format.js';

import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';

import { readStdin } from '../blocks/stdin.js';

export const naturalizeCommand: any = defineCommand({
  meta: {
    name: 'naturalize',
    description: 'Naturalize AI-written text: deterministic sanitize → non-author engine rewrite (writer ≠ rewriter) → re-scan → word-diff report. Honest about limits: keyed statistical watermarks are always reported as not assessable.',
  },
  args: {
    file: {
      type: 'positional',
      description: 'File to naturalize (omit to read stdin)',
      required: false,
    },
    engine: {
      type: 'string',
      description: 'Engine id to rewrite with. Omit to use the first active engine (≠ --author when given).',
    },
    author: {
      type: 'string',
      description: 'Engine that wrote the text (e.g. claude) — the rewriter is forced to differ (writer ≠ rewriter).',
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Write naturalized output to this file instead of stdout',
    },
    timeout: {
      type: 'string',
      description: 'Rewrite dispatch timeout in seconds',
      default: '120',
    },
    minChange: {
      type: 'string',
      description: 'Minimum lexical change required (percent 0-100). Retries with a stronger brief, then REFUSES to emit if the rewrite stays too close to the original — the honest proxy for statistical-watermark destruction.',
    },
    maxAttempts: {
      type: 'string',
      description: 'Max rewrite attempts when --min-change is set',
      default: '2',
    },
    jsonl: {
      type: 'boolean',
      description: 'Emit the report as machine-readable JSONL',
      default: false,
    },
  },
  async run({ args }) {
    let input: string;
    try {
      input = args.file ? readFileSync(args.file as string, 'utf8') : await readStdin();
    } catch (err) {
      fail(`Cannot read ${args.file}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    if (!input.trim()) {
      fail('No input text to naturalize.');
      process.exit(1);
    }

    const config = loadConfig();
    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());
    const adapter = createCliAdapter(registry);
    const active = filterDefaultOrchestrationEngines(registry.activeIds(config as any));
    const author = typeof args.author === 'string' && args.author.trim() ? registry.resolveId(args.author.trim()) : undefined;
    const candidates = author ? active.filter((id) => id !== author) : active;
    const engineId = (typeof args.engine === 'string' && args.engine.trim())
      ? registry.resolveId(args.engine.trim())
      : candidates[0];
    if (!engineId) {
      fail(author
        ? `No active engines other than the author '${author}'. Add one with \`agon engine add <id>\`.`
        : 'No active engines. Run `agon engine list` or `agon engine add <id>`.');
      process.exit(1);
    }

    const timeoutSec = parseInt(String(args.timeout ?? '120'), 10) || 120;
    // citty keeps kebab-case flags as literal keys — normalize up front.
    const minChangeArg = args.minChange ?? args['min-change'];
    const maxAttemptsArg = args.maxAttempts ?? args['max-attempts'];
    let minChange: number | undefined;
    if (minChangeArg !== undefined && String(minChangeArg).trim() !== '') {
      const pct = Number(String(minChangeArg).trim());
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        fail(`Invalid --min-change '${minChangeArg}' — expected a number 0-100 (0 disables the threshold). Refusing to run without the guaranteed gate.`);
        process.exit(1);
      }
      minChange = pct > 0 ? pct / 100 : undefined; // explicit 0 = threshold off
    }
    const maxAttempts = Math.max(1, parseInt(String(maxAttemptsArg ?? '2'), 10) || 2);
    const startedAt = new Date().toISOString();
    const { path: outputDir } = createRunDir({ mode: 'naturalize', label: undefined, announce: false });
    const source = (args.file as string | undefined) ?? 'stdin';

    if (!args.jsonl) {
      header(`Naturalize: ${source} · rewriter ${bold(engineId)}${author ? ` (author: ${author})` : ''}${minChange !== undefined ? ` · min-change ${Math.round(minChange * 100)}%` : ''}`);
    }

    const result = await runNaturalize({
      input,
      engineId,
      registry,
      adapter,
      author,
      timeout: timeoutSec,
      outputDir,
      cwd: process.cwd(),
      minChange,
      maxAttempts,
    });

    const status: RunStatus = {
      mode: 'naturalize',
      label: undefined,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: [{
        id: engineId,
        status: result.ok ? 'ok' : 'error',
        detail: result.ok
          ? `${result.changedWords} word(s) changed (${Math.round((1 - result.unchangedRatio) * 100)}% lexical change)`
          : (result.error ?? 'naturalize failed'),
      }],
      summary: result.ok
        ? `${engineId}: naturalized (${result.initialFindings} initial finding(s), ${result.changedWords} word(s) changed)`
        : `${engineId}: ${result.error ?? 'naturalize failed'}`,
      ok: result.ok,
      requested: [engineId],
      timeoutSec,
    };
    writeRunStatus(outputDir, status);

    if (!result.ok) {
      if (args.jsonl) {
        process.stdout.write(`${JSON.stringify({ type: 'naturalize.error', source, engine: engineId, error: result.error, timestamp: new Date().toISOString() })}\n`);
      } else {
        fail(result.error ?? 'Naturalize failed.');
      }
      process.exit(1);
    }

    if (args.jsonl) {
      process.stdout.write(`${JSON.stringify({
        type: 'naturalize.result',
        source,
        engine: engineId,
        author: author ?? null,
        initialFindings: result.initialFindings,
        rewriteCleaned: result.rewriteCleaned,
        finalClean: result.finalClean,
        wordsBefore: result.wordsBefore,
        wordsAfter: result.wordsAfter,
        changedWords: result.changedWords,
        unchangedRatio: result.unchangedRatio,
        attempts: result.attempts,
        minChange: minChange ?? null,
        minChangeMet: result.minChangeMet ?? null,
        residualNotAssessable: result.residualNotAssessable,
        output: result.output,
        timestamp: new Date().toISOString(),
      })}\n`);
    } else {
      success(`Re-scan clean — no character-level hidden channels in the rewrite${result.rewriteCleaned ? ' (engine re-introduced channels; deterministically cleaned again)' : ''}.`);
      info(`Diff: ${result.wordsBefore} → ${result.wordsAfter} words, ${result.changedWords} changed (${Math.round((1 - result.unchangedRatio) * 100)}% lexical change)${result.attempts > 1 ? ` over ${result.attempts} attempts` : ''}.`);
      if (result.minChangeMet === true) success(`Lexical-change threshold met (≥ ${Math.round((minChange ?? 0) * 100)}%) — original token stream destroyed; a keyed statistical watermark is very unlikely to survive.`);
      info(`${yellow('Residual / not assessable:')} ${result.residualNotAssessable.join('; ')}`);
      info(dim(`Saved: ${outputDir}`));
    }

    if (args.out) {
      writeFileSync(args.out as string, result.output, 'utf8');
      if (!args.jsonl) success(`Naturalized output written to ${bold(args.out as string)}.`);
    } else if (!args.jsonl) {
      process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    }
  },
});
