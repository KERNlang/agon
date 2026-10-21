import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineRegistry, loadConfig, classifyTask, updateGlickoRanked, seedNewEnginesFromRegistry } from '@kernlang/agon-core';
import * as tribunalOwner from '@kernlang/agon-mod-tribunal';
import type { DispatchOptions, DispatchResult, EngineAdapter, EngineDefinition } from '../../packages/core/src/models/types.js';
import { runTribunal } from '@kernlang/agon-forge';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { ModRegistry } from '@kernlang/agon-kernel';

function makeEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: true,
    tier: 'user',
    binary: 'sh',
    timeout: 30,
    exec: { args: [] },
    review: { args: [] },
  } as EngineDefinition;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

it.each(['adversarial', 'synthesis'] as const)('Tribunal %s ratings preserve substantive credit and retry outcomes', async mode => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tribunal-rank-'));
  const registry = new EngineRegistry();
  for (const id of ['alpha', 'beta', 'failed']) registry.register(makeEngine(id));
  const attempts = new Map<string, number>();
  const updateRanked = vi.fn();
  const execute = tribunalOwner.createTribunalRuntime({
    seedRegistry: () => {}, updateRanked, classifyTask: () => 'code', loadConfig: () => ({ cesarEngine: 'alpha' }),
  });
  try {
    const result = await execute({ question: 'Q', engines: ['alpha', 'beta', 'failed'], rounds: 2, mode, protocol: 'parallel',
      registry, timeout: 1, outputDir,
      adapter: {
        dispatch: async options => {
          if (options.systemPrompt?.includes('synthesizing a debate')) {
            return { exitCode: 0, stdout: 'verdict', stderr: '', durationMs: 1, timedOut: false };
          }
          const round = Number(options.prompt.match(/## ROUND\n(\d+) of/)?.[1]);
          const key = `${options.engine.id}:${round}`;
          const attempt = (attempts.get(key) ?? 0) + 1;
          attempts.set(key, attempt);
          const failed = options.engine.id === 'failed' || (options.engine.id === 'beta' && attempt === 1);
          const stdout = options.engine.id === 'alpha' ? 'a'.repeat(round === 1 ? 10 : 3000) : 'b'.repeat(100);
          return { exitCode: failed ? 1 : 0, stdout: failed ? '' : stdout, stderr: failed ? 'temporary error' : '', durationMs: 1, timedOut: false };
        },
        isAvailable: async () => true, getVersion: async () => 'fixture',
      },
    });
    const ranking = [{ engineId: 'alpha', score: 3000 }, { engineId: 'beta', score: 2100 }, { engineId: 'failed', score: 0 }];
    expect(updateRanked.mock.calls).toEqual(mode === 'adversarial'
      ? [[ranking, 'code', 'tribunal'], [ranking, 'code', 'critique']] : [[ranking, 'code', 'tribunal']]);
    expect(result.panelHealth).toMatchObject({ requested: 6, responded: 4, degraded: true });
    expect(result.panelHealth?.notes).toEqual(expect.arrayContaining([
      'beta r1 error → retried OK', 'beta r2 error → retried OK',
      'failed r1 error → retry error, dropped', 'failed r2 error → retry error, dropped',
    ]));
    for (const round of [1, 2]) {
      expect(attempts.get(`alpha:${round}`)).toBe(1);
      expect(attempts.get(`beta:${round}`)).toBe(2);
      expect(attempts.get(`failed:${round}`)).toBe(2);
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

it.each(['before', 'seat', 'summary', 'failed-attempt', 'failed-retry'] as const)('Tribunal cancellation at %s prevents later work and success effects', async phase => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tribunal-cancel-'));
  const registry = new EngineRegistry();
  for (const id of ['alpha', 'beta']) registry.register(makeEngine(id));
  const controller = new AbortController();
  const reason = new Error('operator cancelled');
  const seedRegistry = vi.fn();
  const updateRanked = vi.fn();
  const onEvent = vi.fn();
  const dispatch = vi.fn(async (options: DispatchOptions): Promise<DispatchResult> => {
    const summary = options.systemPrompt?.includes('synthesizing a debate');
    if ((phase === 'seat' && !summary) || (phase === 'summary' && summary)) controller.abort(reason);
    if (phase === 'failed-attempt' || phase === 'failed-retry') {
      if (phase === 'failed-attempt' || dispatch.mock.calls.length === 2) controller.abort(reason);
      return { exitCode: 1, stdout: '', stderr: 'failed response', durationMs: 1, timedOut: false };
    }
    // Ignore the signal to prove that the workflow rejects late provider success.
    return { exitCode: 0, stdout: 'usable provider response', stderr: '', durationMs: 1, timedOut: false };
  });
  const execute = tribunalOwner.createTribunalRuntime({
    seedRegistry, updateRanked, classifyTask: () => 'other', loadConfig: () => ({ cesarEngine: 'alpha' }),
  });
  if (phase === 'before') controller.abort(reason);
  try {
    await expect(execute({ question: 'Q', engines: ['alpha', 'beta'], rounds: 2, protocol: 'chained', registry,
      adapter: { dispatch, isAvailable: async () => true, getVersion: async () => 'fixture' },
      timeout: 1, outputDir, signal: controller.signal, onEvent })).rejects.toBe(reason);
    expect(dispatch).toHaveBeenCalledTimes(phase === 'before' ? 0 : phase === 'summary' ? 5 : phase === 'failed-retry' ? 2 : 1);
    expect(seedRegistry).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
    expect(updateRanked).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.some(([event]) => event.type === 'forge:done')).toBe(false);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

it.each(['classify', 'first-rating', 'done'] as const)('Tribunal completion boundary handles cancellation from %s', async phase => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tribunal-completion-'));
  const registry = new EngineRegistry();
  for (const id of ['alpha', 'beta']) registry.register(makeEngine(id));
  const controller = new AbortController();
  const reason = new Error('cancelled in callback');
  const effects: string[] = [];
  const execute = tribunalOwner.createTribunalRuntime({
    seedRegistry: () => {}, loadConfig: () => ({ cesarEngine: 'alpha' }),
    classifyTask: () => {
      effects.push('classify');
      if (phase === 'classify') controller.abort(reason);
      return 'other';
    },
    updateRanked: (_ranked, _taskClass, mode) => {
      expect(controller.signal.aborted).toBe(false);
      effects.push(mode);
      if (phase === 'first-rating') controller.abort(reason);
    },
  });
  try {
    const invocation = execute({ question: 'Q', engines: ['alpha', 'beta'], rounds: 1, registry,
      adapter: {
        dispatch: async () => ({ exitCode: 0, stdout: 'substantive provider argument', stderr: '', durationMs: 1, timedOut: false }),
        isAvailable: async () => true, getVersion: async () => 'fixture',
      }, timeout: 1, outputDir, signal: controller.signal,
      onEvent: event => {
        if (event.type === 'forge:done') {
          effects.push('done');
          if (phase === 'done') controller.abort(reason);
        }
      },
    });
    if (phase === 'done') {
      // Completion is already published. A late cancellation cannot undo it.
      await expect(invocation).resolves.toMatchObject({ summary: 'substantive provider argument' });
      expect(effects).toEqual(['classify', 'tribunal', 'critique', 'done']);
    } else {
      await expect(invocation).rejects.toBe(reason);
      expect(effects).toEqual(phase === 'classify' ? ['classify'] : ['classify', 'tribunal']);
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

it('waits for started parallel seats after cancellation without starting summary', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tribunal-parallel-cancel-'));
  const registry = new EngineRegistry();
  for (const id of ['alpha', 'beta']) registry.register(makeEngine(id));
  const controller = new AbortController();
  const reason = new Error('operator cancelled parallel run');
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const started = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const updateRanked = vi.fn();
  const onEvent = vi.fn();
  const dispatch = vi.fn(async (options: DispatchOptions): Promise<DispatchResult> => {
    const index = options.engine.id === 'alpha' ? 0 : 1;
    started[index].resolve();
    await gates[index].promise;
    return { exitCode: 0, stdout: 'late response', stderr: '', durationMs: 1, timedOut: false };
  });
  const execute = tribunalOwner.createTribunalRuntime({
    seedRegistry: () => {}, updateRanked, classifyTask: () => 'other', loadConfig: () => ({ cesarEngine: 'alpha' }),
  });
  let settled = false;
  const outcome = execute({ question: 'Q', engines: ['alpha', 'beta'], rounds: 2, protocol: 'parallel', registry,
    adapter: { dispatch, isAvailable: async () => true, getVersion: async () => 'fixture' },
    timeout: 1, outputDir, signal: controller.signal, onEvent }).then(
      value => { settled = true; return { value, error: undefined }; },
      error => { settled = true; return { value: undefined, error }; },
    );
  try {
    await Promise.all(started.map(gate => gate.promise));
    controller.abort(reason);
    gates[0].resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    gates[1].resolve();
    expect((await outcome).error).toBe(reason);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(updateRanked).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.some(([event]) => event.type === 'forge:done')).toBe(false);
  } finally {
    for (const gate of gates) gate.resolve();
    await outcome;
    rmSync(outputDir, { recursive: true, force: true });
  }
});

it('drains a started parallel seat before propagating another seat callback failure', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tribunal-parallel-failure-'));
  const registry = new EngineRegistry();
  for (const id of ['alpha', 'beta']) registry.register(makeEngine(id));
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const reason = new Error('critique observer failed');
  const updateRanked = vi.fn();
  const onEvent = vi.fn((event: tribunalOwner.TribunalEvent) => {
    if (event.type === 'synthesis:critique' && event.engineId === 'beta') throw reason;
  });
  const dispatch = vi.fn(async (): Promise<DispatchResult> => {
    started.resolve();
    await gate.promise;
    return { exitCode: 0, stdout: 'argument', stderr: '', durationMs: 1, timedOut: false };
  });
  const execute = tribunalOwner.createTribunalRuntime({
    seedRegistry: () => {}, updateRanked, classifyTask: () => 'other', loadConfig: () => ({ cesarEngine: 'alpha' }),
  });
  let settled = false;
  const outcome = execute({ question: 'Q', engines: ['alpha', 'beta'], rounds: 1, protocol: 'parallel', registry,
    adapter: { dispatch, isAvailable: async () => true, getVersion: async () => 'fixture' },
    timeout: 1, outputDir, onEvent }).then(
      value => { settled = true; return { value, error: undefined }; },
      error => { settled = true; return { value: undefined, error }; },
    );
  try {
    await started.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    gate.resolve();
    expect((await outcome).error).toBe(reason);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(updateRanked).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.some(([event]) => event.type === 'forge:done')).toBe(false);
  } finally {
    gate.resolve();
    await outcome;
    rmSync(outputDir, { recursive: true, force: true });
  }
});

it.each(['summary', 'retry', 'config'] as const)('Tribunal preserves revoked authority during %s without false success', async phase => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tribunal-revoked-'));
  const registry = new EngineRegistry();
  for (const id of ['alpha', 'beta']) registry.register(makeEngine(id));
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const reason = new Error('generation revoked');
  let current = true;
  const updateRanked = vi.fn();
  const onEvent = vi.fn();
  const dispatch = vi.fn(async (options: DispatchOptions): Promise<DispatchResult> => {
    if ((phase === 'summary' && options.systemPrompt?.includes('synthesizing a debate')) || phase === 'retry') {
      started.resolve();
      await gate.promise;
    }
    return { exitCode: phase === 'retry' ? 1 : 0, stdout: 'substantive argument from provider', stderr: '', durationMs: 1, timedOut: false };
  });
  const host = tribunalOwner.createTribunalHostServices({
    openRegistry: () => registry,
    createAdapter: () => ({ dispatch, isAvailable: async () => true, getVersion: async () => 'fixture' }),
    captureAuthority: () => () => { if (!current) throw reason; },
    loadConfig: () => {
      if (phase === 'config') { current = false; throw reason; }
      return { cesarEngine: 'alpha' };
    },
    classifyTask: () => 'other', seedRegistry: () => {}, updateRanked,
  });
  const signal = new AbortController().signal;
  const session = await host.open({ invocationId: 'revoked-test', cwd: outputDir, platform: 'darwin-arm64', signal, config: {} });
  const outcome = tribunalOwner.createTribunalRuntime(session.effects)({
    question: 'Q', engines: ['alpha', 'beta'], rounds: 1, protocol: 'chained',
    registry: session.registry, adapter: session.adapter, timeout: 1, outputDir, signal, onEvent,
  }).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  try {
    if (phase !== 'config') {
      await started.promise;
      current = false;
      gate.resolve();
    }
    expect((await outcome).error).toBe(reason);
    expect(dispatch).toHaveBeenCalledTimes(phase === 'summary' ? 3 : phase === 'retry' ? 1 : 2);
    expect(updateRanked).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.some(([event]) => event.type === 'forge:done')).toBe(false);
    expect(onEvent.mock.calls.some(([event]) => event.type === 'engine:failed')).toBe(false);
  } finally {
    gate.resolve();
    await outcome;
    rmSync(outputDir, { recursive: true, force: true });
  }
});

it.each(['cancelled', 'stale'] as const)('Tribunal host refuses %s provider and rating effects', async state => {
  const registry = new EngineRegistry();
  const engine = makeEngine('fixture');
  registry.register(engine);
  const controller = new AbortController();
  let current = true;
  const dispatch = vi.fn(async () => ({ exitCode: 0, stdout: 'argument', stderr: '', durationMs: 1, timedOut: false }));
  const openRegistry = vi.fn(() => registry);
  const readConfig = vi.fn(() => ({ cesarEngine: 'fixture' }));
  const seedRegistry = vi.fn();
  const updateRanked = vi.fn();
  const host = tribunalOwner.createTribunalHostServices({
    openRegistry,
    createAdapter: () => ({ dispatch, isAvailable: async () => true, getVersion: async () => 'fixture' }),
    captureAuthority: () => () => { if (!current) throw new Error('generation changed'); },
    loadConfig: readConfig, classifyTask: () => 'other', seedRegistry, updateRanked,
  });
  expect(openRegistry).not.toHaveBeenCalled();
  const session = await host.open({ invocationId: 'host-test', cwd: '/fixture-cwd', platform: 'darwin-arm64',
    signal: controller.signal, config: {} });
  expect(openRegistry).toHaveBeenCalledWith('/fixture-cwd');
  session.effects.loadConfig('/ignored');
  expect(readConfig).toHaveBeenCalledWith('/fixture-cwd');
  session.effects.seedRegistry(registry);
  expect(seedRegistry).toHaveBeenCalledOnce();
  if (state === 'cancelled') controller.abort(new Error('cancelled'));
  else current = false;
  const reason = state === 'cancelled' ? 'cancelled' : 'generation changed';
  await expect(session.adapter.dispatch({ engine, prompt: 'Q', cwd: '/fixture-cwd', mode: 'exec', timeout: 1, outputDir: '/unused' })).rejects.toThrow(reason);
  expect(() => session.effects.seedRegistry(registry)).toThrow(reason);
  expect(() => session.effects.updateRanked([], 'other', 'tribunal')).toThrow(reason);
  expect(() => session.effects.loadConfig('/ignored')).toThrow(reason);
  expect(dispatch).not.toHaveBeenCalled();
  expect(seedRegistry).toHaveBeenCalledOnce();
  expect(updateRanked).not.toHaveBeenCalled();
});

describe.each(['legacy', 'physical'] as const)('tribunal execution protocols: %s', runtime => {
  let agonHome: string | undefined;
  let outputDir: string | undefined;

  afterEach(() => {
    cleanupTestAgonHome(agonHome);
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    agonHome = undefined;
    outputDir = undefined;
  });

  async function run(protocol: 'parallel' | 'chained' | 'hybrid', rounds: number, scenario: 'normal' | 'retry' | 'summary-empty' | 'summary-timeout' = 'normal', cwd?: string) {
    agonHome = setupTestAgonHome(`tribunal-protocol-${protocol}`);
    outputDir = join(tmpdir(), `agon-tribunal-protocol-${protocol}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });

    const registry = new EngineRegistry();
    const engineIds = ['alpha', 'beta', 'gamma'];
    for (const id of engineIds) registry.register(makeEngine(id));

    const prompts: Array<{ engineId: string; round: number; prompt: string }> = [];
    const activeByRound = new Map<number, number>();
    const maxActiveByRound = new Map<number, number>();
    const controller = new AbortController();
    let summarySignal: AbortSignal | undefined;
    const events: tribunalOwner.TribunalEvent[] = [];
    const attempts = new Map<string, number>();
    const dispatchDirectories: string[] = [];

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        dispatchDirectories.push(options.cwd);
        if (options.systemPrompt?.includes('synthesizing a debate')) {
          summarySignal = options.signal;
          return { exitCode: 0, stdout: scenario === 'summary-empty' ? '' : 'summary', stderr: '', durationMs: 1, timedOut: scenario === 'summary-timeout' };
        }

        const round = Number(options.prompt.match(/## ROUND\n(\d+) of/)?.[1] ?? 0);
        const seat = `${options.engine.id}:${round}`;
        attempts.set(seat, (attempts.get(seat) ?? 0) + 1);
        if (scenario === 'retry' && options.engine.id === 'beta' && attempts.get(seat) === 1) {
          return { exitCode: 1, stdout: '', stderr: 'temporary failure', durationMs: 1, timedOut: false };
        }
        prompts.push({ engineId: options.engine.id, round, prompt: options.prompt });
        const active = (activeByRound.get(round) ?? 0) + 1;
        activeByRound.set(round, active);
        maxActiveByRound.set(round, Math.max(maxActiveByRound.get(round) ?? 0, active));
        await sleep(20);
        activeByRound.set(round, active - 1);
        return {
          exitCode: 0,
          stdout: `argument-${options.engine.id}-round-${round}`,
          stderr: '',
          durationMs: 20,
          timedOut: false,
        };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    const execute = runtime === 'legacy' ? runTribunal : tribunalOwner.createTribunalRuntime<EngineRegistry>({
      loadConfig, classifyTask, updateRanked: updateGlickoRanked, seedRegistry: seedNewEnginesFromRegistry,
    });
    const result = await execute({
      question: 'How should the protocol execute?',
      engines: engineIds,
      rounds,
      mode: 'adversarial',
      protocol,
      registry,
      adapter,
      timeout: 5,
      outputDir,
      cwd,
      signal: controller.signal,
      onEvent: event => events.push(event as tribunalOwner.TribunalEvent),
    });

    return { result, prompts, maxActiveByRound, summarySignal, signal: controller.signal, events, attempts, dispatchDirectories };
  }

  it('uses the invocation directory for every participant and summary dispatch', async () => {
    const { dispatchDirectories } = await run('parallel', 1, 'normal', '/fixture-invocation');
    expect(dispatchDirectories).toEqual(Array(4).fill('/fixture-invocation'));
  });

  it('retries a failed seat and retains its health and round evidence', async () => {
    const { result, attempts, events } = await run('parallel', 1, 'retry');
    expect([...attempts]).toEqual([['alpha:1', 1], ['beta:1', 2], ['gamma:1', 1]]);
    expect(result.positions[1].arguments).toEqual(['argument-beta-round-1']);
    expect(result.rounds[0].positions[1].arguments).toEqual(['argument-beta-round-1']);
    expect(result.panelHealth).toMatchObject({ requested: 3, responded: 3 });
    expect(result.panelHealth?.notes).toEqual([expect.stringContaining('retried OK')]);
    expect(events.at(-1)).toEqual({ type: 'forge:done', data: { rounds: 1, engines: 3, mode: 'adversarial', protocol: 'parallel' } });
  });

  it('keeps fallback evidence and a failure event when summary is empty', async () => {
    const { result, events } = await run('parallel', 1, 'summary-empty');
    expect(result.summary).toContain('**alpha (Argue FOR)**:');
    expect(result.summary).toContain('argument-beta-round-1');
    expect(events).toContainEqual({ type: 'engine:failed', engineId: 'alpha', data: {
      engineId: 'alpha', phase: 'tribunal-summary', error: 'tribunal summary returned empty response',
    } });
    expect(events.at(-1)?.type).toBe('forge:done');
  });

  it('rejects partial summary output from a timed-out provider even with exit code zero', async () => {
    const { result, events } = await run('parallel', 1, 'summary-timeout');
    expect(result.summary).toContain('argument-alpha-round-1');
    expect(events).toContainEqual({ type: 'engine:failed', engineId: 'alpha', data: {
      engineId: 'alpha', phase: 'tribunal-summary', error: 'tribunal summary failed: timed out | snippet: summary',
    } });
  });

  it.each([false, true])('completes Tribunal with Ratings disabled=%s', async disabled => {
    const registry = new ModRegistry({
      generation: 'tribunal-ratings-selection',
      activeOwners: disabled ? [] : [{ id: 'agon.ratings', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }],
    });
    await registry.runWithInvocationScope(async () => {
      const { result, prompts } = await run('parallel', 1);
      expect(result.summary).toBe('summary');
      expect(result.positions).toHaveLength(3);
      expect(prompts).toHaveLength(3);
      expect(existsSync(join(agonHome!, 'ratings.json'))).toBe(!disabled);
      expect(existsSync(join(agonHome!, 'ratings.json.lock'))).toBe(false);
    });
  });

  it('parallel starts every seat together without current-round context', async () => {
    const { result, prompts, maxActiveByRound, summarySignal, signal } = await run('parallel', 1);

    expect(result.protocol).toBe('parallel');
    expect(maxActiveByRound.get(1)).toBe(3);
    expect(prompts).toHaveLength(3);
    expect(prompts.every((entry) => !entry.prompt.includes('EARLIER ARGUMENTS THIS ROUND'))).toBe(true);
    expect(summarySignal).toBe(signal);
  });

  it('chained dispatches one seat at a time and passes earlier arguments forward', async () => {
    const { result, prompts, maxActiveByRound } = await run('chained', 1);

    expect(result.protocol).toBe('chained');
    expect(maxActiveByRound.get(1)).toBe(1);
    expect(prompts[0].prompt).not.toContain('EARLIER ARGUMENTS THIS ROUND');
    expect(prompts[1].prompt).toContain('argument-alpha-round-1');
    expect(prompts[2].prompt).toContain('argument-alpha-round-1');
    expect(prompts[2].prompt).toContain('argument-beta-round-1');
  });

  it('hybrid runs round one in parallel and chains later rounds', async () => {
    const { result, prompts, maxActiveByRound } = await run('hybrid', 2);

    expect(result.protocol).toBe('hybrid');
    expect(maxActiveByRound.get(1)).toBe(3);
    expect(maxActiveByRound.get(2)).toBe(1);

    const betaRoundOne = prompts.find((entry) => entry.engineId === 'beta' && entry.round === 1);
    const betaRoundTwo = prompts.find((entry) => entry.engineId === 'beta' && entry.round === 2);
    expect(betaRoundOne?.prompt).not.toContain('EARLIER ARGUMENTS THIS ROUND');
    expect(betaRoundTwo?.prompt).toContain('PREVIOUS ARGUMENTS');
    expect(betaRoundTwo?.prompt).toContain('argument-alpha-round-2');
  });
});
