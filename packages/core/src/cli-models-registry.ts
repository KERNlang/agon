// Facade over ./generated/signals/cli-models-registry.js — edit the source there.

// Re-export types and functions from generated file
export type { CliModelEntry, CliProviderGroup, ProbedModel } from './signals/cli-models-registry.js';
export { buildCliModelGroups, buildCliModelGroupsAsync, buildCliGroupsImmediate, refreshCliGroup, refreshCliGroupVersion, getBinaryVersionAsync, findBinary, getBinaryVersion, readProbedCliModels, refreshProbedCliModels } from './signals/cli-models-registry.js';

import { buildCliModelGroups as _buildSync, buildCliModelGroupsAsync as _buildAsync } from './signals/cli-models-registry.js';
import type { CliProviderGroup } from './signals/cli-models-registry.js';

export function discoverCliModels(): CliProviderGroup[] {
  return _buildSync();
}

export async function discoverCliModelsAsync(): Promise<CliProviderGroup[]> {
  return await _buildAsync();
}


