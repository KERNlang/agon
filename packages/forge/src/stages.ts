// Public stage surface over ./stages-impl.ts, adding the determineWinner
// spread default that the shared core scorer does not carry.
export {
  classifyNoDiffForgeResult,
  resolveForgeAcceptReviewOutput,
  resolveForgeMode,
  resolveForgeRequireDiff,
  runBaseline,
  runStage1,
  runStage2,
} from './stages-impl.js';

import type { EngineResult } from '@kernlang/agon-core';
import { determineWinner as determineWinnerKern } from '@kernlang/agon-core';

// determineWinner moved to @kernlang/agon-core in Phase 3 of agent-team work so AgentTeam
// and forge share the canonical scoring path. KERN fn params don't support
// default values, so this thin facade adds the spread=8 default.
export function determineWinner(
  results: Map<string, EngineResult>,
  spread = 8,
): { winner: string | null; closeCall: boolean; bestScore: number; secondScore: number } {
  return determineWinnerKern(results, spread);
}
