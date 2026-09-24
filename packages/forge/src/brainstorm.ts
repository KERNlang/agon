import { createBrainstormRuntime } from '@kernlang/agon-mod-brainstorm';
// A06-BRAINSTORM-POLICY (KL-011): retain the legacy exports, not duplicate algorithms.
export { structuralScore, scoutScore, assignStances, fallbackParse } from '@kernlang/agon-mod-brainstorm';

import type { EngineAdapter } from '@kernlang/agon-core';
import type { BrainstormWorkflowOptions } from '@kernlang/agon-mod-brainstorm';

import { EngineRegistry, getRatings, createSidechainLogger, updateGlickoRanked, classifyTask, seedNewEnginesFromRegistry } from '@kernlang/agon-core';

import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';

import { dedupBrainstormDrafts } from './dedup-bridge.js';

import { preflightHealthFilter } from './health-check.js';

import { dispatchSeatWithRetry } from './seat-dispatch.js';

// A06-BRAINSTORM-HOST (KL-011): host effects only; the mod owns composition.
interface LegacyBrainstormOptions extends BrainstormWorkflowOptions {
  registry: EngineRegistry;
  adapter: EngineAdapter;
}

export const {
  calibrateConfidence, qualityScore, rankDrafts,
  collectRankedDrafts, runScout, runBrainstorm,
} = createBrainstormRuntime<LegacyBrainstormOptions>({
  readRatings: getRatings,
  buildPrompt: buildKernDraftPrompt,
  parseDraft: parseKernDraft,
  selectSeat: (opts, engineId) => {
    const engine = opts.registry.get(engineId);
    return (prompt, systemPrompt) => dispatchSeatWithRetry(opts.adapter, {
      engineId, engine, prompt, systemPrompt, textOnly: true,
      cwd: process.cwd(), mode: 'exec', timeout: opts.timeout,
      outputDir: opts.outputDir, signal: opts.signal,
    });
  },
  seed: opts => { seedNewEnginesFromRegistry(opts.registry); },
  preflight: opts => preflightHealthFilter({ engineIds: opts.engines, registry: opts.registry, adapter: opts.adapter, signal: opts.signal }),
  createLogger: createSidechainLogger,
  deduplicate: dedupBrainstormDrafts,
  updateRatings: (bids, question) => {
    const taskClass = classifyTask(question);
    const ranked = bids.map(b => ({ engineId: b.engineId, score: b.score ?? 0 }));
    updateGlickoRanked(ranked, taskClass, 'brainstorm');
  },
  selectWinner: (opts, engineId) => {
    const engine = opts.registry.get(engineId);
    return prompt => opts.adapter.dispatch({
      engine, prompt,
      systemPrompt: 'You are expanding on a winning brainstorm approach. Respond directly with your detailed analysis as plain text. Do NOT use tools, read files, or run commands.',
      textOnly: true, cwd: process.cwd(), mode: 'exec', timeout: opts.timeout,
      outputDir: opts.outputDir, signal: opts.signal,
    });
  },
});
