import { describe, expect, it } from 'vitest';
import type { ModIdentity, ModSource } from '@kernlang/agon-mod-api';
import { ModRegistry, RegistryInvariantError, resolveCandidates } from '../../packages/mod-kernel/src/index.js';
import { candidate } from '../helpers/modular-agon.js';

const runtime = { platform: 'darwin-arm64' as const, kernelVersion: '1.0.0', apiVersion: '1.0.0', nodeVersion: '22.22.0' };

describe('Slice 1A independent-review regressions', () => {
  it('backtracks from the highest version when its dependency range cannot be satisfied', () => {
    const high = candidate('example.consumer', '2.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.provider', range: '^2.0.0' }], optional: [], conflicts: [] } } });
    const low = candidate('example.consumer', '1.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.provider', range: '^1.0.0' }], optional: [], conflicts: [] } } });
    const graph = resolveCandidates([high, low, candidate('example.provider', '1.9.0')], ['example.consumer', 'example.provider'], runtime);
    expect(graph.selectedById.get('example.consumer')?.manifest.version).toBe('1.0.0');
  });

  it('backtracks from a conflicting high version to a compatible low version', () => {
    const high = candidate('example.consumer', '2.0.0', 'registry', { manifest: { dependencies: { required: [], optional: [], conflicts: ['example.other'] } } });
    const low = candidate('example.consumer', '1.0.0');
    const graph = resolveCandidates([high, low, candidate('example.other')], ['example.consumer', 'example.other'], runtime);
    expect(graph.selectedById.get('example.consumer')?.manifest.version).toBe('1.0.0');
  });

  it('returns specific failures for rejected reserved IDs and unknown runtime sources', () => {
    expect(() => resolveCandidates([
      candidate('agon.think', '99.0.0', 'user-folder', { publisherIdentity: undefined, provenanceVerified: false }),
    ], ['agon.think'], runtime)).toThrowError(expect.objectContaining({ code: 'reserved-first-party-id' }));

    const unknown = { ...candidate('example.mod'), source: 'network-share' as ModSource };
    expect(() => resolveCandidates([unknown], ['example.mod'], runtime)).toThrowError(expect.objectContaining({ code: 'untrusted-source' }));
  });

  it('deep-freezes legacy payloads and rejects impossible surface-kind pairs', () => {
    const owner: ModIdentity = { id: 'agon.fixture', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` };
    const payload = { nested: { value: true } };
    const registry = ModRegistry.fromLegacy({ generation: 'review', activeOwners: [owner] }, [{
      surface: 'cli', kind: 'cli-command', id: 'fixture', owner, payload,
    }]);
    expect(Object.isFrozen(registry.resolve('cli-command', 'fixture')?.payload)).toBe(true);
    expect(Object.isFrozen(payload.nested)).toBe(true);
    expect(() => ModRegistry.fromLegacy({ generation: 'review', activeOwners: [owner] }, [{
      surface: 'mcp', kind: 'cli-command', id: 'bad', owner,
    }])).toThrowError(RegistryInvariantError);
  });

  it('deep-freezes hostile payload depth without consuming the call stack', () => {
    const owner: ModIdentity = { id: 'agon.fixture', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` };
    let payload: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 20_000; depth += 1) payload = { child: payload };

    expect(() => ModRegistry.fromLegacy({ generation: 'review-depth', activeOwners: [owner] }, [{
      surface: 'cli', kind: 'cli-command', id: 'fixture-depth', owner, payload,
    }])).not.toThrow();
    expect(Object.isFrozen(payload)).toBe(true);
  });
});
