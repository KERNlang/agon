import { mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';

import { join } from 'node:path';
import { createScopedConfigStore, normalizeKernelSettings, mergeModSettingsLayers, selectModSettings } from '@kernlang/agon-kernel';
import { normalizeBrowserSettings } from '@kernlang/agon-support-browser-bridge';
import { normalizeEngineSettings } from '@kernlang/agon-support-engine-runtime';

import {
  AGON_HOME, CORPUS_PATH, GLOBAL_CONFIG_PATH, RATINGS_PATH, RUNS_DIR, SKILLS_DIR, TEAM_ELO_PATH,
  persistenceHome as getAgonHome, persistencePath as agonPath,
} from '@kernlang/agon-support-persistence';
export { AGON_HOME, CORPUS_PATH, GLOBAL_CONFIG_PATH, RATINGS_PATH, RUNS_DIR, SKILLS_DIR, TEAM_ELO_PATH, getAgonHome, agonPath };

import type { AgonConfig } from '../models/types.js';

import { DEFAULT_AGON_CONFIG } from '../models/types.js';
import { LEGACY_MOD_SETTING_OWNERS } from '../models/first-party-settings.generated.js';

import { ConfigError } from '../models/errors.js';

import { withFileLock } from '../blocks/file-lock.js';

export const RUN_PRUNE_KEEP_COUNT: number = 100;

export const RUN_PRUNE_MIN_AGE_MS: number = 24 * 60 * 60 * 1000;

export const LOCAL_CONFIG_NAME: string = '.agon.json';

export const LOCAL_PRIVATE_CONFIG_NAME: string = '.agon.local.json';

const configStore = createScopedConfigStore<Required<AgonConfig>>({
  globalPath: () => agonPath('config.json'),
  localName: LOCAL_CONFIG_NAME,
  privateLocalName: LOCAL_PRIVATE_CONFIG_NAME,
  merge: mergeConfig,
  withLock: (path, action) => withFileLock(path, action),
  prepareWrite: (existing, key, value) => {
    const updated = { ...existing, [key]: value };
    if (!Object.hasOwn(LEGACY_MOD_SETTING_OWNERS, key)) return updated;
    const owner = LEGACY_MOD_SETTING_OWNERS[key as keyof typeof LEGACY_MOD_SETTING_OWNERS];
    const namespace = selectModSettings(existing, owner);
    const mods = { ...mergeModSettingsLayers(existing), [owner]: { ...namespace, [key]: value } };
    return Object.assign(updated, { mods });
  },
});

export const _configMemoCache = configStore.cache;

/**
 * Clear the loadConfig() memoization cache. Call this after any direct write to config.json / .agon.json / .agon.local.json that doesn't already go through configSet — the mtime-keyed cache would normally self-invalidate on the next loadConfig() call anyway (the file's mtime changes), but this guards against a write landing within the same mtime tick as a subsequent read.
 */
export function invalidateConfigCache(): void {
  configStore.invalidate();
}

export function loadConfig(cwd?: string): Required<AgonConfig> {
  return configStore.load(cwd);
}

function projectLegacyModSettings(layer: Partial<AgonConfig>): Partial<AgonConfig> {
  const projected = { ...layer };
  const originalMods = mergeModSettingsLayers(layer);
  const mods = { ...originalMods };
  for (const [key, owner] of Object.entries(LEGACY_MOD_SETTING_OWNERS)) {
    const namespace = mods[owner];
    const settings = namespace !== null && typeof namespace === 'object' && !Array.isArray(namespace)
      ? namespace as Record<string, unknown> : null;
    if (Object.hasOwn(layer, key) && (!Object.hasOwn(mods, owner) || (settings && !Object.hasOwn(settings, key)))) {
      mods[owner] = { ...settings, [key]: layer[key as keyof AgonConfig] };
    }
  }
  // Keep malformed/inactive namespaces as data until their owner is invoked.
  return originalMods !== undefined || Object.keys(mods).length ? Object.assign(projected, { mods }) : projected;
}

function mergeConfig(global: Partial<AgonConfig>, local: Partial<AgonConfig>, localPrivate: Partial<AgonConfig>): Required<AgonConfig> {
  const layers = [global, local, localPrivate].map(projectLegacyModSettings);
  const merged = { ...DEFAULT_AGON_CONFIG, ...layers[0], ...layers[1], ...layers[2] } as Required<AgonConfig>;
  const mods = mergeModSettingsLayers(...layers);
  if (mods !== undefined) {
    Object.assign(merged, { mods });
    for (const [key, owner] of Object.entries(LEGACY_MOD_SETTING_OWNERS)) {
      if (!Object.hasOwn(mods, owner)) continue;
      const namespace = mods[owner];
      const value = namespace !== null && typeof namespace === 'object' && !Array.isArray(namespace) && Object.hasOwn(namespace, key)
        ? (namespace as Record<string, unknown>)[key] : DEFAULT_AGON_CONFIG[key as keyof AgonConfig];
      Object.assign(merged, { [key]: value });
    }
  }
  // Compiler can't emit object/array defaults for Record types — ensure correct runtime types
  normalizeEngineSettings(merged);
  normalizeBrowserSettings(merged);
  normalizeKernelSettings(merged, global, local, localPrivate);
  return merged;
}

export function configGet(key: keyof AgonConfig, cwd?: string): Required<AgonConfig>[keyof AgonConfig] {
  return loadConfig(cwd)[key];
}

export function configSet(key: keyof AgonConfig, value: AgonConfig[keyof AgonConfig]): void {
  if (!(key in DEFAULT_AGON_CONFIG)) {
    throw new ConfigError(`Unknown config key: ${String(key)}`);
  }
  configStore.set(key, value);
}

/**
 * Remove stale run directories beyond retention limit. Fresh dirs are protected so active forge/plan worktrees are never deleted mid-run.
 */
export function pruneRuns(): void {
  // Review #10: dynamic runs dir via agonPath() — otherwise the frozen
  // RUNS_DIR const would prune the real ~/.agon/runs even in tests that
  // set process.env.AGON_HOME.
  const runsDir = agonPath('runs');
  try {
    const entries = readdirSync(runsDir)
      .map((name: string) => {
        try {
          const fullPath = join(runsDir, name);
          return { name, mtime: statSync(fullPath).mtimeMs };
        } catch { return null; }
      })
      .filter((e: any): e is {name:string, mtime:number} => e !== null)
      .sort((a: {mtime:number}, b: {mtime:number}) => b.mtime - a.mtime);

    if (entries.length <= RUN_PRUNE_KEEP_COUNT) return;

    const now = Date.now();
    const toRemove = entries
      .slice(RUN_PRUNE_KEEP_COUNT)
      .filter((e: {mtime:number}) => now - e.mtime >= RUN_PRUNE_MIN_AGE_MS);
    for (const e of toRemove) {
      try { rmSync(join(runsDir, e.name), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  } catch { /* dir doesn't exist yet — not critical */ }
}

export function ensureAgonHome(): void {
  mkdirSync(getAgonHome(), { recursive: true });
  mkdirSync(agonPath('runs'), { recursive: true });
  pruneRuns();
}
