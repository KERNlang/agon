import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { AgonConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { ConfigError } from './errors.js';

export const AGON_HOME = join(homedir(), '.agon');
export const GLOBAL_CONFIG_PATH = join(AGON_HOME, 'config.json');
export const ELO_PATH = join(AGON_HOME, 'elo.json');
export const RUNS_DIR = join(AGON_HOME, 'runs');
export const LOCAL_CONFIG_NAME = '.agon.json';

function readJsonSafe<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Load and merge config: defaults → global (~/.agon/config.json) → local (.agon.json)
 */
export function loadConfig(cwd?: string): Required<AgonConfig> {
  const global = readJsonSafe<Partial<AgonConfig>>(GLOBAL_CONFIG_PATH) ?? {};
  const local = cwd
    ? readJsonSafe<Partial<AgonConfig>>(join(cwd, LOCAL_CONFIG_NAME)) ?? {}
    : {};

  return { ...DEFAULT_CONFIG, ...global, ...local };
}

/**
 * Read a single config key with default fallback.
 */
export function configGet<K extends keyof AgonConfig>(
  key: K,
  cwd?: string,
): Required<AgonConfig>[K] {
  return loadConfig(cwd)[key];
}

/**
 * Set a config value in the global config file.
 */
export function configSet<K extends keyof AgonConfig>(
  key: K,
  value: AgonConfig[K],
): void {
  if (!(key in DEFAULT_CONFIG)) {
    throw new ConfigError(`Unknown config key: ${String(key)}`);
  }
  const existing = readJsonSafe<Partial<AgonConfig>>(GLOBAL_CONFIG_PATH) ?? {};
  existing[key] = value;
  writeJsonAtomic(GLOBAL_CONFIG_PATH, existing);
}

/**
 * Ensure the ~/.agon/ directory structure exists.
 */
export function ensureAgonHome(): void {
  mkdirSync(AGON_HOME, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
}
