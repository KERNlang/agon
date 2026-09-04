import type { ModCandidate } from '../../packages/mod-kernel/src/index.js';
import type { ModManifest, ModSource } from '../../packages/mod-api/src/index.js';

export function manifest(
  id: string,
  version = '1.0.0',
  overrides: Partial<ModManifest> = {},
): ModManifest {
  return {
    schemaVersion: 2,
    id,
    name: id,
    version,
    apiRange: '^1.0.0',
    execution: 'executable',
    compatibility: { kernelRange: '^1.0.0', nodeRange: '>=22 <27' },
    packageClass: 'user-toggleable-mod-package',
    entrypoints: { runtime: 'dist/index.js', types: 'dist/index.d.ts' },
    display: { group: 'test', order: 1 },
    dependencies: { required: [], optional: [], conflicts: [] },
    permissions: [],
    platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
    assets: [],
    contributes: {
      cliCommands: [],
      tuiActions: [],
      mcpTools: [],
      cesarTools: [],
      lifecycleHooks: [],
      resultTypes: [],
      configKeys: [],
      generatedDocs: [],
    },
    pack: { include: ['dist/index.js', 'dist/index.d.ts', 'agon.mod.json', 'package.json'], executable: [] },
    ...overrides,
  };
}

export function candidate(
  id: string,
  version = '1.0.0',
  source: ModSource = 'registry',
  overrides: Partial<ModCandidate> & { manifest?: Partial<ModManifest> } = {},
): ModCandidate {
  const { manifest: manifestOverrides = {}, ...candidateOverrides } = overrides;
  return {
    manifest: manifest(id, version, manifestOverrides),
    source,
    sourceLocator: `${source}:${id}@${version}`,
    publisherIdentity: id.startsWith('agon.') ? 'kernlang:first-party-release-set' : undefined,
    provenanceVerified: id.startsWith('agon.') ? true : undefined,
    ...candidateOverrides,
  } as ModCandidate;
}
