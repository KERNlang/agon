import type { BrainstormDraft as KernDraft } from './workflow.js';
import type { SeatOutcome } from '@kernlang/agon-support-panel';

export interface BrainstormRatingHistory {
  byMode: { brainstorm: Record<string, { wins: number; losses: number } | undefined> };
  global: Record<string, { wins: number; losses: number } | undefined>;
}
export interface ScoutScoreInput {
  confidence: number;
  keyFiles: string[];
  steps: string[];
  risk: 'low' | 'medium' | 'high';
}

export function structuralScore(draft: KernDraft, style?: string): number {
  let score = 0;
  if (draft.approach.length > 10) {
    score += 20;
  }
  if (draft.approach.length > 30) {
    score += 10;
  }
  if (draft.reasoning.length > 10) {
    score += 15;
  }
  score += Math.min(draft.steps.length, 7) * 5;
  score += Math.min(draft.tradeoffs.length, 5) * 5;
  // keyFiles reward only outside divergent style — reframing drafts rarely name
  // files, so counting them systematically buries every non-anchor stance.
  if (style !== 'divergent') {
    score += Math.min(draft.keyFiles.length, 5) * 3;
  }
  return score;
}

export function assignStances(engines: string[]): Map<string,string> {
  const stances = [
    'ANCHOR: give your single best, most direct answer to the question as asked.',
    'CONTRARIAN: assume the approach the question implies (or the most obvious one) is wrong — argue for a fundamentally different one.',
    'FIRST-PRINCIPLES: ignore the structure the question implies; restate the underlying problem in one line and re-derive a solution from scratch.',
    'OUTSIDER: answer as a strong expert from a different domain would — import a pattern this field does not normally use here.',
    'EXPANSIONIST: propose the most ambitious defensible version — what does this look like solved properly at 10x the scope?',
    'WILDCARD: propose something deliberately unconventional that you can still defend technically.',
  ];
  // Shuffle per run: a fixed seat→stance mapping would hand the same engine
  // the lowest-scoring stance every time and deflate its Glicko rating.
  const pool = stances
    .map((v) => ({ v, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
  const map = new Map<string, string>();
  engines.forEach((id, i) => map.set(id, pool[i % pool.length]));
  return map;
}

export function scoutScore(bid: ScoutScoreInput): number {
  let score = 0;
  // Confidence: 40% weight (0-40 points)
  score += Math.min(bid.confidence, 100) * 0.4;
  // Key files: 20% weight (0-20 points)
  score += Math.min(bid.keyFiles.length, 5) * 4;
  // Steps detail: 20% weight (0-20 points)
  score += Math.min(bid.steps.length, 5) * 4;
  // Risk assessment: 20% weight (0-20 points)
  score += (bid.risk === 'low') ? 20 : ((bid.risk === 'medium') ? 10 : 0);
  return score;
}

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


/** Re-read history for each score, preserving the legacy live calibration policy. */
export function createBrainstormScoring(getRatings: () => BrainstormRatingHistory) {
  function calibrateConfidence(engineId: string, rawBid: number): number {
    // Use Glicko-2 brainstorm ratings for calibration, fall back to global
    const ratings = getRatings();
    const history = ratings.byMode.brainstorm[engineId] ?? ratings.global[engineId];
    if (!history || history.wins + history.losses < 3) {
      return rawBid;
    }
    const winRate = history.wins / (history.wins + history.losses);
    // Blend: 30% self-reported, 70% track record
    return Math.round((rawBid * 0.3 + winRate * 100 * 0.7));
  }

  function qualityScore(engineId: string, draft: KernDraft, style?: string): number {
    let score = structuralScore(draft, style);
    // Use calibrated confidence, not raw self-report
    score += calibrateConfidence(engineId, draft.confidence) * 0.05;
    return score;
  }

  function rankDrafts(drafts: {engineId:string, draft:KernDraft, raw:string, seat:SeatOutcome}[], style?: string): {engineId:string, draft:KernDraft, raw:string, seat:SeatOutcome}[] {
    return [...drafts].sort((a, b) => {
      const scoreA = qualityScore(a.engineId, a.draft, style);
      const scoreB = qualityScore(b.engineId, b.draft, style);
      return scoreB - scoreA;
    });
  }

  return Object.freeze({ calibrateConfidence, qualityScore, rankDrafts });
}
