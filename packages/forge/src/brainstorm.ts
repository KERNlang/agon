import { createBrainstormWorkflow, createBrainstormScoring, createBrainstormCollector, createBrainstormScout } from '@kernlang/agon-mod-brainstorm';
// A06-BRAINSTORM-POLICY (KL-011): retain the legacy exports, not duplicate algorithms.
export { structuralScore, scoutScore, assignStances, fallbackParse } from '@kernlang/agon-mod-brainstorm';

import type { EngineAdapter } from '@kernlang/agon-core';

import { EngineRegistry, getRatings, createSidechainLogger, updateGlickoRanked, classifyTask, seedNewEnginesFromRegistry } from '@kernlang/agon-core';

import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';

import { dedupBrainstormDrafts } from './dedup-bridge.js';

import { preflightHealthFilter } from './health-check.js';

import { dispatchSeatWithRetry } from './seat-dispatch.js';

export const { calibrateConfidence, qualityScore, rankDrafts } = createBrainstormScoring(getRatings);


// A06-BRAINSTORM-HOST (KL-011): temporary capability adapter, not a second workflow owner.
type LegacyBrainstormOptions = {question:string, context?:string, engines:string[], style?:string, registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, signal?:AbortSignal, onEvent?:(event:{type:string,data?:Record<string,unknown>})=>void};
export const collectRankedDrafts = createBrainstormCollector<LegacyBrainstormOptions>({
  buildPrompt: buildKernDraftPrompt,
  parseDraft: parseKernDraft,
  rankDrafts,
  selectSeat: (opts, engineId) => {
    const engine = opts.registry.get(engineId);
    return (prompt, systemPrompt) => dispatchSeatWithRetry(opts.adapter, {
      engineId, engine, prompt, systemPrompt, textOnly: true,
      cwd: process.cwd(), mode: 'exec', timeout: opts.timeout,
      outputDir: opts.outputDir, signal: opts.signal,
    });
  },
});

export const runScout = createBrainstormScout<LegacyBrainstormOptions & { scoutCount?: number }>({
  preflight: opts => preflightHealthFilter({ engineIds: opts.engines, registry: opts.registry, adapter: opts.adapter, signal: opts.signal }),
  collect: (opts, engines, timeout) => collectRankedDrafts({
    question: opts.question, context: opts.context, engines,
    registry: opts.registry, adapter: opts.adapter, timeout,
    outputDir: opts.outputDir, signal: opts.signal,
  }),
  calibrateConfidence,
});

export const runBrainstorm = createBrainstormWorkflow<LegacyBrainstormOptions>({
  seed: opts => { seedNewEnginesFromRegistry(opts.registry); },
  preflight: opts => preflightHealthFilter({ engineIds: opts.engines, registry: opts.registry, adapter: opts.adapter, signal: opts.signal }),
  createLogger: createSidechainLogger,
  collect: (opts, engines, style) => collectRankedDrafts({ ...opts, engines, style }),
  qualityScore,
  calibrateConfidence,
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
