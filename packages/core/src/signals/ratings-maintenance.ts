import { purgeRatingsStore, computeUnknownEngineIds as findUnknownIds, applyRatingsReset as resetStore } from '@kernlang/agon-mod-ratings';
import type { PurgeReport, RatingsResetReport } from '@kernlang/agon-mod-ratings';
import type { RatingRecord } from '../models/types.js';
import { agonPath } from './config.js';
import { loadRatings, saveRatings } from './glicko.js';

export { computeRunManifestPurge, resetRatings } from '@kernlang/agon-mod-ratings';
export type { PurgeReport, RatingsResetPlan, RatingsResetReport } from '@kernlang/agon-mod-ratings';

export function computeUnknownEngineIds(record: RatingRecord, keepIds: string[]): string[] {
  return findUnknownIds(record, keepIds);
}

/** Preserve the public synchronous API and the existing ratings codec. */
export function purgeUnknownEngineData(opts: { registryIds: string[]; extraKeepIds?: string[]; dryRun: boolean }): PurgeReport {
  return purgeRatingsStore(opts, { path: agonPath, load: loadRatings, save: saveRatings }).report;
}

export function applyRatingsReset(opts: { modes: string[]; engines?: string[]; apply: boolean }): RatingsResetReport {
  return resetStore(opts, { path: agonPath, load: loadRatings, save: saveRatings });
}
