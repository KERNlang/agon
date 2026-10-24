import type { EngineRegistry, ForgeEvent, RatingRecord } from '@kernlang/agon-core';
import { getRatings, pickTopRatedEngine, rankEnginesByRating, resolveWorkingDir,
  seedNewEnginesFromRegistry, classifyTask, updateGlickoRanked, loadConfig } from '@kernlang/agon-core';
import { runCouncilRuntime, assignCouncilRoles as assignOwnedCouncilRoles } from '@kernlang/agon-mod-council';
import type { CouncilOptions as OwnedCouncilOptions, CouncilResult, CouncilSeating } from '@kernlang/agon-mod-council';

export { DEFAULT_COUNCIL_ROLES, roleGuidance, buildCouncilBriefPrompt,
  buildRolePrompt, buildCritiquePrompt, buildChairmanPrompt, parseCouncilConfidence } from '@kernlang/agon-mod-council';
export type { CouncilResult, CouncilSeat } from '@kernlang/agon-mod-council';

export interface CouncilOptions extends Omit<OwnedCouncilOptions<EngineRegistry>, 'cwd' | 'onEvent'> {
  cwd?: string | undefined;
  onEvent?: ((event: ForgeEvent) => void) | undefined;
}

function seatingFromRatings(ratings: RatingRecord): CouncilSeating {
  return {
    pick: (ids, modes) => pickTopRatedEngine(ids, ratings, {
      modes: modes.filter((mode): mode is 'tribunal' | 'critique' => mode === 'tribunal' || mode === 'critique'),
    }),
    rank: ids => rankEnginesByRating(ids, ratings),
  };
}

// Preserve the public ratings-based signature during caller migration.
export function assignCouncilRoles(advisors: string[], ratings: RatingRecord, roleNames: string[]) {
  return assignOwnedCouncilRoles(advisors, seatingFromRatings(ratings), roleNames);
}

// Council owns execution. This facade supplies the legacy host effects.
export function runCouncil(options: CouncilOptions): Promise<CouncilResult> {
  return runCouncilRuntime({ ...options, cwd: options.cwd ?? resolveWorkingDir() }, {
    loadConfig,
    readSeating: registry => {
      seedNewEnginesFromRegistry(registry);
      return seatingFromRatings(getRatings());
    },
    recordRatings: (question, ranked) => {
      const taskClass = classifyTask(question);
      updateGlickoRanked(ranked, taskClass, 'tribunal');
      updateGlickoRanked(ranked, taskClass, 'critique');
    },
    warn: message => console.warn(message),
  });
}
