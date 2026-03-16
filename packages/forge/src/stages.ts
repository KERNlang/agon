// ── Re-export from KERN-generated stages ────────────────────────────
// Source of truth: src/kern/stages.kern
export { runBaseline, runStage1, runStage2 } from './generated/stages.js';

import type { EngineResult } from '@agon/core';
import { determineWinner as determineWinnerKern } from './generated/stages.js';

// KERN fn params don't support default values — add the spread=8 default here
export function determineWinner(
  results: Map<string, EngineResult>,
  spread = 8,
): { winner: string | null; closeCall: boolean; bestScore: number; secondScore: number } {
  return determineWinnerKern(results, spread);
}
