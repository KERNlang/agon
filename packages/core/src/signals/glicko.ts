/** Stable Core exports. The Ratings mod owns algorithms and persistence. */
import { glicko } from '@kernlang/agon-mod-ratings';

export const {
  GLICKO_SCALE,
  DEFAULT_MU,
  DEFAULT_PHI,
  DEFAULT_SIGMA,
  TAU,
  CONVERGENCE_TOLERANCE,
  defaultGlickoRating,
  defaultEngineMeta,
  loadRatings,
  saveRatings,
  getRatings,
  getEngineGlickoRating,
  glickoG,
  glickoE,
  updateGlicko,
  computeNewSigma,
  updateGlickoRanked,
  advisorScore,
  rankEnginesByRating,
  pickTopRatedEngine,
  PHI_INHERIT_MULT,
  MIN_INHERIT_GAMES,
  seedSuccessorRating,
  seedEnginesFromLineage,
  lineageFromRegistry,
  seedNewEnginesFromRegistry
} = glicko;
