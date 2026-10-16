import { expect, it, vi } from 'vitest';
import type { InvocationContext } from '@kernlang/agon-mod-api';
import type { DispatchOptions, EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import * as panel from '@kernlang/agon-support-panel';
import { createBrainstormHostServices, createBrainstormEngineServices } from '../../packages/mod-brainstorm/src/host.js';
import type { BrainstormHostEffects } from '../../packages/mod-brainstorm/src/host.js';
import { createBrainstormHostServices as createCoreHost } from '../../packages/core/src/blocks/brainstorm-host.js';

function fixture() {
  const engine: EngineDefinition = { schemaVersion: 3, id: 'fixture', displayName: 'fixture',
    isLocal: true, tier: 'user', timeout: 1 };
  const registry = { get: vi.fn(() => engine), findBinary: () => null };
  const dispatch = vi.fn(async (_options: DispatchOptions) => ({
    stdout: 'fixture result', stderr: '', exitCode: 0, durationMs: 0, timedOut: false,
  }));
  const adapter: EngineAdapter = { dispatch, isAvailable: async () => true, getVersion: async () => null };
  const effects = {
    openRegistry: vi.fn((_cwd: string) => registry), createAdapter: vi.fn((_registry: typeof registry) => adapter),
    readRatings: vi.fn(() => ({ global: {}, byMode: { brainstorm: {} } })),
    buildPrompt: vi.fn(() => 'prompt'), parseDraft: vi.fn(() => null),
    seedRegistry: vi.fn(), loadConfig: vi.fn(() => ({})),
    classifyTask: vi.fn(() => 'other' as const), updateRanked: vi.fn(),
  } satisfies BrainstormHostEffects<typeof registry>;
  const controller = new AbortController();
  const context: InvocationContext = { invocationId: 'fixture', cwd: '/invocation',
    platform: 'darwin-arm64', signal: controller.signal, config: {} };
  const options = { question: 'fixture', engines: ['fixture'], timeout: 80,
    outputDir: '/output', signal: new AbortController().signal };
  return { engine, registry, dispatch, adapter, effects, context, options, controller };
}

it('rejects a cancelled Brainstorm host before opening effects', () => {
  const f = fixture();
  const reason = new Error('cancelled before open');
  f.controller.abort(reason);
  expect(() => createBrainstormHostServices(f.effects).open(f.context)).toThrow(reason);
  expect(f.effects.openRegistry).not.toHaveBeenCalled();
  expect(f.effects.createAdapter).not.toHaveBeenCalled();
});

it.each(['cancelled', 'stale'])('rejects deferred Brainstorm transport when %s', async fault => {
  const f = fixture();
  let stale = false;
  const reason = new Error(fault);
  const host = createBrainstormHostServices({ ...f.effects,
    captureAuthority: () => () => { if (stale) throw reason; },
  });
  const opened = await host.open(f.context);
  const winner = opened.selectWinner(f.options, 'fixture');
  if (fault === 'cancelled') f.controller.abort(reason);
  else stale = true;
  await expect(winner('must not dispatch')).rejects.toBe(reason);
  expect(f.dispatch).not.toHaveBeenCalled();
});

it.each([undefined, null])('rejects an invalid Brainstorm authority result %s before effects', result => {
  const f = fixture();
  const host = createBrainstormHostServices({ ...f.effects,
    captureAuthority: () => result,
  } as unknown as BrainstormHostEffects<typeof f.registry>);
  expect(() => host.open(f.context)).toThrow(TypeError);
  expect(f.effects.openRegistry).not.toHaveBeenCalled();
  expect(f.effects.createAdapter).not.toHaveBeenCalled();
});

it('preserves Core two-argument callers and forwards authority to the physical host', async () => {
  const f = fixture();
  const legacy = await createCoreHost(() => f.registry as never, () => f.adapter).open(f.context);
  await legacy.selectWinner(f.options, 'fixture')('legacy call');
  expect(f.dispatch).toHaveBeenCalledOnce();
  const reason = new Error('Core authority changed');
  let stale = false;
  const guarded = await createCoreHost(() => f.registry as never, () => f.adapter,
    () => () => { if (stale) throw reason; }).open(f.context);
  stale = true;
  await expect(guarded.selectWinner(f.options, 'fixture')('blocked')).rejects.toBe(reason);
  expect(f.dispatch).toHaveBeenCalledOnce();
});

it('rejects valid but stale authority before opening a Brainstorm registry', () => {
  const f = fixture();
  const reason = new Error('generation changed');
  const host = createBrainstormHostServices({ ...f.effects, captureAuthority: () => () => { throw reason; } });
  expect(() => host.open(f.context)).toThrow(reason);
  expect(f.effects.openRegistry).not.toHaveBeenCalled();
  expect(f.effects.createAdapter).not.toHaveBeenCalled();
});

it('keeps separate Brainstorm authority captures across invocations', async () => {
  const f = fixture();
  let generation = 1;
  const host = createBrainstormHostServices({ ...f.effects, captureAuthority: () => {
    const selected = generation;
    return () => { if (selected !== generation) throw new Error('old generation'); };
  } });
  const old = await host.open(f.context);
  generation = 2;
  const current = await host.open(f.context);
  await expect(old.selectWinner(f.options, 'fixture')('old')).rejects.toThrow('old generation');
  await current.selectWinner(f.options, 'fixture')('current');
  expect(f.dispatch).toHaveBeenCalledOnce();
  expect(f.dispatch.mock.calls[0]![0].prompt).toBe('current');
});

it('checks authority again before a panel retry reaches the provider', async () => {
  const f = fixture();
  let stale = false;
  f.dispatch.mockImplementationOnce(async () => {
    stale = true;
    return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, timedOut: false };
  });
  const host = createBrainstormHostServices({ ...f.effects,
    captureAuthority: () => () => { if (stale) throw new Error('retry authority lost'); },
  });
  const opened = await host.open(f.context);
  const result = await opened.selectSeat(f.options, 'fixture')('prompt');
  expect(result).toMatchObject({ ok: false, failure: 'error' });
  expect(result.detail).toContain('retry authority lost');
  expect(f.dispatch).toHaveBeenCalledOnce();
});

it('prevents a stale real preflight probe from reaching the provider', async () => {
  const f = fixture();
  let stale = false;
  const host = createBrainstormHostServices({ ...f.effects,
    captureAuthority: () => () => { if (stale) throw new Error('probe authority lost'); },
  });
  const opened = await host.open(f.context);
  stale = true;
  vi.stubEnv('AGON_FORCE_HEALTH_PROBE', '1');
  vi.stubEnv('AGON_DISABLE_FORGE_HEALTH_CHECK', '');
  try {
    expect(await opened.preflight(f.options)).toEqual({ healthy: [], skipped: [{
      engineId: 'fixture', status: 'health-check-failed', reason: 'dispatch-threw: probe authority lost',
    }] });
    expect(f.dispatch).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});

it('opens effects lazily and keeps concurrent invocation contexts separate', async () => {
  const f = fixture();
  const other = fixture();
  other.engine.id = 'other';
  f.effects.openRegistry.mockImplementation(cwd => cwd === '/second' ? other.registry : f.registry);
  f.effects.createAdapter.mockImplementation(registry => registry === other.registry ? other.adapter : f.adapter);
  const host = createBrainstormHostServices(f.effects);
  expect(f.effects.openRegistry).not.toHaveBeenCalled();
  expect(f.effects.createAdapter).not.toHaveBeenCalled();
  const first = await host.open(f.context);
  const secondContext = { ...f.context, cwd: '/second', signal: new AbortController().signal };
  const second = await host.open(secondContext);
  expect(f.effects.openRegistry.mock.calls).toEqual([['/invocation'], ['/second']]);
  expect(f.effects.createAdapter).toHaveBeenCalledWith(f.registry);
  expect(f.dispatch).not.toHaveBeenCalled();
  await second.selectWinner(f.options, 'fixture')('second prompt');
  await first.selectSeat(f.options, 'fixture')('first prompt', 'seat system');
  first.seed(f.options);
  second.seed(f.options);
  expect(f.effects.seedRegistry.mock.calls).toEqual([[f.registry], [other.registry]]);
  expect(other.dispatch.mock.calls.map(([call]) => [call.cwd, call.signal, call.prompt])).toEqual([
    ['/second', secondContext.signal, 'second prompt'],
  ]);
  expect(f.dispatch.mock.calls.map(([call]) => [call.cwd, call.signal, call.prompt])).toEqual([
    ['/invocation', f.context.signal, 'first prompt'],
  ]);
  for (const [call] of f.dispatch.mock.calls) {
    expect(call).toMatchObject({ engine: f.engine, textOnly: true, mode: 'exec', timeout: 80, outputDir: '/output' });
  }
  expect(other.dispatch.mock.calls[0][0]).toMatchObject({ engine: other.engine, textOnly: true,
    mode: 'exec', timeout: 80, outputDir: '/output' });
  expect(other.dispatch.mock.calls[0][0].systemPrompt).toBe('You are expanding on a winning brainstorm approach. Respond directly with your detailed analysis as plain text. Do NOT use tools, read files, or run commands.');
  expect(f.dispatch.mock.calls[0][0].systemPrompt).toBe('seat system');
});

it('preserves retry and cancellation through the real panel dispatcher', async () => {
  const f = fixture();
  const services = await createBrainstormHostServices(f.effects).open(f.context);
  const seat = services.selectSeat(f.options, 'fixture');
  f.registry.get.mockImplementation(() => { throw new Error('lookup repeated'); });
  f.dispatch.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 0, timedOut: false });
  expect(await seat('prompt', 'system')).toMatchObject({ ok: true, attempts: 2 });
  expect(f.registry.get).toHaveBeenCalledTimes(1);
  expect(f.dispatch.mock.calls.every(([call]) => call.engine === f.engine)).toBe(true);
  expect(f.dispatch.mock.calls.map(([call]) => call.timeout)).toEqual([80, 40]);
  f.controller.abort();
  expect(await seat('prompt', 'system')).toMatchObject({ ok: false, attempts: 0 });
  expect(f.dispatch).toHaveBeenCalledTimes(2);
});

it('propagates opening failures without opening later effects', () => {
  const f = fixture();
  const failure = new Error('fixture opening failure');
  f.effects.openRegistry.mockImplementationOnce(() => { throw failure; });
  const host = createBrainstormHostServices(f.effects);
  expect(() => host.open(f.context)).toThrow(failure);
  expect(f.effects.createAdapter).not.toHaveBeenCalled();
  f.effects.createAdapter.mockImplementationOnce(() => { throw failure; });
  expect(() => host.open(f.context)).toThrow(failure);
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(f.effects.seedRegistry).not.toHaveBeenCalled();
});

it('maps scores before classifying and preserves rating exceptions', async () => {
  const f = fixture();
  const trace: string[] = [];
  const services = await createBrainstormHostServices(f.effects).open(f.context);
  const bid = { engineId: 'fixture', confidence: 80, reasoning: '', approach: '',
    get score() { trace.push('score'); return 2; } };
  f.effects.classifyTask.mockImplementation(() => { trace.push('classify'); return 'other'; });
  f.effects.updateRanked.mockImplementation(() => { trace.push('update'); });
  services.updateRatings([bid], 'question');
  expect(trace).toEqual(['score', 'classify', 'update']);
  const failure = new Error('fixture rating failure');
  f.effects.classifyTask.mockImplementation(() => { throw failure; });
  expect(() => services.updateRatings([bid], 'question')).toThrow(failure);
  expect(f.effects.updateRanked).toHaveBeenCalledTimes(1);
  f.effects.classifyTask.mockReturnValue('other');
  f.effects.updateRanked.mockImplementation(() => { throw failure; });
  expect(() => services.updateRatings([bid], 'question')).toThrow(failure);
});

it('maps scores, classifies once and passes registry identity to seeding', async () => {
  const f = fixture();
  const services = await createBrainstormHostServices(f.effects).open(f.context);
  services.seed(f.options);
  expect(f.effects.seedRegistry).toHaveBeenCalledWith(f.registry);
  services.updateRatings([
    { engineId: 'a', confidence: 99, reasoning: '', approach: '' },
    { engineId: 'b', confidence: 1, reasoning: '', approach: '', score: -2 },
  ], 'question');
  expect(f.effects.classifyTask.mock.calls).toEqual([['question']]);
  expect(f.effects.updateRanked.mock.calls).toEqual([[[{ engineId: 'a', score: 0 }, { engineId: 'b', score: -2 }], 'other', 'brainstorm']]);
  expect(services.readRatings).toBe(f.effects.readRatings);
  expect(services.buildPrompt).toBe(f.effects.buildPrompt);
  expect(services.parseDraft).toBe(f.effects.parseDraft);
});

it('propagates registry lookup failure before returning a dispatcher', async () => {
  const f = fixture();
  const services = await createBrainstormHostServices(f.effects).open(f.context);
  f.registry.get.mockImplementation(() => { throw new Error('unknown engine'); });
  expect(() => services.selectSeat(f.options, 'missing')).toThrow('unknown engine');
  expect(() => services.selectWinner(f.options, 'missing')).toThrow('unknown engine');
  expect(f.dispatch).not.toHaveBeenCalled();
});

it('binds preflight config and cancellation to the invocation, not process cwd', async () => {
  const f = fixture();
  const other = fixture();
  const otherContext = { ...f.context, cwd: '/second', signal: other.context.signal };
  f.effects.openRegistry.mockImplementation(cwd => cwd === '/second' ? other.registry : f.registry);
  f.effects.createAdapter.mockImplementation(registry => registry === other.registry ? other.adapter : f.adapter);
  const observed: unknown[] = [];
  const preflight = vi.spyOn(panel, 'preflightHealthFilter').mockImplementation(async options => {
    observed.push([options.registry, options.adapter, options.signal]);
    options.runtime?.loadConfig('/unrelated-process-cwd');
    return { healthy: options.engineIds, skipped: [] };
  });
  try {
    const host = createBrainstormHostServices(f.effects);
    const services = await host.open(f.context);
    const second = await host.open(otherContext);
    await second.preflight(f.options);
    expect(await services.preflight(f.options)).toEqual({ healthy: ['fixture'], skipped: [] });
    expect(preflight).toHaveBeenCalledTimes(2);
    const secondAdapter = preflight.mock.calls[0]![0].adapter;
    const firstAdapter = preflight.mock.calls[1]![0].adapter;
    expect(observed).toEqual([[other.registry, secondAdapter, otherContext.signal], [f.registry, firstAdapter, f.context.signal]]);
    expect(secondAdapter).not.toBe(other.adapter);
    expect(firstAdapter).not.toBe(f.adapter);
    expect(await firstAdapter.isAvailable(f.engine)).toBe(true);
    other.controller.abort(new Error('preflight cancelled'));
    await expect(secondAdapter.isAvailable(other.engine)).rejects.toThrow('preflight cancelled');
    expect(f.effects.loadConfig.mock.calls).toEqual([['/second'], ['/invocation']]);
    expect(f.dispatch).not.toHaveBeenCalled();
  } finally {
    preflight.mockRestore();
  }
});

it('exports a working host factory from the independently built package', async () => {
  const built = await import('../../packages/mod-brainstorm/dist/index.js');
  const f = fixture();
  const services = await built.createBrainstormHostServices(f.effects).open(f.context);
  const result = await services.selectWinner(f.options, 'fixture')('built package prompt');
  expect(result.stdout).toBe('fixture result');
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/invocation',
    signal: f.context.signal, prompt: 'built package prompt', engine: f.engine }));
});

it('keeps engine-option dispatch late-bound while capturing the selected engine', async () => {
  const f = fixture();
  const services = createBrainstormEngineServices(f.effects);
  const options = { ...f.options, registry: f.registry, adapter: f.adapter };
  expect(f.effects.openRegistry).not.toHaveBeenCalled();
  expect(f.effects.createAdapter).not.toHaveBeenCalled();
  const seat = services.selectSeat(options, 'fixture');
  const winner = services.selectWinner(options, 'fixture');
  f.registry.get.mockImplementation(() => { throw new Error('lookup repeated'); });
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/dispatch-time');
  try {
    f.dispatch.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 0, timedOut: false });
    expect(await seat('seat prompt', 'seat system')).toMatchObject({ ok: true, attempts: 2 });
    await winner('winner prompt');
    expect(f.registry.get).toHaveBeenCalledTimes(2);
    expect(f.dispatch.mock.calls.map(([call]) => call.timeout)).toEqual([80, 40, 80]);
    for (const [call] of f.dispatch.mock.calls) {
      expect(call).toMatchObject({ engine: f.engine, cwd: '/dispatch-time', signal: options.signal,
        textOnly: true, mode: 'exec', outputDir: '/output' });
    }
    const aborted = new AbortController();
    aborted.abort();
    options.signal = aborted.signal;
    expect(await seat('cancelled', 'system')).toMatchObject({ ok: false, attempts: 0 });
    expect(f.dispatch).toHaveBeenCalledTimes(3);
  } finally {
    cwd.mockRestore();
  }
});

it('uses engine-option preflight and the panel-requested config cwd', async () => {
  const f = fixture();
  const services = createBrainstormEngineServices(f.effects);
  const options = { ...f.options, registry: f.registry, adapter: f.adapter };
  const preflight = vi.spyOn(panel, 'preflightHealthFilter').mockImplementation(async value => {
    expect(value).toMatchObject({ engineIds: options.engines, registry: f.registry,
      adapter: f.adapter, signal: options.signal });
    value.runtime?.loadConfig('/panel-cwd');
    return { healthy: value.engineIds, skipped: [] };
  });
  try {
    services.seed(options);
    expect(f.effects.seedRegistry).toHaveBeenCalledExactlyOnceWith(f.registry);
    expect(await services.preflight(options)).toEqual({ healthy: ['fixture'], skipped: [] });
    expect(f.effects.loadConfig).toHaveBeenCalledExactlyOnceWith('/panel-cwd');
  } finally {
    preflight.mockRestore();
  }
});

it('preserves classification-before-score order for the engine-options API', () => {
  const f = fixture();
  const trace: string[] = [];
  const services = createBrainstormEngineServices(f.effects);
  const bid = { engineId: 'fixture', confidence: 80, reasoning: '', approach: '',
    get score() { trace.push('score'); return 2; } };
  f.effects.classifyTask.mockImplementation(() => { trace.push('classify'); return 'other'; });
  f.effects.updateRanked.mockImplementation(() => { trace.push('update'); });
  services.updateRatings([bid], 'question');
  expect(trace).toEqual(['classify', 'score', 'update']);
  expect(f.effects.updateRanked).toHaveBeenCalledWith([{ engineId: 'fixture', score: 2 }], 'other', 'brainstorm');
  trace.length = 0;
  f.effects.classifyTask.mockImplementation(() => { throw new Error('classification failed'); });
  expect(() => services.updateRatings([bid], 'question')).toThrow('classification failed');
  expect(trace).toEqual([]);
  expect(f.effects.updateRanked).toHaveBeenCalledTimes(1);
});

it('exports engine-bound services from the independently built package', async () => {
  const built = await import('../../packages/mod-brainstorm/dist/index.js');
  const f = fixture();
  const services = built.createBrainstormEngineServices(f.effects);
  const options = { ...f.options, registry: f.registry, adapter: f.adapter };
  expect(await services.selectWinner(options, 'fixture')('built engine prompt')).toMatchObject({ stdout: 'fixture result' });
  expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ cwd: process.cwd(),
    signal: options.signal, prompt: 'built engine prompt', engine: f.engine }));
});
