import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDispatchOptions, InvocationContext } from '@kernlang/agon-mod-api';
import { glicko } from '@kernlang/agon-mod-ratings';
import { classifyTask } from '@kernlang/agon-support-dedup';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import { EngineRegistry as CatalogEngineRegistry } from '@kernlang/agon-support-engine-catalog';
import { tracker } from '../../packages/core/src/signals/token-tracker.js';
import type { BrainstormModServices } from '@kernlang/agon-mod-brainstorm';

// Stop at the adapter boundary: no engine process, personal configuration or
// run directory is needed to test the actual CLI and MCP host implementations.
const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  brainstorm: { open: vi.fn() },
  brainstormFactory: vi.fn(),
  realHost: false, adapterOpened: vi.fn(), rating: vi.fn(() => ({ mu: 1000, phi: 30 })),
  captureCli: vi.fn(), captureMcp: vi.fn(), assertCli: vi.fn(), assertCurrent: vi.fn(),
  forge: { open: vi.fn() },
  loadConfig: vi.fn(() => ({})),
  engine: { id: 'fixture-engine' },
}));
vi.mock('@kernlang/agon-core', async () => ({
  tracker: (await import('../../packages/core/src/signals/token-tracker.js')).tracker,
  EngineRegistry: class {
    load() {}
    activeIds() { return ['fixture-engine']; }
    listIds() { return ['fixture-engine', 'disabled-engine', 'filtered-engine']; }
    get() { return fixture.engine; }
  },
  loadConfig: fixture.loadConfig,
  createForgeHostServices: () => fixture.forge,
  agonPath: vi.fn(), ensureAgonHome: vi.fn(), worktreeCreate: vi.fn(),
  worktreeRemoveBestEffort: vi.fn(), spawnWithTimeout: vi.fn(),
  createSessionWorktree: vi.fn(), findSessionWorktree: vi.fn(),
  worktreePathFor: vi.fn(), rehydrateSessionWorktree: vi.fn(),
  createRunDir: () => ({ id: 'fixture-run', path: '/fixture/output' }),
  getRatings: vi.fn(), pickTopRatedEngine: vi.fn(), writeRunStatus: vi.fn(),
  eventLogFlush: vi.fn(), setSessionRoot: vi.fn(),
}));
vi.mock('@kernlang/agon-adapter-cli', () => ({ createCliAdapter: () => {
  fixture.adapterOpened(); return { dispatch: fixture.dispatch };
} }));
vi.mock('@kernlang/agon-mod-brainstorm', async importOriginal => {
  const actual = await importOriginal<typeof import('@kernlang/agon-mod-brainstorm')>();
  return { ...actual, createBrainstormHostServices: (effects: Parameters<typeof actual.createBrainstormHostServices>[0]) => {
    fixture.brainstormFactory(effects);
    return fixture.realHost ? actual.createBrainstormHostServices(effects) : fixture.brainstorm;
  } };
});
vi.mock('@kernlang/agon-mod-ratings', async importOriginal => {
  const actual = await importOriginal<typeof import('@kernlang/agon-mod-ratings')>();
  return { ...actual, glicko: { ...actual.glicko, getEngineGlickoRating: fixture.rating } };
});
vi.mock('@kernlang/agon-support-engine-runtime', async importOriginal => ({
  ...await importOriginal<typeof import('@kernlang/agon-support-engine-runtime')>(),
  resolveEngineDefinitionsDir: () => '/fixture/engines',
}));
vi.mock('../../packages/cli/src/lib/engines-dir.js', () => ({ resolveBuiltinEnginesDir: () => '/fixture/engines' }));
vi.mock('../../packages/cli/src/handlers/engine-filter.js', () => ({ filterDefaultOrchestrationEngines: (ids: string[]) => ids }));
vi.mock('../../packages/cli/src/patch-application-host.js', () => ({ patchApplicationHost: {} }));
vi.mock('../../packages/cli/src/bridge/serve-runtime.js', () => ({}));
vi.mock('../../packages/cli/src/commands/chrome.js', () => ({}));
vi.mock('../../packages/cli/src/commands/drive.js', () => ({}));
vi.mock('../../packages/cli/src/commands/ext.js', () => ({}));
vi.mock('../../packages/cli/src/commands/browser-host.js', () => ({}));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', () => ({
  captureProcessSurfaceAuthority: fixture.captureCli,
  assertProcessSurfaceAvailable: fixture.assertCli,
}));
vi.mock('../../packages/mcp/src/surface-authority.js', () => ({ captureMcpSurfaceAuthority: fixture.captureMcp }));

import { createCliEngineServices, decorateCliFirstPartyServices } from '../../packages/cli/src/first-party-services.js';
import { createMcpEngineServices, decorateMcpFirstPartyServices } from '../../packages/mcp/src/first-party-services.js';

const result = { exitCode: 0, stdout: 'fixture answer', stderr: '', durationMs: 4, timedOut: false };
beforeEach(() => {
  tracker.reset();
  fixture.engine.id = 'fixture-engine';
  vi.clearAllMocks(); fixture.dispatch.mockResolvedValue(result);
  fixture.realHost = false;
  fixture.captureCli.mockReturnValue(fixture.assertCurrent);
  fixture.captureMcp.mockReturnValue(fixture.assertCurrent);
  fixture.assertCurrent.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe.each([decorateCliFirstPartyServices, decorateMcpFirstPartyServices])('Ratings protection host', decorate => {
  it('protects all registered engines plus configured historical IDs, without dispatch', async () => {
    fixture.loadConfig.mockReturnValueOnce({ ratingsPurgeKeepEngines: ['renamed-engine', 'fixture-engine'] });
    const services = decorate({ id: 'agon.ratings' } as never, {} as never);
    const context = { invocationId: 'ratings', cwd: '/fixture/project', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
    expect(await services.ratings?.protectedEngineIds(context)).toEqual(['fixture-engine', 'disabled-engine', 'filtered-engine', 'renamed-engine']);
    expect(fixture.loadConfig).toHaveBeenCalledWith(context.cwd);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
  it('does not add ratings maintenance to an unrelated mod', () => {
    expect(decorate({ id: 'custom.example' } as never, {} as never)).not.toHaveProperty('ratings');
  });
  it.each(['not-an-array', 42])('preserves the legacy non-array config guard (%j)', async invalid => {
    fixture.loadConfig.mockReturnValueOnce({ ratingsPurgeKeepEngines: invalid });
    const services = decorate({ id: 'agon.ratings' } as never, {} as never);
    const context = { invocationId: 'ratings', cwd: '/fixture/project', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
    expect(await services.ratings?.protectedEngineIds(context)).toEqual(['fixture-engine', 'disabled-engine', 'filtered-engine']);
  });
});

describe.each([decorateCliFirstPartyServices, decorateMcpFirstPartyServices])('Forge host wiring', decorate => {
  it.each(['agon.forge', 'agon.team-forge', 'agon.pipeline-orchestration', 'agon.goal'])('provides host effects to the bundled %s consumer', id => {
    const services = decorate({ id } as never, {} as never);
    expect(services).toHaveProperty('forge', fixture.forge);
    expect(fixture.forge.open).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
  it('does not expose Forge or patch application to unrelated mods', () => {
    const services = decorate({ id: 'custom.example' } as never, {} as never);
    expect(services).not.toHaveProperty('forge');
    expect(services).not.toHaveProperty('patchApplication');
  });
});

describe.each([decorateCliFirstPartyServices, decorateMcpFirstPartyServices])('Brainstorm host wiring', decorate => {
  it.each(['agon.brainstorm', 'agon.pipeline-orchestration'])('opens %s with the physical registry and Ratings lookup', id => {
    const load = vi.spyOn(CatalogEngineRegistry.prototype, 'load').mockImplementation(() => {});
    decorate({ id } as never, {} as never);
    expect(load).not.toHaveBeenCalled();
    const registry = fixture.brainstormFactory.mock.calls[0]![0].openRegistry('/fixture/project') as CatalogEngineRegistry;
    expect(registry).toBeInstanceOf(CatalogEngineRegistry);
    expect(load).toHaveBeenCalledExactlyOnceWith('/fixture/engines');
    expect(registry.getFallbackChain('source', 'code', ['candidate'])).toEqual(['candidate']);
    expect(fixture.rating).toHaveBeenCalledExactlyOnceWith('candidate', 'code');
  });
  it.each(['agon.brainstorm', 'agon.pipeline-orchestration'])('executes %s through the real host with scoped effects', async id => {
    fixture.realHost = true;
    const load = vi.spyOn(CatalogEngineRegistry.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(CatalogEngineRegistry.prototype, 'get').mockReturnValue({
      ...fixture.engine, api: { baseUrl: 'https://example.invalid', model: 'fixture', apiKeyEnv: 'UNUSED' },
    } as never);
    vi.stubEnv('AGON_FORCE_HEALTH_PROBE', '1');
    vi.stubEnv('AGON_DISABLE_FORGE_HEALTH_CHECK', '');
    const decorated = decorate({ id } as never, {} as never) as BrainstormModServices;
    expect(load).not.toHaveBeenCalled();
    expect(fixture.adapterOpened).not.toHaveBeenCalled();
    const controller = new AbortController();
    const context: InvocationContext = { invocationId: 'physical', cwd: '/fixture/invocation',
      platform: 'darwin-arm64', signal: controller.signal, config: {} };
    const aborted = new AbortController(); aborted.abort(new Error('already cancelled'));
    expect(() => decorated.brainstorm!.open({ ...context, signal: aborted.signal })).toThrow('already cancelled');
    expect(load).not.toHaveBeenCalled();
    const services = await decorated.brainstorm!.open(context);
    const options = { question: 'fixture', engines: ['fixture-engine'], timeout: 37, outputDir: '/fixture/output' };
    await services.preflight(options);
    expect(fixture.loadConfig).toHaveBeenCalledExactlyOnceWith(context.cwd);
    fixture.dispatch.mockClear();
    const seat = services.selectSeat(options, 'fixture-engine');
    await seat('seat', 'system');
    await services.selectWinner(options, 'fixture-engine')('winner');
    expect(fixture.dispatch).toHaveBeenCalledTimes(2);
    for (const [request] of fixture.dispatch.mock.calls) expect(request).toMatchObject({ cwd: context.cwd, signal: context.signal });
    fixture.dispatch.mockClear();
    fixture.assertCurrent.mockImplementation(() => { throw new Error('stale host'); });
    await expect(seat('stale', 'system')).resolves.toMatchObject({ ok: false, failure: 'error', detail: 'stale host' });
    expect(fixture.dispatch).not.toHaveBeenCalled();
    fixture.assertCurrent.mockReset();
    controller.abort(new Error('cancelled invocation'));
    await expect(seat('cancelled', 'system')).resolves.toMatchObject({ ok: false, attempts: 0, detail: 'aborted before dispatch' });
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
  it.each(['agon.brainstorm', 'agon.pipeline-orchestration'])('binds %s effects to their physical owners', id => {
    decorate({ id } as never, {} as never);
    expect(fixture.brainstormFactory).toHaveBeenCalledOnce();
    expect(fixture.brainstormFactory.mock.calls[0]).toHaveLength(1);
    expect(fixture.brainstormFactory.mock.calls[0]![0]).toMatchObject({
      loadConfig: fixture.loadConfig,
      classifyTask,
      readRatings: glicko.getRatings,
      seedRegistry: glicko.seedNewEnginesFromRegistry,
      updateRanked: glicko.updateGlickoRanked,
      buildPrompt: buildKernDraftPrompt,
      parseDraft: parseKernDraft,
    });
    expect(fixture.loadConfig).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
  it.each(['agon.brainstorm', 'agon.pipeline-orchestration'])('pins deferred %s effects to current surface authority', id => {
    decorate({ id } as never, {} as never);
    expect(fixture.captureCli).not.toHaveBeenCalled();
    expect(fixture.captureMcp).not.toHaveBeenCalled();
    const capture = fixture.brainstormFactory.mock.calls[0]![0].captureAuthority as () => () => void;
    expect(capture).toBeTypeOf('function');
    const check = capture();
    check();
    expect(fixture.assertCurrent).toHaveBeenCalledOnce();
    if (decorate === decorateCliFirstPartyServices) {
      expect(fixture.captureCli).toHaveBeenCalledOnce();
      expect(fixture.assertCli).toHaveBeenCalledExactlyOnceWith('cli', 'brainstorm');
    } else expect(fixture.captureMcp).toHaveBeenCalledExactlyOnceWith('Brainstorm');
    const reason = new Error('host replaced');
    fixture.assertCurrent.mockImplementationOnce(() => { throw reason; });
    expect(check).toThrow(reason);
  });
  it.each(['agon.brainstorm', 'agon.pipeline-orchestration'])('provides host effects to the bundled %s consumer', id => {
    const services = decorate({ id } as never, {} as never);
    const expected = decorate === decorateCliFirstPartyServices && id === 'agon.brainstorm'
      ? { ...fixture.brainstorm, writeCliOutput: expect.any(Function) }
      : fixture.brainstorm;
    expect(services).toHaveProperty('brainstorm', expected);
    expect(fixture.brainstorm.open).not.toHaveBeenCalled();
  });
  it('does not expose the capability to unrelated mods', () => {
    expect(decorate({ id: 'custom.example' } as never, {} as never)).not.toHaveProperty('brainstorm');
  });
});

describe.each([
  ['CLI', createCliEngineServices],
  ['MCP', createMcpEngineServices],
] as const)('%s engine dispatch contract', (_surface, createServices) => {
  it.each(['sdk', 'cli-reported', 'estimated'] as const)('preserves %s usage, including cache tokens, on failed dispatch', async source => {
    const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedInputTokens: 80, source };
    fixture.dispatch.mockResolvedValueOnce({ ...result, exitCode: 1, usage });
    const output = await createServices().dispatch('fixture-engine', 'fixture task', {
      invocationId: 'usage', cwd: '/fixture/project', platform: 'darwin-arm64',
      signal: new AbortController().signal, config: {},
    });
    expect(output).toMatchObject({ exitCode: 1, usage });
    // Review and Goal consume this cost, including failed billed calls.
    expect(output).toHaveProperty('costUsd', expect.any(Number));
    expect((output as { costUsd: number }).costUsd).toBeGreaterThan(0);
    expect(output).toHaveProperty('costSource', source);
    expect(tracker.recent()).toHaveLength(1);
  });

  it('does not turn missing usage into a measured zero', async () => {
    const output = await createServices().dispatch('fixture-engine', 'fixture task', {
      invocationId: 'usage', cwd: '/fixture/project', platform: 'darwin-arm64',
      signal: new AbortController().signal, config: {},
    });
    expect(output).not.toHaveProperty('usage');
    expect(output).not.toHaveProperty('costUsd');
    expect(tracker.recent()).toHaveLength(0);
  });

  it('rejects malformed returned usage without contaminating shared accounting', async () => {
    fixture.dispatch.mockResolvedValueOnce({ ...result,
      usage: { promptTokens: Number.NaN, completionTokens: 20, totalTokens: 120, source: 'sdk' } });
    await expect(createServices().dispatch('fixture-engine', 'fixture task', context))
      .rejects.toThrow('Invalid reported token usage');
    expect(tracker.getStats().dispatches).toBe(0);
    expect(tracker.getStats().totalCostUsd).toBe(0);
  });

  it('uses existing cache-aware pricing without charging cached input as uncached', async () => {
    const invoke = async (cachedInputTokens: number) => {
      fixture.dispatch.mockResolvedValueOnce({ ...result,
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedInputTokens, source: 'sdk' } });
      return createServices().dispatch('fixture-engine', 'fixture task', context) as Promise<{ costUsd: number }>;
    };
    const uncached = await invoke(0);
    const cached = await invoke(80);
    expect(uncached.costUsd).toBeGreaterThan(cached.costUsd);
    expect(cached.costUsd).toBeGreaterThan(0);
    expect(uncached.costUsd).toBeCloseTo(0.00024, 10);
    expect(cached.costUsd).toBeCloseTo(0.000096, 10);
    expect(tracker.recent()).toHaveLength(2);
  });

  it('preserves reported token counts but keeps flat-rate marginal cost at zero', async () => {
    fixture.engine.id = 'fixture-coding-plan-model';
    const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120, source: 'sdk' };
    fixture.dispatch.mockResolvedValueOnce({ ...result, usage });
    const output = await createServices().dispatch('fixture-engine', 'fixture task', context);
    expect(output).toMatchObject({ usage, costUsd: 0, costSource: 'sdk' });
  });

  const context: InvocationContext = {
    invocationId: 'fixture-invocation', cwd: '/fixture/project',
    platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
  };

  it.each([true, false, undefined])('preserves textOnly=%s without changing the rest of dispatch', async textOnly => {
    const options: EngineDispatchOptions = { textOnly, timeoutSeconds: 37, systemPrompt: 'fixture system', mode: 'review' };
    const actual = await createServices().dispatch('fixture-engine', 'fixture prompt', context, options);
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      engine: fixture.engine, prompt: 'fixture prompt', cwd: context.cwd,
      outputDir: '/fixture/output', timeout: 37, systemPrompt: 'fixture system',
      mode: 'review', signal: context.signal, textOnly,
    });
    expect(fixture.loadConfig).toHaveBeenCalledWith(context.cwd);
    expect(actual).toEqual({ ...result, engineId: 'fixture-engine', outputDir: '/fixture/output' });
  });

  it('preserves default selection, execution mode and timeout', async () => {
    await createServices().dispatch('', 'fixture prompt', context);
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      engine: fixture.engine, prompt: 'fixture prompt', cwd: context.cwd,
      outputDir: '/fixture/output', timeout: 120, systemPrompt: undefined,
      mode: 'exec', signal: context.signal, textOnly: undefined,
    });
  });

  it('preserves failures instead of manufacturing a successful answer', async () => {
    const error = new Error('fixture adapter failure');
    fixture.dispatch.mockRejectedValueOnce(error);
    const options: EngineDispatchOptions = { mode: 'agent' };
    await expect(createServices().dispatch('fixture-engine', 'fixture prompt', context, options)).rejects.toBe(error);
  });
});
