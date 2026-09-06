import { createBrainstormCollector } from './collector.js';
import type { BrainstormCollectorServices } from './collector.js';
import { createBrainstormScoring } from './policy.js';
import type { BrainstormRatingHistory } from './policy.js';
import { createBrainstormScout } from './scout.js';
import { createBrainstormWorkflow } from './workflow.js';
import type { BrainstormWorkflowOptions, BrainstormWorkflowServices } from './workflow.js';

/** Host effects only. Scoring, selection and workflow composition belong here. */
export interface BrainstormRuntimeServices<Options extends BrainstormWorkflowOptions>
  extends Pick<BrainstormWorkflowServices<Options>,
    'seed' | 'preflight' | 'createLogger' | 'deduplicate' | 'updateRatings' | 'selectWinner'>,
  Pick<BrainstormCollectorServices<Options>, 'buildPrompt' | 'parseDraft' | 'selectSeat'> {
  readRatings(): BrainstormRatingHistory;
}

/** Canonical composition for host adapters; construction performs no effects. */
export function createBrainstormRuntime<Options extends BrainstormWorkflowOptions>(services: BrainstormRuntimeServices<Options>) {
  const scoring = createBrainstormScoring(() => services.readRatings());
  const collectRankedDrafts = createBrainstormCollector<Options>({
    buildPrompt: input => services.buildPrompt(input),
    parseDraft: raw => services.parseDraft(raw),
    selectSeat: (options, engineId) => services.selectSeat(options, engineId),
    rankDrafts: scoring.rankDrafts,
  });

  const runScout = createBrainstormScout<Options & { scoutCount?: number }>({
    preflight: options => services.preflight(options),
    collect: (options, engines, timeout) => {
      // Scout collection historically has neither divergent stances nor seat UI
      // events. Keep host-specific options, but do not inherit these controls.
      const collectionOptions = { ...options, engines, timeout };
      delete collectionOptions.style;
      delete collectionOptions.onEvent;
      delete collectionOptions.scoutCount;
      return collectRankedDrafts(collectionOptions);
    },
    calibrateConfidence: scoring.calibrateConfidence,
  });

  const runBrainstorm = createBrainstormWorkflow<Options>({
    seed: options => services.seed(options),
    preflight: options => services.preflight(options),
    createLogger: options => services.createLogger(options),
    collect: (options, engines, style) => collectRankedDrafts({ ...options, engines, style }),
    qualityScore: scoring.qualityScore,
    calibrateConfidence: scoring.calibrateConfidence,
    deduplicate: (drafts, options) => services.deduplicate(drafts, options),
    updateRatings: (bids, question) => services.updateRatings(bids, question),
    selectWinner: (options, engineId) => services.selectWinner(options, engineId),
  });

  return { ...scoring, collectRankedDrafts, runScout, runBrainstorm };
}
