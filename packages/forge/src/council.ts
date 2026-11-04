import { currentInvocationOwnerAvailable } from '@kernlang/agon-kernel';
import { ratingJudgingMode, chairRankInstruction, scrubRankLines, stripRankLines, judgeCouncil } from '@kernlang/agon-mod-ratings';
import type { EngineRegistry, ForgeEvent, RatingRecord, RatingRankOptions } from '@kernlang/agon-core';
import { getRatings, pickTopRatedEngine, rankEnginesByRating, resolveWorkingDir,
  seedNewEnginesFromRegistry, classifyTask, updateGlickoRanked, loadConfig } from '@kernlang/agon-core';
import { runCouncilRuntime, assignCouncilRoles as assignOwnedCouncilRoles, buildChairmanPrompt as buildOwnedChairmanPrompt } from '@kernlang/agon-mod-council';
import type { CouncilOptions as OwnedCouncilOptions, CouncilResult, CouncilSeating } from '@kernlang/agon-mod-council';

export { DEFAULT_COUNCIL_ROLES, roleGuidance, buildCouncilBriefPrompt,
  buildRolePrompt, buildCritiquePrompt, applyChairExploration, parseCouncilConfidence } from '@kernlang/agon-mod-council';
export type { CouncilResult, CouncilSeat } from '@kernlang/agon-mod-council';

export interface CouncilOptions extends Omit<OwnedCouncilOptions<EngineRegistry>, 'cwd' | 'onEvent'> {
  cwd?: string | undefined;
  onEvent?: ((event: ForgeEvent) => void) | undefined;
}

function seatingFromRatings(ratings: RatingRecord, rank?: RatingRankOptions): CouncilSeating {
  return {
    pick: (ids, modes) => pickTopRatedEngine(ids, ratings, {
      modes: modes.filter((mode): mode is 'tribunal' | 'critique' => mode === 'tribunal' || mode === 'critique'), ...rank,
    }),
    rank: ids => rankEnginesByRating(ids, ratings, undefined, rank),
  };
}

// Preserve the public ratings-based signature during caller migration.
export function assignCouncilRoles(advisors: string[], ratings: RatingRecord, roleNames: string[], rank?: RatingRankOptions) {
  return assignOwnedCouncilRoles(advisors, seatingFromRatings(ratings, rank), roleNames);
}

// Council owns execution. This facade supplies the legacy host effects.
export function runCouncil(options: CouncilOptions): Promise<CouncilResult> {
  return runCouncilRuntime({ ...options, cwd: options.cwd ?? resolveWorkingDir() }, {
    loadConfig,
    readJudging: () => currentInvocationOwnerAvailable('agon.ratings') === false ? undefined : {
      mode: ratingJudgingMode, instruction: chairRankInstruction, scrub: scrubRankLines, strip: stripRankLines, score: judgeCouncil,
    },
    readSeating: (registry, rank) => {
      seedNewEnginesFromRegistry(registry);
      return seatingFromRatings(getRatings(), rank);
    },
    recordRatings: (question, ranked, identities) => {
      const taskClass = classifyTask(question);
      updateGlickoRanked(ranked, taskClass, 'tribunal', identities);
      updateGlickoRanked(ranked, taskClass, 'critique');
    },
    warn: message => console.warn(message),
  });
}

export function buildChairmanPrompt(opts: { brief: string; seats: { role: string; response: string; critique: string; critiquedRole: string }[]; rankLabels?: string[] }): string {
  return buildOwnedChairmanPrompt({ ...opts, ...(opts.rankLabels ? { ranking: { labels: opts.rankLabels, capability: { instruction: chairRankInstruction, scrub: scrubRankLines } } } : {}) });
}
