import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EloRecord, EloRating, TaskClass } from './types.js';
import { ELO_PATH } from './config.js';

const DEFAULT_RATING = 1500;

function defaultRating(): EloRating {
  return { rating: DEFAULT_RATING, wins: 0, losses: 0, draws: 0 };
}

function loadElo(): EloRecord {
  try {
    return JSON.parse(readFileSync(ELO_PATH, 'utf-8')) as EloRecord;
  } catch {
    return { global: {}, byTaskClass: {}, lastUpdated: new Date().toISOString() };
  }
}

function saveElo(record: EloRecord): void {
  const dir = dirname(ELO_PATH);
  mkdirSync(dir, { recursive: true });
  record.lastUpdated = new Date().toISOString();
  writeFileSync(ELO_PATH, JSON.stringify(record, null, 2) + '\n');
}

/**
 * Calculate expected score (probability of winning).
 */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Update ELO ratings after a match.
 */
export function updateElo(
  winnerId: string,
  loserId: string,
  taskClass: TaskClass,
  kFactor = 32,
): { winnerNewRating: number; loserNewRating: number } {
  const record = loadElo();

  // Ensure entries exist
  record.global[winnerId] ??= defaultRating();
  record.global[loserId] ??= defaultRating();
  record.byTaskClass[taskClass] ??= {};
  record.byTaskClass[taskClass][winnerId] ??= defaultRating();
  record.byTaskClass[taskClass][loserId] ??= defaultRating();

  // Update global
  const wGlobal = record.global[winnerId];
  const lGlobal = record.global[loserId];
  const expectedW = expectedScore(wGlobal.rating, lGlobal.rating);
  const expectedL = expectedScore(lGlobal.rating, wGlobal.rating);
  wGlobal.rating = Math.round(wGlobal.rating + kFactor * (1 - expectedW));
  lGlobal.rating = Math.round(lGlobal.rating + kFactor * (0 - expectedL));
  wGlobal.wins++;
  lGlobal.losses++;

  // Update per-task-class
  const wClass = record.byTaskClass[taskClass][winnerId];
  const lClass = record.byTaskClass[taskClass][loserId];
  const expectedWC = expectedScore(wClass.rating, lClass.rating);
  const expectedLC = expectedScore(lClass.rating, wClass.rating);
  wClass.rating = Math.round(wClass.rating + kFactor * (1 - expectedWC));
  lClass.rating = Math.round(lClass.rating + kFactor * (0 - expectedLC));
  wClass.wins++;
  lClass.losses++;

  saveElo(record);

  return {
    winnerNewRating: wGlobal.rating,
    loserNewRating: lGlobal.rating,
  };
}

/**
 * Get current ELO ratings for all engines.
 */
export function getElo(): EloRecord {
  return loadElo();
}

/**
 * Get a single engine's global rating.
 */
export function getEngineRating(engineId: string): EloRating {
  const record = loadElo();
  return record.global[engineId] ?? defaultRating();
}
