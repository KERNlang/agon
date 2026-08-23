import { describe, expect, it } from 'vitest';
import { ManifestValidationError, validateManifest } from '../../packages/mod-api/src/index.js';
import { manifest } from '../helpers/modular-agon.js';

describe('Modular Agon manifest v2', () => {
  it('accepts the frozen executable shape and rejects unknown fields', () => {
    const validated = validateManifest(manifest('example.mod'));
    expect(validated.id).toBe('example.mod');
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.dependencies.required)).toBe(true);
    expect(() => validateManifest({ ...manifest('example.mod'), surprise: true })).toThrow(ManifestValidationError);
  });

  it('rejects mod IDs beyond the bounded public contract', () => {
    expect(() => validateManifest(manifest(`a.${'b'.repeat(255)}`))).toThrow(ManifestValidationError);
  });

  it.each(['../escape.js', '/absolute.js', 'dist/../../escape.js'])('rejects non-contained entrypoint %s', (runtime) => {
    expect(() => validateManifest(manifest('example.mod', '1.0.0', {
      entrypoints: { runtime, types: 'dist/index.d.ts' },
    }))).toThrow(ManifestValidationError);
  });

  it('enforces declarative-only restrictions', () => {
    const declarative = manifest('example.docs', '1.0.0', {
      execution: 'declarative',
      entrypoints: undefined,
      contributes: {
        cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [],
        generatedDocs: [{ id: 'docs.example', aliases: [] }],
      },
    });
    expect(validateManifest(declarative).execution).toBe('declarative');
    expect(() => validateManifest({ ...declarative, permissions: [{ capability: 'network', resources: [], required: true }] })).toThrow(/cannot request permissions/);
  });

  it('rejects dependency ambiguity and invalid ranges', () => {
    expect(() => validateManifest(manifest('example.mod', '1.0.0', {
      dependencies: {
        required: [{ id: 'example.dep', range: '^1.0.0' }],
        optional: [{ id: 'example.dep', range: '^2.0.0' }],
        conflicts: [],
      },
    }))).toThrow(/duplicate dependency/);
    expect(() => validateManifest(manifest('example.mod', '1.0.0', { apiRange: 'definitely not semver' }))).toThrow(/semver range/);
  });

  it.each(['../../surface', 'line\nbreak', 'nul\0byte', '🦒', 'a'.repeat(257)])(
    'rejects unsafe or unbounded contribution ID %j',
    (id) => {
      expect(() => validateManifest(manifest('example.mod', '1.0.0', {
        contributes: {
          cliCommands: [{ id, aliases: [] }],
          tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [],
        },
      }))).toThrow(ManifestValidationError);
    },
  );

  it('applies contribution ID rules to asset consumer references', () => {
    expect(() => validateManifest(manifest('example.mod', '1.0.0', {
      assets: [{
        path: 'asset.txt', kind: 'static', mediaType: 'text/plain',
        contentHash: `sha256:${'a'.repeat(64)}`, bytes: 1, executable: false, platforms: ['linux-x64'],
        consumerContributionId: 'unsafe consumer',
      }],
      pack: { include: ['dist/index.js', 'dist/index.d.ts', 'agon.mod.json', 'asset.txt'], executable: [] },
    }))).toThrow(ManifestValidationError);
  });

  it('rejects assets that reference an unknown consumer contribution', () => {
    expect(() => validateManifest(manifest('example.mod', '1.0.0', {
      assets: [{
        path: 'asset.txt', kind: 'static', mediaType: 'text/plain',
        contentHash: `sha256:${'a'.repeat(64)}`, bytes: 1, executable: false, platforms: ['linux-x64'],
        consumerContributionId: 'missing.contribution',
      }],
      pack: { include: ['dist/index.js', 'dist/index.d.ts', 'agon.mod.json', 'asset.txt'], executable: [] },
    }))).toThrow(/unknown consumer contribution/);
  });

  it('requires the manifest itself in the packed file list', () => {
    expect(() => validateManifest(manifest('example.mod', '1.0.0', {
      pack: { include: ['dist/index.js', 'dist/index.d.ts'], executable: [] },
    }))).toThrow(/agon\.mod\.json/);
  });
});
