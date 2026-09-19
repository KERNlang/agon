import { scoutScore } from './policy.js';
import type { BrainstormCollection } from './collector.js';
import type { BrainstormWorkflowOptions } from './workflow.js';

export interface BrainstormScoutOptions extends BrainstormWorkflowOptions { scoutCount?: number }
export interface BrainstormScoutBid {
  engineId: string;
  confidence: number;
  approach: string;
  steps: string[];
  keyFiles: string[];
  risk: 'low' | 'medium' | 'high';
  needsCompetition: boolean;
}
export interface BrainstormScoutServices<Options extends BrainstormScoutOptions> {
  preflight(options: Options): Promise<{ healthy: string[]; skipped: { engineId: string; status: string; reason: string }[] }>;
  collect(options: Options, engines: string[], timeout: number): Promise<BrainstormCollection>;
  calibrateConfidence(engineId: string, confidence: number): number;
}

export function createBrainstormScout<Options extends BrainstormScoutOptions>(services: BrainstormScoutServices<Options>) {
  return async function runScout(opts: Options) {
    const count = opts.scoutCount ?? 2;
    // Filter quarantined engines BEFORE slicing, else a dead engine in the first
    // scoutCount slots still burns a scout dispatch (review consensus: claude/kimi/agy/zai).
    const __hcScout = await services.preflight(opts);
    __hcScout.skipped.forEach((s) => console.warn(`[agon] scout: skipping ${s.engineId} — ${s.status} (${s.reason})`));
    const scouts = __hcScout.healthy.slice(0, count);
    const collected = await services.collect(opts, scouts, Math.min(opts.timeout, 30));
    const ranked = collected.ranked;
    const bids: BrainstormScoutBid[] = ranked.map((d) => Object.assign({}, { engineId: d.engineId, confidence: services.calibrateConfidence(d.engineId, d.draft.confidence), approach: d.draft.approach, steps: d.draft.steps, keyFiles: d.draft.keyFiles, risk: (d.draft.approach.toLowerCase().includes('risk') || d.draft.tradeoffs.length > 2) ? ('high' as const) : ((d.draft.tradeoffs.length > 0) ? ('medium' as const) : ('low' as const)), needsCompetition: d.draft.tradeoffs.some((t: string) => /compet|test|verify|compar/i.test(t)) }));
    // Sort by scoutScore
    bids.sort((a, b) => scoutScore(b) - scoutScore(a));
    const topConfidence = (bids.length > 0) ? bids[0].confidence : 0;
    const secondConfidence = (bids.length > 1) ? bids[1].confidence : 0;
    const disagreementSpread = Math.abs((topConfidence - secondConfidence));
    return { rankedBids: bids, leadEngine: (bids.length > 0) ? bids[0].engineId : scouts[0], topConfidence: topConfidence, disagreementSpread: disagreementSpread };

  };
}
