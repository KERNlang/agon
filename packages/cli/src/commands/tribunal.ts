import { defineCommand } from 'citty';
import {
  EngineRegistry, ensureAgonHome, loadConfig,
  createRunDir, writeRunStatus, printRunSummary,
} from '@kernlang/agon-core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import type { ForgeEvent, RunStatusEngine } from '@kernlang/agon-core';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { isTribunalMode, runTribunal } from '@kernlang/agon-forge';
import type { TribunalMode } from '@kernlang/agon-forge';
import { header, fail, info, warn, bold, dim, red } from '../output.js';
import { filterDefaultOrchestrationEngines } from '../generated/handlers/engine-filter.js';

export const tribunalCommand = defineCommand({
  meta: {
    name: 'tribunal',
    description: 'Adversarial debate — engines argue different sides of a question',
  },
  args: {
    question: {
      type: 'positional',
      description: 'Question to debate',
      required: true,
    },
    rounds: {
      type: 'string',
      alias: 'r',
      description: 'Number of debate rounds',
      default: '2',
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    mode: {
      type: 'string',
      alias: 'm',
      description: 'Tribunal mode (adversarial, synthesis, steelman, socratic, red-team, postmortem)',
      default: 'adversarial',
    },
    timeout: {
      type: 'string',
      description: 'Timeout per engine in seconds',
      default: '120',
    },
    label: {
      type: 'string',
      description: 'Human-readable suffix baked into the run dir name.',
    },
    quiet: {
      type: 'boolean',
      description: 'Suppress streaming output; stdout becomes only the run dir path + final summary.',
    },
  },
  async run({ args }) {
    ensureAgonHome();
    const config = loadConfig(process.cwd());

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());

    const adapter = createCliAdapter(registry);
    const available = args.engines
      ? args.engines.split(',').map((s) => s.trim())
      : filterDefaultOrchestrationEngines(registry.activeIds(config));

    if (available.length < 2) {
      fail('Tribunal needs at least 2 engines. Only found: ' + (available.join(', ') || 'none'));
      process.exit(1);
    }

    // Cap at 4 engines for readability
    const engines = available.slice(0, 4);
    const rounds = parseInt(args.rounds, 10);
    const mode = String(args.mode ?? 'adversarial');
    if (!isTribunalMode(mode)) {
      fail(`Invalid tribunal mode: ${mode}`);
      info('Valid modes: adversarial, synthesis, steelman, socratic, red-team, postmortem');
      process.exit(1);
    }

    if (args.quiet) process.env.AGON_QUIET = '1';
    const startedAt = new Date().toISOString();
    const { path: outputDir } = createRunDir({
      mode: 'tribunal',
      label: args.label,
    });

    const quiet = process.env.AGON_QUIET === '1';
    if (!quiet) {
      header(`Tribunal: ${args.question}`);
      info(`Engines: ${engines.join(', ')}`);
      info(`Rounds: ${rounds}`);
      info(`Mode: ${mode}`);
      console.log('');
    }

    // Dogfood finding (2026-05-13): round-1 partial failures (e.g. gemini
    // empty output, kimi timeout) used to scroll past as a single warn
    // line and the user only saw "(failed to respond)" placeholders in
    // round 2's display. Collect every engine:failed event so the final
    // output can surface a clear "Engines that hit errors" section.
    const failedEngines: Array<{ engineId: string; phase: string; error: string }> = [];

    const result = await runTribunal({
      question: args.question,
      engines,
      rounds,
      mode: mode as TribunalMode,
      registry,
      adapter,
      timeout: parseInt(args.timeout, 10),
      outputDir,
      onEvent: (event: ForgeEvent) => {
        // engine:failed must always be collected (status.json depends on it),
        // but the human-readable round narration is suppressed under quiet
        // so stdout is only the run dir path + final summary.
        if ((event.type as string) === 'engine:failed') {
          const data: any = event.data ?? {};
          failedEngines.push({
            engineId: String(data.engineId ?? event.engineId ?? 'unknown'),
            phase: String(data.phase ?? 'dispatch'),
            error: String(data.error ?? 'unknown error'),
          });
          return;
        }
        if (quiet) return;
        if (event.data?.round) {
          const engineId = event.engineId;
          const position = event.data?.position;
          if (engineId && position) {
            info(`Round ${event.data.round}: ${bold(String(engineId))} (${String(position)})...`);
          }
        }
      },
    });

    // Authoritative outcome record. An engine that produced at least one
    // non-empty argument is 'ok'; if it appeared in failedEngines (timeout,
    // dispatch fail, empty output) it's 'error' with the captured detail.
    const failureByEngine = new Map<string, string>();
    for (const f of failedEngines) {
      const prev = failureByEngine.get(f.engineId);
      const text = `${f.phase}: ${f.error.length > 160 ? f.error.slice(0, 160) + '…' : f.error}`;
      failureByEngine.set(f.engineId, prev ? `${prev}; ${text}` : text);
    }
    const argCountByEngine = new Map<string, number>();
    for (const round of result.rounds) {
      for (const pos of round.positions) {
        const count = (pos.arguments ?? []).filter((a: string) => a && a.trim()).length;
        argCountByEngine.set(pos.engineId, (argCountByEngine.get(pos.engineId) ?? 0) + count);
      }
    }
    const engineStatuses: RunStatusEngine[] = engines.map((id: string) => {
      const failureDetail = failureByEngine.get(id);
      if (failureDetail) {
        return { id, status: 'error', detail: failureDetail };
      }
      const argCount = argCountByEngine.get(id) ?? 0;
      return argCount > 0
        ? { id, status: 'ok' as const, detail: `${argCount} arguments` }
        : { id, status: 'error' as const, detail: 'no arguments produced' };
    });
    const okCount = engineStatuses.filter((e) => e.status === 'ok').length;
    const status = {
      mode: 'tribunal',
      label: args.label,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: engineStatuses,
      summary: `${okCount}/${engines.length} engines argued across ${rounds} round(s) (mode=${mode})`,
      ok: okCount === engines.length,
    };
    writeRunStatus(outputDir, status);

    if (quiet) {
      printRunSummary(status);
      return;
    }

    // Display results
    for (const round of result.rounds) {
      console.log('');
      header(`Round ${round.round}`);
      for (const pos of round.positions) {
        console.log('');
        console.log(`  ${bold(pos.engineId)} ${dim(`(${pos.position})`)}`);
        // Show first 500 chars of argument
        const arg = pos.arguments[0] ?? '';
        const lines = arg.slice(0, 500).split('\n');
        for (const line of lines) {
          console.log(`  ${line}`);
        }
        if (arg.length > 500) console.log(`  ${dim('...(truncated)')}`);
      }
    }

    // Surface failures before the verdict — easy to miss if buried in
    // mid-run console.warn output. Dedupe by engineId so an engine that
    // failed both rounds doesn't double-print.
    if (failedEngines.length > 0) {
      const byEngine = new Map<string, Array<{ phase: string; error: string }>>();
      for (const f of failedEngines) {
        const arr = byEngine.get(f.engineId) ?? [];
        arr.push({ phase: f.phase, error: f.error });
        byEngine.set(f.engineId, arr);
      }
      console.log('');
      header('Engines that hit errors');
      for (const [engineId, fails] of byEngine.entries()) {
        warn(`${bold(engineId)} (${fails.length} failure${fails.length > 1 ? 's' : ''})`);
        for (const f of fails) {
          const snippet = f.error.length > 160 ? `${f.error.slice(0, 160)}…` : f.error;
          console.log(`  ${dim(f.phase)}: ${red(snippet)}`);
        }
      }
    }

    // Summary
    console.log('');
    header('Verdict');
    console.log('');
    console.log(result.summary);
    console.log('');
    info(dim(`Full debate saved: ${outputDir}`));
    printRunSummary(status);
  },
});
