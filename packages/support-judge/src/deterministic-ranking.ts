/** Fields used by the shared deterministic comparison. */
export interface ScoredCandidate {
  pass: boolean;
  score: number;
  lintWarnings: number;
  styleScore: number;
  diffLines: number;
  filesChanged: number;
  durationSec: number;
}

/**
 * Pick the winning engine via deterministic multi-factor tiebreaker. Filters to passing+positive-score results, then sorts by score desc, lintWarnings asc, styleScore desc, diffLines asc, filesChanged asc, durationSec asc. Moved from forge/stages.kern in Phase 3 — the canonical fleet scoring path used by both forge and AgentTeam.
 */
export function determineWinner(results: Map<string,ScoredCandidate>, spread: number): {winner:string|null, closeCall:boolean, bestScore:number, secondScore:number} {
  const passing = [...results.entries()]
    .filter(([_, r]) => r.pass && r.score > 0)
    .sort(([_aId, a], [_bId, b]) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.lintWarnings !== b.lintWarnings) return a.lintWarnings - b.lintWarnings;
      if (a.styleScore !== b.styleScore) return b.styleScore - a.styleScore;
      if (a.diffLines !== b.diffLines) return a.diffLines - b.diffLines;
      if (a.filesChanged !== b.filesChanged) return a.filesChanged - b.filesChanged;
      return a.durationSec - b.durationSec;
    });

  if (passing.length === 0) {
    return { winner: null, closeCall: false, bestScore: 0, secondScore: 0 };
  }

  const bestScore = passing[0][1].score;
  const secondScore = passing.length > 1 ? passing[1][1].score : 0;
  const closeCall = passing.length > 1 && (bestScore - secondScore) < spread;

  return { winner: passing[0][0], closeCall, bestScore, secondScore };
}
