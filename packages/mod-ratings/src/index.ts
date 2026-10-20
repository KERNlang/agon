export { loadTeamConfidenceFloor } from './team-elo.js';
export { defaultCompositionRating, defaultRoleRating, loadTeamElo, saveTeamElo, expectedScore, getTeamElo, predictTeamRating, updateTeamElo, computeContributionWeights } from './team-elo.js';
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
export type { GlickoRating, EngineMeta, RatingRecord } from './types.js';
export { computeUnknownEngineIds, computeRunManifestPurge, purgeRatingsStore } from './maintenance.js';
export type { PurgeReport, RatingsMaintenanceStore } from './maintenance.js';
export { rankByTaskClass, assignForgeRoles, buildSpecializedPrompt } from './role-specialization.js';
export type { EngineRole } from './role-specialization.js';
