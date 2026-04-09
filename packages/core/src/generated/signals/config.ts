// @kern-source: config:1
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

// @kern-source: config:2
import { join, dirname } from 'node:path';

// @kern-source: config:3
import { homedir } from 'node:os';

// @kern-source: config:4
import type { AgonConfig } from '../models/types.js';

// @kern-source: config:5
import { DEFAULT_AGON_CONFIG } from '../models/types.js';

// @kern-source: config:6
import { ConfigError } from '../models/errors.js';

// @kern-source: config:8
export const AGON_HOME: string = join(homedir(), '.agon');

// @kern-source: config:13
export const GLOBAL_CONFIG_PATH: string = join(AGON_HOME, 'config.json');

// @kern-source: config:18
export const ELO_PATH: string = join(AGON_HOME, 'elo.json');

// @kern-source: config:23
export const RUNS_DIR: string = join(AGON_HOME, 'runs');

// @kern-source: config:28
export const RATINGS_PATH: string = join(AGON_HOME, 'ratings.json');

// @kern-source: config:33
export const TEAM_ELO_PATH: string = join(AGON_HOME, 'team-elo.json');

// @kern-source: config:38
export const CORPUS_PATH: string = join(AGON_HOME, 'corpus.json');

// @kern-source: config:43
export const SKILLS_DIR: string = join(AGON_HOME, 'skills');

// @kern-source: config:48
export const LOCAL_CONFIG_NAME: string = '.agon.json';

// @kern-source: config:49
export const LOCAL_PRIVATE_CONFIG_NAME: string = '.agon.local.json';

// @kern-source: config:51
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
  // Default tool permissions — same model as Claude Code:
  // Read/search = auto-allow, Write/Edit/Bash = ask
  if (!merged.toolPermissions || typeof merged.toolPermissions === 'string') {
    (merged as any).toolPermissions = {
      Read: 'allow',
      Grep: 'allow',
      Glob: 'allow',
      Edit: 'ask',
      Write: 'ask',
      Bash: 'ask',
    };
  }
  if (!(merged as any).permissionMode) (merged as any).permissionMode = 'ask';
  return merged;
}

// @kern-source: config:90
export function configGet(key: keyof AgonConfig, cwd?: string): Required<AgonConfig>[keyof AgonConfig] {
  return loadConfig(cwd)[key];
}

// @kern-source: config:95
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

// @kern-source: config:117
export function ensureAgonHome(): void {
  mkdirSync(AGON_HOME, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
}

