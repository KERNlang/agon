// Public CLI-model registry surface over ./signals/cli-models-registry.ts.

export type { CliModelEntry, CliProviderGroup, ProbedModel } from './cli-models-registry.js';
export { buildCliModelGroups, buildCliModelGroupsAsync, buildCliGroupsImmediate, refreshCliGroup, refreshCliGroupVersion, getBinaryVersionAsync, findBinary, getBinaryVersion, readProbedCliModels, refreshProbedCliModels } from './cli-models-registry.js';

import { buildCliModelGroups as _buildSync, buildCliModelGroupsAsync as _buildAsync } from './cli-models-registry.js';
import type { CliProviderGroup } from './cli-models-registry.js';

export function discoverCliModels(): CliProviderGroup[] {
  return _buildSync();
}

export async function discoverCliModelsAsync(): Promise<CliProviderGroup[]> {
  return await _buildAsync();
}
