import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function persistenceHome(): string {
  return resolve(process.env.AGON_HOME?.trim() || join(homedir(), '.agon'));
}

export function persistencePath(...parts: string[]): string {
  return join(persistenceHome(), ...parts);
}

export const AGON_HOME = persistenceHome();
export const GLOBAL_CONFIG_PATH = join(AGON_HOME, 'config.json');
export const RUNS_DIR = join(AGON_HOME, 'runs');
export const RATINGS_PATH = join(AGON_HOME, 'ratings.json');
export const TEAM_ELO_PATH = join(AGON_HOME, 'team-elo.json');
export const CORPUS_PATH = join(AGON_HOME, 'corpus.json');
export const SKILLS_DIR = join(AGON_HOME, 'skills');

export function ensurePersistenceHome(): string {
  const home = persistenceHome();
  mkdirSync(home, { recursive: true });
  return home;
}
