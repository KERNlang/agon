import { expect, it, vi } from 'vitest';
import type { InvocationContext } from '@kernlang/agon-mod-api';
import type { DispatchOptions, EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import * as panel from '@kernlang/agon-support-panel';
import { createBrainstormHostServices } from '../../packages/mod-brainstorm/src/host.js';
import type { BrainstormHostEffects } from '../../packages/mod-brainstorm/src/host.js';

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
    expect(observed).toEqual([[other.registry, other.adapter, otherContext.signal], [f.registry, f.adapter, f.context.signal]]);
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
