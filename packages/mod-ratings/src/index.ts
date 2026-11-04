import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runRatings, loadRatings } from './implementation.js';
export * as glicko from './glicko.js';
export type { RatingRankOptions } from './glicko.js';
export type { GlickoRating, EngineMeta, RatingRecord } from './types.js';
export { computeUnknownEngineIds, computeRunManifestPurge, purgeRatingsStore } from './maintenance.js';
export type { PurgeReport, RatingsMaintenanceStore } from './maintenance.js';
export { resetRatings, applyRatingsReset } from './reset.js';
export type { RatingsResetPlan, RatingsResetReport } from './reset.js';
export { identityChanged, noteEngineIdentities } from './identity.js';
export type { EngineIdentityMeta, IdentityNoteOptions } from './identity.js';
export { JUDGE_SYSTEM_PROMPT, ballotNonce, scrubRankLines, scrubUntrusted, fairShares, truncateTo, nameVariants, scrubNames, buildBallotPrompt } from './ballot-prompt.js';
export { judgeIneligibility, activeAllowedEngines, judgeEligibilityTracker } from './judge-pool.js';
export type { JudgeIneligibility, JudgeRegistry } from './judge-pool.js';
export { ratingJudgingMode, planTribunalBallots, parseBallot, bordaScores, judgeTribunal, judgeTribunalForRating, chairRankInstruction, stripRankLines, judgeCouncil } from './rating-judge.js';
export type { RatingJudging, BallotSpec, ParsedBallot, BallotRecord } from './rating-judge.js';
export { rankByTaskClass, assignForgeRoles, buildSpecializedPrompt } from './role-specialization.js';
export type { EngineRole } from './role-specialization.js';
export { loadTeamConfidenceFloor } from './team-elo.js';
export { defaultCompositionRating, defaultRoleRating, loadTeamElo, saveTeamElo, expectedScore, getTeamElo, predictTeamRating, updateTeamElo, computeContributionWeights } from './team-elo.js';
