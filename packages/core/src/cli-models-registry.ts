// ── CLI Models Registry — KERN-sourced ──────────────────────────────────
// Source of truth: kern/cli-models-registry.kern

// Re-export types and functions from generated file
export type { CliModelEntry, CliProviderGroup } from './generated/signals/cli-models-registry.js';
export { buildCliModelGroups, buildCliModelGroupsAsync, findBinary, getBinaryVersion } from './generated/signals/cli-models-registry.js';

import { buildCliModelGroups as _buildSync, buildCliModelGroupsAsync as _buildAsync } from './generated/signals/cli-models-registry.js';
import type { CliProviderGroup } from './generated/signals/cli-models-registry.js';

let _cache: CliProviderGroup[] | null = null;

export function discoverCliModels(): CliProviderGroup[] {
  const groups = _buildSync();
  _cache = groups;
  return groups;
}

export async function discoverCliModelsAsync(): Promise<CliProviderGroup[]> {
  const groups = await _buildAsync();
  _cache = groups;
  return groups;
}

export function refreshCliModels(): CliProviderGroup[] {
  return discoverCliModels();
}

export function getCliModelsGrouped(): CliProviderGroup[] {
  if (_cache) return _cache;
  return discoverCliModels();
}
