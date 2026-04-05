import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

import { join, dirname } from 'node:path';

import { homedir } from 'node:os';

import type { AgonConfig } from './types.js';

import { DEFAULT_AGON_CONFIG } from './types.js';

import { ConfigError } from './errors.js';

export const AGON_HOME: string = join(homedir(), '.agon');

export const GLOBAL_CONFIG_PATH: string = join(AGON_HOME, 'config.json');

export const ELO_PATH: string = join(AGON_HOME, 'elo.json');

export const RUNS_DIR: string = join(AGON_HOME, 'runs');

export const TEAM_ELO_PATH: string = join(AGON_HOME, 'team-elo.json');

export const CORPUS_PATH: string = join(AGON_HOME, 'corpus.json');

export const SKILLS_DIR: string = join(AGON_HOME, 'skills');

export const LOCAL_CONFIG_NAME: string = '.agon.json';

export const LOCAL_PRIVATE_CONFIG_NAME: string = '.agon.local.json';

export function loadConfig(cwd?: string): Required<AgonConfig> {
  function readJsonSafe<T>(path: string): T | null {
    try { return JSON.parse(readFileSync(path, 'utf-8')) as T; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[agon] warning: failed to parse config ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null;
    }
  }
  const global = readJsonSafe<Partial<AgonConfig>>(GLOBAL_CONFIG_PATH) ?? {};
  const local = cwd
    ? readJsonSafe<Partial<AgonConfig>>(join(cwd, LOCAL_CONFIG_NAME)) ?? {}
    : {};
  // .agon.local.json — gitignored personal overrides (debug, engine prefs)
  const localPrivate = cwd
    ? readJsonSafe<Partial<AgonConfig>>(join(cwd, LOCAL_PRIVATE_CONFIG_NAME)) ?? {}
    : {};
  const merged = { ...DEFAULT_AGON_CONFIG, ...global, ...local, ...localPrivate } as Required<AgonConfig>;
  // Compiler can't emit object/array defaults for Record types — ensure correct runtime types
  if (!merged.hooks || typeof merged.hooks === 'string') (merged as any).hooks = {};
  if (!merged.allowedCommands || typeof merged.allowedCommands === 'string') (merged as any).allowedCommands = [];
  if (!merged.toolPermissions || typeof merged.toolPermissions === 'string') (merged as any).toolPermissions = {};
  return merged;
}

export function configGet(key: keyof AgonConfig, cwd?: string): Required<AgonConfig>[keyof AgonConfig] {
  return loadConfig(cwd)[key];
}

export function configSet(key: keyof AgonConfig, value: AgonConfig[keyof AgonConfig]): void {
  if (!(key in DEFAULT_AGON_CONFIG)) {
    throw new ConfigError(`Unknown config key: ${String(key)}`);
  }
  function readJsonSafe<T>(path: string): T | null {
    try { return JSON.parse(readFileSync(path, 'utf-8')) as T; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[agon] warning: failed to parse config ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null;
    }
  }
  const existing = readJsonSafe<Partial<AgonConfig>>(GLOBAL_CONFIG_PATH) ?? {};
  (existing as any)[key] = value;
  mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  const tmpPath = GLOBAL_CONFIG_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(existing, null, 2) + '\n');
  renameSync(tmpPath, GLOBAL_CONFIG_PATH);
}

export function ensureAgonHome(): void {
  mkdirSync(AGON_HOME, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
}

