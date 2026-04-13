// ── CLI Models Registry — KERN-sourced ──────────────────────────────────
// Source of truth: kern/cli-models-registry.kern
// Note: The KERN compiler doesn't support `let` declarations, so we inject
// the cache variable here and re-export everything from the generated file.
// The generated file references `cliModelsCache` without declaring it.

// Re-export types and data (the generated file has no cache declaration)
export type { CliModelEntry, CliProviderGroup } from './generated/signals/cli-models-registry.js';
export { CLI_MODELS_REGISTRY, findBinary, getBinaryVersion } from './generated/signals/cli-models-registry.js';

// The generated discoverCliModels/refreshCliModels/getCliModelsGrouped reference
// `cliModelsCache` which the KERN compiler omits. We need to ensure it exists
// at module scope. Since the generated file is a separate module, we can't
// inject into its scope. Instead, we provide our own implementations here.
import { CLI_MODELS_REGISTRY as REGISTRY, findBinary as _findBinary, getBinaryVersion as _getVersion } from './generated/signals/cli-models-registry.js';
import type { CliProviderGroup, CliModelEntry } from './generated/signals/cli-models-registry.js';

let _cache: CliProviderGroup[] | null = null;

export function discoverCliModels(): CliProviderGroup[] {
  const groups: CliProviderGroup[] = [];

  for (const provider of Object.values(REGISTRY)) {
    const binaryPath = _findBinary(provider.engineBinary);
    const installed = binaryPath !== null;
    const version = installed ? _getVersion(provider.engineBinary, provider.versionCmd) : null;

    const models: CliModelEntry[] = provider.models.map((m) => ({
      id: m.id,
      name: m.name,
      providerId: provider.providerId,
      providerName: provider.providerName,
      engineId: provider.engineId,
      engineBinary: provider.engineBinary,
      contextWindow: m.contextWindow,
      toolCall: m.toolCall,
      reasoning: m.reasoning,
    }));

    groups.push({
      providerId: provider.providerId,
      providerName: provider.providerName,
      engineId: provider.engineId,
      engineBinary: provider.engineBinary,
      installed,
      version,
      models,
    });
  }

  // Sort: installed first, then by name
  groups.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.providerName.localeCompare(b.providerName);
  });

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
