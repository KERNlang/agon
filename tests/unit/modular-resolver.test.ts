import { describe, expect, it } from 'vitest';
import { ModResolutionError, resolveCandidates } from '../../packages/mod-kernel/src/index.js';
import { candidate } from '../helpers/modular-agon.js';

const runtime = { platform: 'darwin-arm64' as const, kernelVersion: '1.0.0', apiVersion: '1.0.0', nodeVersion: '22.22.0' };

describe('Modular Agon deterministic resolver', () => {
  it('is permutation invariant and topologically stable', () => {
    const candidates = [
      candidate('example.gamma'),
      candidate('example.alpha'),
      candidate('example.beta', '1.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.alpha', range: '^1.0.0' }], optional: [], conflicts: [] } } }),
    ];
    const expected = ['example.alpha', 'example.beta', 'example.gamma'];
    const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const permutation of permutations) {
      expect(resolveCandidates(permutation.map((index) => candidates[index]!), expected, runtime).order).toEqual(expected);
    }
  });

  it('selects source precedence before the highest compatible version', () => {
    const result = resolveCandidates([
      candidate('example.mod', '9.0.0', 'bundled'),
      candidate('example.mod', '2.0.0', 'registry'),
      candidate('example.mod', '1.5.0', 'user-folder'),
      candidate('example.mod', '1.4.0', 'user-folder'),
    ], ['example.mod'], runtime);
    expect(result.selected[0]?.manifest.version).toBe('1.5.0');
    expect(result.shadowed).toHaveLength(2);
  });

  it('rejects same-rank collisions, conflicts, missing dependencies, and complete cycle paths', () => {
    expect(() => resolveCandidates([
      candidate('example.mod', '1.0.0', 'registry', { sourceLocator: 'registry:a' }),
      candidate('example.mod', '1.0.0', 'registry', { sourceLocator: 'registry:b' }),
    ], ['example.mod'], runtime)).toThrowError(expect.objectContaining({ code: 'collision' }));

    const dependent = candidate('example.one', '1.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.two', range: '^1.0.0' }], optional: [], conflicts: [] } } });
    expect(() => resolveCandidates([dependent], ['example.one'], runtime)).toThrowError(expect.objectContaining({ code: 'missing-dependency' }));

    const one = candidate('example.one', '1.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.two', range: '^1.0.0' }], optional: [], conflicts: [] } } });
    const two = candidate('example.two', '1.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.one', range: '^1.0.0' }], optional: [], conflicts: [] } } });
    expect(() => resolveCandidates([one, two], ['example.one', 'example.two'], runtime)).toThrowError(expect.objectContaining({
      code: 'dependency-cycle', details: { cycle: ['example.one', 'example.two', 'example.one'] },
    }));

    const conflict = candidate('example.one', '1.0.0', 'registry', { manifest: { dependencies: { required: [], optional: [], conflicts: ['example.two'] } } });
    expect(() => resolveCandidates([conflict, candidate('example.two')], ['example.one', 'example.two'], runtime)).toThrowError(expect.objectContaining({ code: 'conflict' }));
  });

  it('protects reserved first-party IDs', () => {
    const hostile = candidate('agon.think', '99.0.0', 'user-folder', { publisherIdentity: undefined, provenanceVerified: false });
    expect(() => resolveCandidates([hostile], ['agon.think'], runtime)).toThrowError(expect.objectContaining({ code: 'reserved-first-party-id' }));
    expect(resolveCandidates([candidate('agon.think', '1.0.0', 'registry')], ['agon.think'], runtime).selected).toHaveLength(1);
  });

  it('requires explicit prerelease, yanked, and downgrade authority', () => {
    const prerelease = candidate('example.mod', '2.0.0-beta.1');
    expect(() => resolveCandidates([prerelease], ['example.mod'], runtime)).toThrowError(expect.objectContaining({ code: 'no-eligible-version' }));
    expect(resolveCandidates([prerelease], ['example.mod'], { ...runtime, requestedVersions: { 'example.mod': '2.0.0-beta.1' } }).selected[0]?.manifest.version).toBe('2.0.0-beta.1');

    const yanked = candidate('example.mod', '1.0.0', 'registry', { yanked: true });
    expect(() => resolveCandidates([yanked], ['example.mod'], runtime)).toThrowError(expect.objectContaining({ code: 'no-eligible-version' }));
    expect(resolveCandidates([yanked], ['example.mod'], { ...runtime, frozenVersions: { 'example.mod': '1.0.0' } }).selected).toHaveLength(1);

    const old = candidate('example.mod', '1.0.0');
    expect(() => resolveCandidates([old], ['example.mod'], { ...runtime, currentVersions: { 'example.mod': '2.0.0' } })).toThrowError(expect.objectContaining({ code: 'downgrade-not-approved' }));
    expect(resolveCandidates([old], ['example.mod'], { ...runtime, currentVersions: { 'example.mod': '2.0.0' }, allowDowngrade: ['example.mod'] }).selected).toHaveLength(1);
  });

  it('solves one version per ID against all required ranges', () => {
    const consumer = candidate('example.consumer', '1.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.provider', range: '^1.0.0' }], optional: [], conflicts: [] } } });
    const result = resolveCandidates([
      consumer,
      candidate('example.provider', '2.0.0'),
      candidate('example.provider', '1.9.0'),
    ], ['example.consumer', 'example.provider'], runtime);
    expect(result.selectedById.get('example.provider')?.manifest.version).toBe('1.9.0');
    expect((result.selectedById as Map<string, unknown>).set).toBeUndefined();
  });

  it('allows an exactly pinned prerelease dependency without a global opt-in', () => {
    const consumer = candidate('example.consumer', '1.0.0', 'registry', { manifest: { dependencies: { required: [{ id: 'example.provider', range: '=2.0.0-beta.1' }], optional: [], conflicts: [] } } });
    const provider = candidate('example.provider', '2.0.0-beta.1');
    expect(resolveCandidates([consumer, provider], ['example.consumer', 'example.provider'], runtime).selectedById.get('example.provider')?.manifest.version).toBe('2.0.0-beta.1');
  });

  it('returns typed errors', () => {
    try {
      resolveCandidates([], ['example.missing'], runtime);
      throw new Error('expected resolver failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ModResolutionError);
      expect((error as ModResolutionError).code).toBe('not-installed');
    }
  });

  it('does not let an unselected candidate authorize a prerelease', () => {
    const unselected = candidate('example.unselected', '1.0.0', 'registry', {
      manifest: { dependencies: { required: [{ id: 'example.provider', range: '=2.0.0-beta.1' }], optional: [], conflicts: [] } },
    });
    expect(() => resolveCandidates([
      unselected,
      candidate('example.provider', '2.0.0-beta.1'),
    ], ['example.provider'], runtime)).toThrowError(expect.objectContaining({ code: 'no-eligible-version' }));
  });

  it('reports invalid option versions as typed resolver errors', () => {
    expect(() => resolveCandidates([candidate('example.mod')], ['example.mod'], {
      ...runtime, currentVersions: { 'example.mod': 'not-semver' },
    })).toThrowError(expect.objectContaining({ name: 'ModResolutionError' }));
  });


  it('does not let an unselected version of a desired mod authorize a prerelease', () => {
    const selectedConsumer = candidate('example.consumer', '2.0.0', 'registry', {
      manifest: { dependencies: { required: [{ id: 'example.provider', range: '>=2.0.0-beta.1' }], optional: [], conflicts: [] } },
    });
    const unselectedConsumer = candidate('example.consumer', '1.0.0', 'registry', {
      manifest: { dependencies: { required: [{ id: 'example.provider', range: '=2.0.0-beta.1' }], optional: [], conflicts: [] } },
    });
    const resolved = resolveCandidates([
      selectedConsumer, unselectedConsumer, candidate('example.provider', '2.0.0-beta.1'),
    ], ['example.consumer', 'example.provider'], runtime);
    expect(resolved.selectedById.get('example.consumer')?.manifest.version).toBe('1.0.0');
  });

  it('preserves typed compatibility failures when no candidate is compatible', () => {
    expect(() => resolveCandidates([candidate('example.mod', '1.0.0', 'registry', { manifest: { platforms: ['darwin-arm64'] } })], ['example.mod'], { ...runtime, platform: 'linux-x64' }))
      .toThrowError(expect.objectContaining({ code: 'unsupported-platform' }));
    expect(() => resolveCandidates([candidate('example.mod')], ['example.mod'], { ...runtime, apiVersion: '9.0.0' }))
      .toThrowError(expect.objectContaining({ code: 'incompatible-mod-api' }));
  });

  it('rejects malformed host versions and candidate identity metadata with typed errors', () => {
    expect(() => resolveCandidates([candidate('example.mod')], ['example.mod'], { ...runtime, kernelVersion: 'not-semver' }))
      .toThrowError(expect.objectContaining({ name: 'ModResolutionError' }));
    expect(() => resolveCandidates([candidate('example.mod', '1.0.0', 'registry', { sourceLocator: '' })], ['example.mod'], runtime))
      .toThrowError(expect.objectContaining({ name: 'ModResolutionError' }));
    expect(() => resolveCandidates([candidate('example.mod', '1.0.0', 'registry', { contentHash: 'sha256:bad' as `sha256:${string}` })], ['example.mod'], runtime))
      .toThrowError(expect.objectContaining({ name: 'ModResolutionError' }));
  });
  it('resolves a valid 3000-node dependency chain without overflowing the stack', () => {
    const count = 3000;
    const candidates = Array.from({ length: count }, (_, index) => candidate(
      `example.node-${String(index).padStart(4, '0')}`,
      '1.0.0',
      'registry',
      index === 0 ? {} : {
        manifest: {
          dependencies: {
            required: [{ id: `example.node-${String(index - 1).padStart(4, '0')}`, range: '^1.0.0' }],
            optional: [], conflicts: [],
          },
        },
      },
    ));
    const desired = candidates.map(({ manifest }) => manifest.id);
    expect(resolveCandidates(candidates, desired, runtime).order).toHaveLength(count);
  });

  it('bounds hostile unsatisfiable search with a typed error', () => {
    const width = 20;
    const providers = Array.from({ length: width }, (_, index) => [
      candidate(`example.p-${String(index).padStart(2, '0')}`, '2.0.0'),
      candidate(`example.p-${String(index).padStart(2, '0')}`, '1.0.0'),
    ]).flat();
    const required = (range: string) => Array.from({ length: width }, (_, index) => ({
      id: `example.p-${String(index).padStart(2, '0')}`, range,
    }));
    const low = candidate('example.z-low', '1.0.0', 'registry', {
      manifest: { dependencies: { required: required('^1.0.0'), optional: [], conflicts: [] } },
    });
    const high = candidate('example.z-high', '1.0.0', 'registry', {
      manifest: { dependencies: { required: required('^2.0.0'), optional: [], conflicts: [] } },
    });
    const desired = [...providers.map(({ manifest }) => manifest.id), low.manifest.id, high.manifest.id];
    const started = performance.now();
    expect(() => resolveCandidates([...providers, low, high], [...new Set(desired)], runtime))
      .toThrowError(expect.objectContaining({ code: 'resolution-budget-exceeded' }));
    // Wall time is only a runaway guard; deterministic attempt accounting is the actual bound.
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
