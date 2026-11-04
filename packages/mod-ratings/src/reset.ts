import { copyFileSync, existsSync } from 'node:fs';
import { withFileLock } from '@kernlang/agon-support-persistence';
import type { GlickoRating, RatingRecord } from './types.js';
import type { RatingsMaintenanceStore } from './maintenance.js';
import { defaultGlickoRating } from './glicko.js';

type RatingMode = keyof RatingRecord['byMode'];

const RATING_MODES: RatingMode[] = ['forge', 'brainstorm', 'tribunal', 'critique'];

export interface RatingsResetPlan {
  record: RatingRecord;
  entries: Array<{ mode: RatingMode; engineId: string; before: GlickoRating }>;
  unknownModes: string[];
  unknownEngines: string[];
}

/**
 * Reset the byMode ratings of the given disciplines to the default rating — for every engine rated there, or only for `engines` when given. Pure: returns a reset copy and never mutates `record`. unknownModes lists names that are not a discipline; unknownEngines lists requested engines not rated in any of the given modes. Global, other disciplines, byTaskClass and engineMeta are copied unchanged.
 */
export function resetRatings(record: RatingRecord, modes: string[], engines?: string[]): RatingsResetPlan {
  const next: RatingRecord = structuredClone(record);
  const unknownModes = modes.filter((m) => !RATING_MODES.includes(m as RatingMode));
  const chosen = RATING_MODES.filter((m) => modes.includes(m));
  const ratedIds = new Set(chosen.flatMap((m) => Object.keys(record.byMode?.[m] ?? {})));
  const unknownEngines = (engines ?? []).filter((id) => !ratedIds.has(id));
  const only = engines && engines.length > 0 ? new Set(engines) : null;
  const entries: RatingsResetPlan['entries'] = [];
  for (const mode of chosen) {
    const scope = next.byMode[mode] ?? {};
    for (const engineId of Object.keys(scope).sort()) {
      if (only && !only.has(engineId)) continue;
      entries.push({ mode, engineId, before: scope[engineId] });
      scope[engineId] = defaultGlickoRating();
    }
  }
  return { record: next, entries, unknownModes, unknownEngines };
}

export interface RatingsResetReport {
  dryRun: boolean;
  ratingsPath: string;
  entries: RatingsResetPlan['entries'];
  unknownModes: string[];
  unknownEngines: string[];
  backupPath: string | null;
}

/**
 * `agon ratings reset`: plan the reset against the current ratings.json and, when apply is set and every mode and engine is known, copy ratings.json to ratings.json.bak-<timestamp> and then write the reset record — both under the ratings lock, reloading inside it so a concurrent run is not clobbered. Nothing is written on a dry run, an unknown mode or engine, or an empty plan.
 */
export function applyRatingsReset(opts: { modes: string[]; engines?: string[]; apply: boolean }, store: RatingsMaintenanceStore<RatingRecord>): RatingsResetReport {
  const ratingsPath = store.path('ratings.json');
  const report = (plan: RatingsResetPlan, backupPath: string | null): RatingsResetReport => ({
    dryRun: !opts.apply, ratingsPath, entries: plan.entries, unknownModes: plan.unknownModes, unknownEngines: plan.unknownEngines, backupPath,
  });
  const refused = (plan: RatingsResetPlan) => plan.unknownModes.length > 0 || plan.unknownEngines.length > 0 || plan.entries.length === 0;
  let plan = resetRatings(store.load(), opts.modes, opts.engines);
  if (!opts.apply) return report(plan, null);
  let backupPath: string | null = null;
  withFileLock(ratingsPath + '.lock', () => {
    plan = resetRatings(store.load(), opts.modes, opts.engines);
    if (refused(plan) || !existsSync(ratingsPath)) return;
    backupPath = `${ratingsPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(ratingsPath, backupPath);
    store.save(plan.record);
  });
  return report(plan, backupPath);
}
