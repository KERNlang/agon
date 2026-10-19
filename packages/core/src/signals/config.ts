import { mkdirSync, readdirSync, lstatSync, rmSync } from 'node:fs';

import { join } from 'node:path';
import { createScopedConfigStore, normalizeKernelSettings, mergeModSettingsLayers, selectModSettings, projectLegacyModSettings, withSynchronousWriterFence, readSelectedGenerationConfigurationSync, applyModSettingsDefaults, readLegacyConfigAliases, resolveRegisteredModSettings, currentInvocationConfiguration } from '@kernlang/agon-kernel';
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

import { ConfigError } from '@kernlang/agon-kernel';

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
  withLock: (path, action) => withFileLock(path, () => {
    const hostRoot = process.env.AGON_MODULAR_HOST_ROOT ?? join(getAgonHome(), 'modular-host');
    withSynchronousWriterFence(join(hostRoot, 'locks', 'writer.json'), 'agon.kernel.config', () => { action(); });
  }),
  prepareWrite: (existing, key, value) => {
    const updated = { ...existing, [key]: value };
    if (!Object.hasOwn(LEGACY_MOD_SETTING_OWNERS, key)) return updated;
    const owner = LEGACY_MOD_SETTING_OWNERS[key as keyof typeof LEGACY_MOD_SETTING_OWNERS];
    const namespace = selectModSettings(existing, owner);
    const mods = { ...mergeModSettingsLayers(existing), [owner]: { ...namespace, [key]: value } };
    const proposed = Object.assign(updated, { mods });
    const descriptor = selectedConfiguration(false)?.owners.find(candidate => candidate.ownerId === owner);
    if (descriptor) {
      const effective = projectLegacyModSettings(proposed, LEGACY_MOD_SETTING_OWNERS);
      resolveRegisteredModSettings(owner, selectModSettings(effective, owner), [descriptor.schema]);
    }
    return proposed;
  },
});

export const _configMemoCache = configStore.cache;

/**
 * Clear the cached merge. Each load also checks source contents for changes.
 */
export function invalidateConfigCache(): void {
  configStore.invalidate();
}

function selectedConfiguration(useInvocation = true) {
  // Safe mode must remain usable when the selected mod generation is corrupt.
  if (process.env.AGON_MOD_SAFE_MODE === '1') return undefined;
  const hostRoot = process.env.AGON_MODULAR_HOST_ROOT ?? join(getAgonHome(), 'modular-host');
  const invocation = useInvocation ? currentInvocationConfiguration() : undefined;
  const generation = invocation ? invocation.configuration : readSelectedGenerationConfigurationSync(hostRoot);
  if (generation && generation.source.path !== agonPath('config.json')) throw new ConfigError('Selected configuration belongs to another source path. Requalify this installation.');
  return generation;
}

export function loadConfig(cwd?: string): Required<AgonConfig> {
  const config = configStore.load(cwd);
  const generation = selectedConfiguration();
  if (!generation) return config;
  const mods = { ...mergeModSettingsLayers(config) };
  for (const owner of generation.owners) {
    const selected = mods[owner.ownerId];
    // Retain inactive malformed values. The registry validates the invoked owner.
    if (Object.hasOwn(mods, owner.ownerId) && (!selected || typeof selected !== 'object' || Array.isArray(selected))) continue;
    let settings: Record<string, unknown>;
    try { settings = applyModSettingsDefaults(owner.schema, (selected ?? {}) as Record<string, unknown>); }
    catch (error) {
      // Defer owner-local validation errors to invocation, not unrelated reads.
      if (error instanceof TypeError) continue;
      throw error;
    }
    mods[owner.ownerId] = settings;
    for (const key of readLegacyConfigAliases(owner.schema)) {
      if (Object.hasOwn(settings, key)) Object.assign(config, { [key]: settings[key] });
    }
  }
  Object.assign(config, { mods });
  return config;
}

function mergeConfig(global: Partial<AgonConfig>, local: Partial<AgonConfig>, localPrivate: Partial<AgonConfig>): Required<AgonConfig> {
  const layers = [global, local, localPrivate].map(layer => projectLegacyModSettings(layer, LEGACY_MOD_SETTING_OWNERS));
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
 * Remove stale run directories beyond the retention limit. Keep fresh directories.
 * Run records and metadata have a separate retention policy.
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
          const entry = lstatSync(fullPath);
          return entry.isDirectory() ? { name, mtime: entry.mtimeMs } : null;
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
