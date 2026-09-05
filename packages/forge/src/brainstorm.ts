import { createBrainstormWorkflow, createBrainstormScoring, scoutScore, assignStances, fallbackParse } from '@kernlang/agon-mod-brainstorm';
// A06-BRAINSTORM-POLICY (KL-011): retain the legacy exports, not duplicate algorithms.
export { structuralScore, scoutScore, assignStances, fallbackParse } from '@kernlang/agon-mod-brainstorm';

import type { EngineAdapter, ScoutBid } from '@kernlang/agon-core';

import { EngineRegistry, getRatings, createSidechainLogger, updateGlickoRanked, classifyTask, seedNewEnginesFromRegistry } from '@kernlang/agon-core';

import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';

import type { KernDraft } from '@kernlang/protocol';

import { dedupBrainstormDrafts } from './dedup-bridge.js';

import { preflightHealthFilter } from './health-check.js';

import { dispatchSeatWithRetry } from './seat-dispatch.js';

import type { SeatOutcome } from './seat-dispatch.js';

export const { calibrateConfidence, qualityScore, rankDrafts } = createBrainstormScoring(getRatings);

export async function collectRankedDrafts(opts: {question:string, context?:string, engines:string[], style?:string, registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, signal?:AbortSignal, onEvent?:(event:{type:string,data?:Record<string,unknown>})=>void}): Promise<{ranked:{engineId:string, draft:KernDraft, raw:string, seat:SeatOutcome}[], outcomes:SeatOutcome[]}> {
  const draftPrompt = buildKernDraftPrompt({
    question: opts.question,
    context: opts.context,
    mode: 'brainstorm',
  });

  // Divergent style: each seat gets a distinct stance so the panel actually
  // spreads out instead of six engines converging on the stated framing.
  // The stance rides in the system prompt — the protocol draft prompt stays
  // byte-identical so the draft-block output contract is undisturbed.
  const stances = opts.style === 'divergent' ? assignStances(opts.engines) : null;
  const baseSystemPrompt = 'You are participating in a brainstorm. Respond directly with your analysis and approach. Do NOT use tools, do NOT read files, do NOT run commands. Just think and write your response as plain text.';

  const draftPromises = opts.engines.map(async (engineId: string) => {
    const engine = opts.registry.get(engineId);
    opts.onEvent?.({ type: 'brainstorm:seat-started', data: { engineId } });
    const stance = stances?.get(engineId);
    const systemPrompt = stance
      ? [
          baseSystemPrompt,
          '',
          `Your seat stance — ${stance}`,
          'The question may be over-specified: treat its framing as one hypothesis about the underlying problem, not a hard constraint. If a better framing exists, say so in the reasoning field.',
          'Express the stance entirely inside the draft block fields (approach/reasoning/tradeoffs/steps). Do not add any text outside the draft block.',
        ].join('\n')
      : baseSystemPrompt;
    // One auto-retry per seat (shorter timeout) — transient flake must not
    // silently shrink the promised panel. Whatever still fails gets reported
    // through the panel-health banner instead of vanishing into a 3/6 run.
    const seat = await dispatchSeatWithRetry(opts.adapter, {
      engineId,
      engine,
      prompt: draftPrompt,
      systemPrompt,
      textOnly: true,
      cwd: process.cwd(),
      mode: 'exec',
      timeout: opts.timeout,
      outputDir: opts.outputDir,
      signal: opts.signal,
    });
    opts.onEvent?.({ type: 'brainstorm:seat-completed', data: { engineId, ok: seat.ok, attempts: seat.attempts, failure: seat.failure, detail: seat.detail } });
    if (!seat.ok) {
      console.warn(`[agon] brainstorm dispatch (${engineId}) failed after ${seat.attempts} attempt(s): ${seat.failure}`);
      return { entry: null, seat };
    }
    const raw = seat.text;
    const draft = parseKernDraft(raw);
    if (draft) {
      return { entry: { engineId, draft, raw, seat }, seat };
    }
    return { entry: { engineId, draft: fallbackParse(raw), raw, seat }, seat };
  });

  const attempts = await Promise.all(draftPromises);
  const drafts = attempts.flatMap((attempt) => attempt.entry ? [attempt.entry] : []);
  return { ranked: rankDrafts(drafts, opts.style), outcomes: attempts.map((attempt) => attempt.seat) };
}

function warnBrainstorm(message: string): void {
  console.warn(message);
}

export async function runScout(opts: {question:string, context?:string, engines:string[], scoutCount?:number, registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, signal?:AbortSignal}): Promise<{rankedBids:ScoutBid[], leadEngine:string, topConfidence:number, disagreementSpread:number}> {
  const count = opts.scoutCount ?? 2;
  // Filter quarantined engines BEFORE slicing, else a dead engine in the first
  // scoutCount slots still burns a scout dispatch (review consensus: claude/kimi/agy/zai).
  const __hcScout = await preflightHealthFilter({ engineIds: opts.engines, registry: opts.registry, adapter: opts.adapter, signal: opts.signal });
  __hcScout.skipped.forEach((s) => warnBrainstorm(`[agon] scout: skipping ${s.engineId} — ${s.status} (${s.reason})`));
  const scouts = __hcScout.healthy.slice(0, count);
  const collected = await collectRankedDrafts({ question: opts.question, context: opts.context, engines: scouts, registry: opts.registry, adapter: opts.adapter, timeout: Math.min(opts.timeout, 30), outputDir: opts.outputDir, signal: opts.signal });
  const ranked = collected.ranked;
  const bids: ScoutBid[] = ranked.map((d) => Object.assign({}, { engineId: d.engineId, confidence: calibrateConfidence(d.engineId, d.draft.confidence), approach: d.draft.approach, steps: d.draft.steps, keyFiles: d.draft.keyFiles, risk: (d.draft.approach.toLowerCase().includes('risk') || d.draft.tradeoffs.length > 2) ? ('high' as const) : ((d.draft.tradeoffs.length > 0) ? ('medium' as const) : ('low' as const)), needsCompetition: d.draft.tradeoffs.some((t: string) => /compet|test|verify|compar/i.test(t)) }));
  // Sort by scoutScore
  bids.sort((a, b) => scoutScore(b) - scoutScore(a));
  const topConfidence = (bids.length > 0) ? bids[0].confidence : 0;
  const secondConfidence = (bids.length > 1) ? bids[1].confidence : 0;
  const disagreementSpread = Math.abs((topConfidence - secondConfidence));
  return { rankedBids: bids, leadEngine: (bids.length > 0) ? bids[0].engineId : scouts[0], topConfidence: topConfidence, disagreementSpread: disagreementSpread };
}

// A06-BRAINSTORM-HOST (KL-011): temporary capability adapter, not a second workflow owner.
type LegacyBrainstormOptions = {question:string, context?:string, engines:string[], style?:string, registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, signal?:AbortSignal, onEvent?:(event:{type:string,data?:Record<string,unknown>})=>void};
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
