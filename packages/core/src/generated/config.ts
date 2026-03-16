import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { join, dirname } from 'node:path';

import { homedir } from 'node:os';

import type { AgonConfig } from './types.js';

import { DEFAULT_AGON_CONFIG } from './types.js';

import { ConfigError } from './errors.js';

export const AGON_HOME: string = join(homedir(), '.agon');

export const GLOBAL_CONFIG_PATH: string = join(AGON_HOME, 'config.json');

export const ELO_PATH: string = join(AGON_HOME, 'elo.json');

export const RUNS_DIR: string = join(AGON_HOME, 'runs');

export const LOCAL_CONFIG_NAME: string = '.agon.json';

export function loadConfig(cwd?: string): Required<AgonConfig> {
  function readJsonSafe<T>(path: string): T | null {
    try { return JSON.parse(readFileSync(path, 'utf-8')) as T; }
    catch { return null; }
  }
  const global = readJsonSafe<Partial<AgonConfig>>(GLOBAL_CONFIG_PATH) ?? {};
  const local = cwd
    ? readJsonSafe<Partial<AgonConfig>>(join(cwd, LOCAL_CONFIG_NAME)) ?? {}
    : {};
  return { ...DEFAULT_AGON_CONFIG, ...global, ...local } as Required<AgonConfig>;
  
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
    catch { return null; }
  }
  const existing = readJsonSafe<Partial<AgonConfig>>(GLOBAL_CONFIG_PATH) ?? {};
  (existing as any)[key] = value;
  mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(existing, null, 2) + '\n');
  
}

export function ensureAgonHome(): void {
  mkdirSync(AGON_HOME, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
  
}

