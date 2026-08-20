// Facade over ./generated/signals/cli-models-registry.js — edit the source there.

// Re-export types and functions from generated file
export type { CliModelEntry, CliProviderGroup, ProbedModel } from './generated/signals/cli-models-registry.js';
export { buildCliModelGroups, buildCliModelGroupsAsync, buildCliGroupsImmediate, refreshCliGroup, refreshCliGroupVersion, getBinaryVersionAsync, findBinary, getBinaryVersion, readProbedCliModels, refreshProbedCliModels } from './generated/signals/cli-models-registry.js';

import { buildCliModelGroups as _buildSync, buildCliModelGroupsAsync as _buildAsync } from './generated/signals/cli-models-registry.js';
import type { CliProviderGroup } from './generated/signals/cli-models-registry.js';

export function discoverCliModels(): CliProviderGroup[] {
  return _buildSync();
}

export async function discoverCliModelsAsync(): Promise<CliProviderGroup[]> {
  return await _buildAsync();
}


