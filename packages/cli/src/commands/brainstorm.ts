import { defineCommand } from 'citty';
import {
  EngineRegistry, ensureAgonHome, loadConfig,
  createRunDir, writeRunStatus, printRunSummary,
} from '@kernlang/agon-core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import type { BrainstormBid, BrainstormResult } from '@kernlang/agon-core';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { runBrainstorm } from '@kernlang/agon-forge';
import { header, info, warn, table, bold, green } from '../output.js';
import { icons } from '../icons.js';
import { filterDefaultOrchestrationEngines } from '../generated/handlers/engine-filter.js';

export const brainstormCommand = defineCommand({
  meta: {
    name: 'brainstorm',
    description: 'Confidence-bidding brainstorm — engines bid, highest-quality answer wins (quality = substance + calibrated confidence)',
  },
  args: {
    question: {
      type: 'positional',
      description: 'Question to brainstorm',
      required: true,
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    timeout: {
      type: 'string',
      description: 'Timeout in seconds',
      default: '120',
    },
    label: {
      type: 'string',
      description: 'Human-readable suffix baked into the run dir name (orchestrators: distinguish parallel runs without grep).',
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

    if (args.quiet) process.env.AGON_QUIET = '1';
    const startedAt = new Date().toISOString();
    const { path: outputDir } = createRunDir({
      mode: 'brainstorm',
      label: args.label,
    });

    const quiet = process.env.AGON_QUIET === '1';
    if (!quiet) {
      header(`Brainstorm: ${args.question}`);
      info(`Engines: ${available.join(', ')}`);
    }

    const seatState = new Map<string, { ok: boolean; detail: string }>();
    let result: BrainstormResult;
    try {
      result = await runBrainstorm({
        question: args.question,
        engines: available,
        registry,
        adapter,
        timeout: parseInt(args.timeout, 10),
        outputDir,
        onEvent: (event) => {
          const data = event.data as Record<string, unknown> | undefined;
          if (event.type === 'brainstorm:seat-completed' && typeof data?.engineId === 'string') {
            const ok = data.ok === true;
            const detail = ok
              ? `${Number(data.attempts ?? 1)} attempt(s)`
              : String(data.detail ?? data.failure ?? 'no usable response');
            seatState.set(data.engineId, { ok, detail });
            if (!quiet) info(`${ok ? icons().success : icons().fail} ${data.engineId}: ${detail}`);
          }
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const failedStatus = {
        mode: 'brainstorm',
        label: args.label,
        startedAt,
        endedAt: new Date().toISOString(),
        engines: available.map((id: string) => ({
          id,
          status: 'error' as const,
          detail: seatState.get(id)?.detail ?? detail,
        })),
        summary: detail,
        ok: false,
      };
      writeRunStatus(outputDir, failedStatus);
      printRunSummary(failedStatus);
      throw err;
    }

    // Authoritative outcome record. A bid entry counts as 'ok' (engine
    // participated with a confidence); missing engines collapse to 'error'.
    const bidByEngine = new Map<string, BrainstormBid>();
    for (const b of result.bids) bidByEngine.set(b.engineId, b);
    const engineStatuses = available.map((id: string) => {
      const bid = bidByEngine.get(id);
      return bid
        ? { id, status: 'ok' as const, detail: `confidence=${bid.confidence}` }
        : { id, status: 'error' as const, detail: 'no bid returned' };
    });
    const okCount = engineStatuses.filter((e) => e.status === 'ok').length;
    const status = {
      mode: 'brainstorm',
      label: args.label,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: engineStatuses,
      summary: `${okCount}/${available.length} bid; winner=${result.winner}; synthesis=${result.synthesis?.status ?? 'unknown'}; dedup=${result.dedup?.status ?? 'unknown'}${result.panelHealth?.banner ? `; ${result.panelHealth.banner}` : ''}`,
      // Synthesis fallback still returns the ranked winning draft. Panel
      // participation determines success; synthesis status carries degradation.
      ok: okCount === available.length,
    };
    writeRunStatus(outputDir, status);

    if (quiet) {
      printRunSummary(status);
      return;
    }

    // Panel health is non-negotiable output: a retried or dropped seat must be
    // visible in the final render, not just in mid-run console.warn noise.
    if (result.panelHealth?.banner) {
      console.log('');
      warn(result.panelHealth.banner);
    }
    if (result.dedup && !['applied', 'not-needed'].includes(result.dedup.status)) {
      warn(`Dedup ${result.dedup.status}${result.dedup.detail ? `: ${result.dedup.detail}` : ''}`);
    }
    if (result.synthesis?.status === 'fallback') {
      warn(`Synthesis fallback: ${result.synthesis.detail ?? 'winner expansion failed; showing ranked drafts'}`);
    }

    console.log('');
    header('Bids');
    // Quality is the actual ranking key (answer substance + calibrated
    // confidence); the winner is the top Quality, not the top Confidence.
    // Show both so the winner is legible.
    const rows = result.bids.map((b: BrainstormBid) => [
      b.engineId === result.winner ? green(`${icons().winner} ${b.engineId}`) : b.engineId,
      b.score != null ? String(Math.round(b.score)) : '—',
      String(b.confidence),
      b.reasoning.slice(0, 60),
    ]);
    table(['Engine', 'Quality', 'Confidence', 'Reasoning'], rows);

    console.log('');
    header(`Response from ${bold(result.winner)}`);
    console.log(result.response);
    printRunSummary(status);
  },
});
