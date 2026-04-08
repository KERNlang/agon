// @kern-source: brainstorm:1
import { randomUUID } from 'node:crypto';

// @kern-source: brainstorm:2
import type { EngineAdapter, BrainstormBid, BrainstormResult, ScoutBid } from '@agon/core';

// @kern-source: brainstorm:3
import { EngineRegistry, buildBrainstormPrompt, getElo, getRatings, loadConfig, createSidechainLogger, updateGlickoRanked, classifyTask } from '@agon/core';

// @kern-source: brainstorm:4
import { buildKernDraftPrompt, parseKernDraft, buildKernRankPrompt } from 'kern-lang';

// @kern-source: brainstorm:5
import type { KernDraft } from 'kern-lang';

// @kern-source: brainstorm:7
export function calibrateConfidence(engineId: string, rawBid: number): number {
  // Use Glicko-2 brainstorm ratings for calibration, fall back to global
  const ratings = getRatings();
  const history = ratings.byMode.brainstorm[engineId] ?? ratings.global[engineId];
  if (!history || history.wins + history.losses < 3) return rawBid;
  const winRate = history.wins / (history.wins + history.losses);
  // Blend: 30% self-reported, 70% track record
  return Math.round(rawBid * 0.3 + winRate * 100 * 0.7);
}

// @kern-source: brainstorm:18
export function qualityScore(engineId: string, draft: KernDraft): number {
  let score = 0;
  if (draft.approach.length > 10) score += 20;
  if (draft.approach.length > 30) score += 10;
  if (draft.reasoning.length > 10) score += 15;
  score += Math.min(draft.steps.length, 7) * 5;
  score += Math.min(draft.tradeoffs.length, 5) * 5;
  score += Math.min(draft.keyFiles.length, 5) * 3;
  // Use calibrated confidence, not raw self-report
  score += calibrateConfidence(engineId, draft.confidence) * 0.05;
  return score;
}

// @kern-source: brainstorm:32
export function rankDrafts(drafts: {engineId:string, draft:KernDraft, raw:string}[]): {engineId:string, draft:KernDraft, raw:string}[] {
  return [...drafts].sort((a, b) => {
    const scoreA = qualityScore(a.engineId, a.draft);
    const scoreB = qualityScore(b.engineId, b.draft);
    return scoreB - scoreA;
  });
}

// @kern-source: brainstorm:41
export async function collectRankedDrafts(opts: {question:string, context?:string, engines:string[], registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, signal?:AbortSignal}): Promise<{engineId:string, draft:KernDraft, raw:string}[]> {
  const draftPrompt = buildKernDraftPrompt({
    question: opts.question,
    context: opts.context,
    mode: 'brainstorm',
  });
  
  const draftPromises = opts.engines.map(async (engineId: string) => {
    const engine = opts.registry.get(engineId);
    try {
      const result = await opts.adapter.dispatch({
        engine,
        prompt: draftPrompt,
        cwd: process.cwd(),
        mode: 'exec',
        timeout: opts.timeout,
        outputDir: opts.outputDir,
        signal: opts.signal,
      });
  
      const draft = parseKernDraft(result.stdout);
      if (draft) {
        return { engineId, draft, raw: result.stdout };
      }
  
      return { engineId, draft: fallbackParse(result.stdout), raw: result.stdout };
    } catch (err) {
      console.warn(`[agon] brainstorm dispatch (${engineId}) failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        engineId,
        draft: {
          approach: 'Failed to respond',
          reasoning: '',
          tradeoffs: [],
          confidence: 0,
          keyFiles: [],
          steps: [],
        } satisfies KernDraft,
        raw: '',
      };
    }
  });
  
  const drafts = await Promise.all(draftPromises);
  return rankDrafts(drafts);
}

// @kern-source: brainstorm:89
export function scoutScore(bid: ScoutBid): number {
  let score = 0;
  // Confidence: 40% weight (0-40 points)
  score += Math.min(bid.confidence, 100) * 0.4;
  // Key files: 20% weight (0-20 points)
  score += Math.min(bid.keyFiles.length, 5) * 4;
  // Steps detail: 20% weight (0-20 points)
  score += Math.min(bid.steps.length, 5) * 4;
  // Risk assessment: 20% weight (0-20 points)
  score += bid.risk === 'low' ? 20 : bid.risk === 'medium' ? 10 : 0;
  return score;
}

// @kern-source: brainstorm:103
export async function runScout(opts: {question:string, context?:string, engines:string[], scoutCount?:number, registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, signal?:AbortSignal}): Promise<{rankedBids:ScoutBid[], leadEngine:string, topConfidence:number, disagreementSpread:number}> {
  const count = opts.scoutCount ?? 2;
  const scouts = opts.engines.slice(0, count);
  
  const ranked = await collectRankedDrafts({
    question: opts.question,
    context: opts.context,
    engines: scouts,
    registry: opts.registry,
    adapter: opts.adapter,
    timeout: Math.min(opts.timeout, 30),
    outputDir: opts.outputDir,
    signal: opts.signal,
  });
  
  const bids: ScoutBid[] = ranked.map((d) => ({
    engineId: d.engineId,
    confidence: calibrateConfidence(d.engineId, d.draft.confidence),
    approach: d.draft.approach,
    steps: d.draft.steps,
    keyFiles: d.draft.keyFiles,
    risk: d.draft.approach.toLowerCase().includes('risk') || d.draft.tradeoffs.length > 2 ? 'high' as const : d.draft.tradeoffs.length > 0 ? 'medium' as const : 'low' as const,
    needsCompetition: d.draft.tradeoffs.some((t: string) => /compet|test|verify|compar/i.test(t)),
  }));
  
  // Sort by scoutScore
  bids.sort((a, b) => scoutScore(b) - scoutScore(a));
  
  const topConfidence = bids.length > 0 ? bids[0].confidence : 0;
  const secondConfidence = bids.length > 1 ? bids[1].confidence : 0;
  const disagreementSpread = Math.abs(topConfidence - secondConfidence);
  
  return {
    rankedBids: bids,
    leadEngine: bids.length > 0 ? bids[0].engineId : scouts[0],
    topConfidence,
    disagreementSpread,
  };
}

// @kern-source: brainstorm:144
export function fallbackParse(output: string): KernDraft {
  const stripped = output.replace(/\x60\x60\x60(?:json)?\s*/gi, '').replace(/\x60\x60\x60/g, '');
  let depth = 0;
  let start = -1;
  
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (stripped[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const parsed = JSON.parse(stripped.slice(start, i + 1));
          if (typeof parsed === 'object' && parsed !== null) {
            return {
              approach: String(parsed.approach ?? parsed.reasoning ?? ''),
              reasoning: String(parsed.reasoning ?? ''),
              tradeoffs: [],
              confidence: Number(parsed.confidence) || 50,
              keyFiles: [],
              steps: parsed.approach ? [parsed.approach] : [],
            };
          }
        } catch { /* keep looking */ }
        start = -1;
      }
    }
  }
  
  return {
    approach: output.slice(0, 200),
    reasoning: '',
    tradeoffs: [],
    confidence: 50,
    keyFiles: [],
    steps: [],
  };
}

// @kern-source: brainstorm:185
export async function runBrainstorm(opts: {question:string, context?:string, engines:string[], registry:EngineRegistry, adapter:EngineAdapter, timeout:number, outputDir:string, signal?:AbortSignal}): Promise<BrainstormResult> {
  const brainstormId = randomUUID().slice(0, 8);
  const sidechain = createSidechainLogger({
    sessionId: brainstormId,
    sessionType: 'brainstorm',
    outputDir: opts.outputDir,
  });
  sidechain.log('brainstorm:init', undefined, { question: opts.question, engines: opts.engines });
  
  const ranked = await collectRankedDrafts({
    question: opts.question,
    context: opts.context,
    engines: opts.engines,
    registry: opts.registry,
    adapter: opts.adapter,
    timeout: opts.timeout,
    outputDir: opts.outputDir,
    signal: opts.signal,
  });
  
  const bids: BrainstormBid[] = ranked.map((d, i) => {
    const reasoning = d.draft.approach + (d.draft.reasoning ? ` — ${d.draft.reasoning}` : '');
    const approach = d.draft.steps.map((s: string, j: number) => `${j + 1}. ${s}`).join('\n');
    const score = qualityScore(d.engineId, d.draft);
    return {
      engineId: d.engineId,
      confidence: calibrateConfidence(d.engineId, d.draft.confidence),
      reasoning: reasoning || d.raw.slice(0, 300) || '[No response]',
      approach: approach || '',
      score,
    };
  });
  
  const winner = ranked[0];
  
  // Update Glicko-2 ratings for all ranked engines
  if (bids.length >= 2) {
    const taskClass = classifyTask(opts.question);
    const glickoRanked = bids.map(b => ({ engineId: b.engineId, score: b.score ?? 0 }));
    updateGlickoRanked(glickoRanked, taskClass, 'brainstorm');
  }
  
  const winnerEngine = opts.registry.get(winner.engineId);
  
  // Build synthesis prompt with ALL engines' drafts
  const allDrafts = ranked.map((d) => {
    const steps = d.draft.steps.map((s: string, j: number) => `  ${j + 1}. ${s}`).join('\n');
    return `## ${d.engineId} (confidence: ${d.draft.confidence}%)\nApproach: ${d.draft.approach}${d.draft.reasoning ? `\nReasoning: ${d.draft.reasoning}` : ''}${d.draft.tradeoffs?.length ? `\nTradeoffs: ${d.draft.tradeoffs.join('; ')}` : ''}${steps ? `\nSteps:\n${steps}` : ''}`;
  }).join('\n\n');
  
  const expandPrompt = [
    opts.question,
    '',
    `Multiple AI engines analyzed this. Here are ALL their drafts — synthesize the best parts from each into one comprehensive answer:`,
    '',
    allDrafts,
    '',
    'Now write the best possible answer by combining the strongest ideas from ALL drafts above. Don\'t just pick one — take the best parts from each.',
    'Be specific and actionable. Include file paths where relevant.',
  ].join('\n');
  
  const answerResult = await opts.adapter.dispatch({
    engine: winnerEngine,
    prompt: expandPrompt,
    cwd: process.cwd(),
    mode: 'exec',
    timeout: opts.timeout,
    outputDir: opts.outputDir,
    signal: opts.signal,
  });
  
  sidechain.log('brainstorm:done', winner.engineId, {
    bids: bids.map((b: BrainstormBid) => ({ engineId: b.engineId, confidence: b.confidence })),
    responseLength: answerResult.stdout.length,
  });
  
  return {
    question: opts.question,
    bids,
    winner: winner.engineId,
    response: answerResult.stdout,
  };
}

