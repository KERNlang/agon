import { loadConfig, resolveWorkingDir } from '@kernlang/agon-core';
import { runCampfireRuntime } from '@kernlang/agon-mod-campfire';
import type { CampfireOptions, CampfireResult } from '@kernlang/agon-mod-campfire';

export type { CampfireResult } from '@kernlang/agon-mod-campfire';

// Retain public callers while the mod owns discussion policy and execution.
export async function runCampfire(options: Omit<CampfireOptions, 'cwd'>): Promise<CampfireResult> {
  const { topic, rounds } = await runCampfireRuntime({ ...options, cwd: resolveWorkingDir() }, {
    loadConfig, warn: message => console.warn(message),
  });
  return { topic, rounds };
}
