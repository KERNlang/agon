// @kern-source: config:1
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync, rmSync } from 'node:fs';

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
  if (!merged.engineModels || typeof merged.engineModels === 'string') (merged as any).engineModels = {};
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

// @kern-source: config:91
export function configGet(key: keyof AgonConfig, cwd?: string): Required<AgonConfig>[keyof AgonConfig] {
  return loadConfig(cwd)[key];
}

// @kern-source: config:96
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

// @kern-source: config:118
/**
 * Remove old run directories beyond retention limit. Keeps the 100 most recent.
 */
export function pruneRuns(): void {
  try {
    const entries = readdirSync(RUNS_DIR)
      .map((name: string) => {
        try {
          const fullPath = join(RUNS_DIR, name);
          return { name, mtime: statSync(fullPath).mtimeMs };
        } catch { return null; }
      })
      .filter((e: any): e is {name:string, mtime:number} => e !== null)
      .sort((a: {mtime:number}, b: {mtime:number}) => b.mtime - a.mtime);
  
    if (entries.length <= 100) return;
  
    const toRemove = entries.slice(100);
    for (const e of toRemove) {
      try { rmSync(join(RUNS_DIR, e.name), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  } catch { /* dir doesn't exist yet — not critical */ }
}

// @kern-source: config:141
export function ensureAgonHome(): void {
  mkdirSync(AGON_HOME, { recursive: true });
  mkdirSync(RUNS_DIR, { recursive: true });
  pruneRuns();
}

