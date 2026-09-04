import { describe, expect, it, vi } from 'vitest';

import type { CommandContribution, InvocationContext } from '../../packages/mod-api/src/index.js';
import {
  FIRST_PARTY_SURFACE_CATALOG,
  SurfaceGeneration,
  SurfaceGenerationError,
  SurfaceGenerationSelector,
  assertGeneratedSurfaceAccessibility,
} from '../../packages/mod-kernel/src/index.js';
import type { GeneratedSurfaceCatalogEntry, GeneratedSurfaceRuntime, Surface } from '../../packages/mod-kernel/src/index.js';

const context: InvocationContext = {
  invocationId: 'surface-test',
  cwd: '/tmp/surface-test',
  platform: 'darwin-arm64',
  signal: new AbortController().signal,
  config: {},
};

function runtime(): GeneratedSurfaceRuntime & { calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn();
  return {
    calls,
    command: (surface, publicId, input) => { calls(surface, publicId, input); return { exitCode: 0, result: input }; },
    tool: (surface, publicId, input) => { calls(surface, publicId, input); return input; },
    parseIntent: (publicId, input) => { calls('intent', publicId, input); return { publicId, input }; },
    renderDocs: (publicId) => ({ text: publicId }),
  };
}

function generation(id: string, disabledOwnerIds: readonly string[] = []): SurfaceGeneration {
  return new SurfaceGeneration({
    id,
    mode: 'generated-authoritative',
    catalog: FIRST_PARTY_SURFACE_CATALOG,
    runtime: runtime(),
    disabledOwnerIds,
  });
}

describe('generated surface generation', () => {
  it('builds one immutable owner-tagged generation for all five surfaces', () => {
    const subject = generation('generated:test');
    expect(subject.catalog()).toHaveLength(449);
    expect(Object.fromEntries(['cli', 'tui', 'mcp', 'cesar', 'docs'].map((surface) => [surface, subject.project(surface as Surface).entries.length]))).toEqual({
      cli: 77,
      tui: 237,
      mcp: 33,
      cesar: 99,
      docs: 3,
    });
    assertGeneratedSurfaceAccessibility(subject);
    expect(Object.isFrozen(subject)).toBe(true);
    expect(Object.isFrozen(subject.catalog())).toBe(true);
  });

  it('dispatches generated records through the injected runtime using public IDs', async () => {
    const adapter = runtime();
    const subject = new SurfaceGeneration({ id: 'generated:dispatch', mode: 'generated-authoritative', catalog: FIRST_PARTY_SURFACE_CATALOG, runtime: adapter });
    const entry = subject.catalog('cli').find(({ publicId }) => publicId === 'ask')!;
    const record = subject.registry.resolve(entry.kind, entry.registryId)!;
    await (record.payload as CommandContribution).run({ prompt: 'hello' }, context);
    expect(adapter.calls).toHaveBeenCalledWith('cli', 'ask', { prompt: 'hello' });
    expect(subject.resolvePublic('tui', 'autonomous').map(({ owner }) => owner.id)).toEqual([expect.any(String)]);
    expect(subject.resolvePublic('tui', 'auto').map(({ owner }) => owner.id)).toContain(subject.resolvePublic('tui', 'autonomous')[0]?.owner.id);
  });

  it('removes disabled owners from every projection and cached public lookup', () => {
    const owner = FIRST_PARTY_SURFACE_CATALOG.find(({ owner }) => owner.id !== 'agon.kernel')!.owner.id;
    const subject = generation('generated:disabled', [owner]);
    for (const surface of ['cli', 'tui', 'mcp', 'cesar', 'docs'] as const) {
      expect(subject.project(surface).entries.some((entry) => entry.owner.id === owner)).toBe(false);
      for (const entry of FIRST_PARTY_SURFACE_CATALOG.filter((candidate) => candidate.surface === surface && candidate.owner.id === owner)) {
        expect(subject.resolvePublic(surface, entry.publicId)).toEqual([]);
      }
    }
  });

  it('rejects stale clients after atomic selection and supports rollback to the retained generation', () => {
    const legacy = generation('legacy:s5');
    const selector = new SurfaceGenerationSelector(legacy);
    const stale = selector.client('cli');
    const generated = generation('generated:s6');
    selector.select(generated, (candidate) => expect(candidate.project('cli').entries.length).toBeGreaterThan(0));
    expect(() => stale.project()).toThrowError(SurfaceGenerationError);
    try { stale.project(); } catch (error) {
      expect(error).toMatchObject({ code: 'MOD_GENERATION_MISMATCH', restartRequired: true });
    }
    selector.rollback('legacy:s5');
    expect(stale.project().generation).toBe('legacy:s5');
  });

  it('leaves the active pointer unchanged when candidate verification fails', () => {
    const selector = new SurfaceGenerationSelector(generation('legacy:s5'));
    expect(() => selector.select(generation('generated:bad'), () => { throw new Error('candidate failed'); })).toThrow('candidate failed');
    expect(selector.active.id).toBe('legacy:s5');
  });

  it('refuses ambiguous public dispatch instead of selecting an arbitrary record', () => {
    const base = FIRST_PARTY_SURFACE_CATALOG.find(({ surface }) => surface === 'cli')!;
    const duplicate: GeneratedSurfaceCatalogEntry = { ...base, registryId: `${base.registryId}:duplicate` };
    const subject = new SurfaceGeneration({ id: 'generated:ambiguous', mode: 'generated-authoritative', catalog: [base, duplicate], runtime: runtime() });
    try { subject.assertAvailable('cli', base.publicId); } catch (error) {
      expect(error).toMatchObject({ code: 'MOD_SURFACE_AMBIGUOUS' });
    }
  });

  it('fails accessibility qualification when semantic fallback metadata is removed', () => {
    const tui = FIRST_PARTY_SURFACE_CATALOG.find(({ surface }) => surface === 'tui')!;
    const broken: GeneratedSurfaceCatalogEntry = { ...tui, accessibility: { ...tui.accessibility, fallbackText: '' } };
    const subject = new SurfaceGeneration({ id: 'generated:inaccessible', mode: 'generated-authoritative', catalog: [broken], runtime: runtime() });
    expect(() => assertGeneratedSurfaceAccessibility(subject)).toThrow(/accessibility text is missing/);
  });
});
