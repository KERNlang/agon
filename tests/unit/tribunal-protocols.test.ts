import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineRegistry, loadConfig, classifyTask, updateGlickoRanked, seedNewEnginesFromRegistry } from '@kernlang/agon-core';
import * as tribunalOwner from '@kernlang/agon-mod-tribunal';
import type { DispatchOptions, DispatchResult, EngineAdapter, EngineDefinition } from '../../packages/core/src/models/types.js';
import { runTribunal } from '../../packages/forge/src/tribunal.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { ModRegistry } from '@kernlang/agon-kernel';
import { judgeTribunalForRating } from '@kernlang/agon-mod-ratings';

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

const JUDGE_KEY_ENV = 'AGON_TEST_TRIBUNAL_API_KEY';

function makeApiEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: false,
    tier: 'user',
    timeout: 30,
    exec: { args: [] },
    review: { args: [] },
    api: { baseUrl: 'https://api.example.test/v1', apiKeyEnv: JUDGE_KEY_ENV, model: `${id}-model` },
  } as EngineDefinition;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

it.each(['adversarial', 'synthesis'] as const)('Tribunal %s ratings use judged scores and preserve retry outcomes', async mode => {
  const outputDir = mkdtempSync(join(tmpdir(), 'tribunal-rank-'));
  const registry = new EngineRegistry();
  for (const id of ['alpha', 'beta', 'failed']) registry.register(makeEngine(id));
  const attempts = new Map<string, number>();
  const updateRanked = vi.fn();
  const ranking = [{ engineId: 'beta', score: 2 }, { engineId: 'alpha', score: 0 }];
  const judgeForRating = vi.fn(async (options: { failed: string[] }) => {
    expect(options.failed).toEqual(['failed']);
    return ranking;
  });
  const execute = tribunalOwner.createTribunalRuntime({
    seedRegistry: () => {}, updateRanked, judgeForRating, classifyTask: () => 'code', loadConfig: () => ({ cesarEngine: 'alpha' }),
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
    expect(judgeForRating).toHaveBeenCalledTimes(1);
    expect(updateRanked.mock.calls).toEqual(mode === 'adversarial'
      ? [[ranking, 'code', 'tribunal', {}], [ranking, 'code', 'critique']] : [[ranking, 'code', 'tribunal', {}]]);
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
    judgeForRating: async () => [{ engineId: 'alpha', score: 1 }, { engineId: 'beta', score: 0 }],
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
        if (options.systemPrompt?.includes('impartial judge')) {
          return { exitCode: 0, stdout: 'no ranking', stderr: '', durationMs: 1, timedOut: false };
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
      // Default shadow judging must not write scores, even with Ratings enabled.
      expect(existsSync(join(agonHome!, 'ratings.json'))).toBe(false);
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

type JudgeReply = DispatchResult | 'hang';

interface JudgedRun {
  seats: Record<string, string | null>;
  others?: Array<Partial<EngineDefinition> & { id: string }>;
  config?: Record<string, unknown>;
  judge?: (judgeId: string, shown: Record<string, string>, options: DispatchOptions) => JudgeReply | Promise<JudgeReply>;
  seed?: string;
  rng?: () => number;
  signal?: AbortSignal;
  settleMs?: number;
  expectAbort?: boolean;
  judgePool?: string[];
  defs?: Record<string, Partial<EngineDefinition>>;
}

const reply = (stdout: string, exitCode = 0): DispatchResult => ({ exitCode, stdout, stderr: exitCode ? 'judge failed' : '', durationMs: 1, timedOut: false });

const shownIn = (prompt: string): Record<string, string> => {
  const shown: Record<string, string> = {};
  for (const m of prompt.matchAll(/---BEGIN POSITION (P\d+) \(assigned role: [^\n]*\) [0-9a-f]+---\n(\S+)/g)) shown[m[1]] = m[2];
  return shown;
};

const rankBy = (order: string[]) => (_judge: string, shown: Record<string, string>) => {
  const labelOf = Object.fromEntries(Object.entries(shown).map(([label, marker]) => [marker, label]));
  return reply(`Reasoning.\nRANK: ${order.filter((m) => labelOf[m]).map((m) => labelOf[m]).join(' > ')}`);
};

describe.each(['legacy', 'physical'] as const)('tribunal judged ratings: %s', path => {
  let agonHome: string | undefined;
  let outputDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    cleanupTestAgonHome(agonHome);
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    agonHome = undefined;
    outputDir = undefined;
  });

  async function runJudged(setup: JudgedRun) {
    agonHome = setupTestAgonHome('tribunal-judged');
    outputDir = join(tmpdir(), `agon-tribunal-judged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(agonHome, 'config.json'), JSON.stringify({ ratingJudging: 'on', ...setup.config }));
    if (setup.seed !== undefined) writeFileSync(join(agonHome, 'ratings.json'), setup.seed);

    vi.stubEnv(JUDGE_KEY_ENV, 'test-key');
    const registry = new EngineRegistry();
    const engineIds = Object.keys(setup.seats);
    for (const id of engineIds) registry.register({ ...makeApiEngine(id), ...setup.defs?.[id] } as EngineDefinition);
    for (const other of setup.others ?? []) registry.register({ ...makeApiEngine(other.id), ...other } as EngineDefinition);

    const judgeCalls: string[] = [];
    const judgeOutputDirs: string[] = [];
    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.systemPrompt?.includes('synthesizing a debate')) return reply('summary');
        if (options.systemPrompt?.includes('impartial judge')) {
          judgeCalls.push(options.engine.id);
          judgeOutputDirs.push(options.outputDir);
          const answer = await (setup.judge ?? (() => reply('prose only')))(options.engine.id, shownIn(options.prompt), options);
          return answer === 'hang' ? new Promise<DispatchResult>(() => {}) : answer;
        }
        const out = setup.seats[options.engine.id];
        if (out === null) return reply('', 1);
        return { ...reply(out), identity: `model-${options.engine.id}` } as DispatchResult;
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    const execute = path === 'legacy' ? runTribunal : tribunalOwner.createTribunalRuntime({
      seedRegistry: seedNewEnginesFromRegistry, loadConfig, classifyTask, updateRanked: updateGlickoRanked,
      judgeForRating: options => judgeTribunalForRating({ ...options, config: loadConfig(options.cwd) }),
    });
    const invocation = execute({
      question: 'Should we ship the release?', engines: engineIds, rounds: 1, mode: 'adversarial', protocol: 'parallel',
      registry, adapter, timeout: 5, outputDir, signal: setup.signal, rng: setup.rng, judgePool: setup.judgePool,
    } as Parameters<typeof runTribunal>[0]);

    let result: tribunalOwner.TribunalResult | undefined;
    if (setup.expectAbort) {
      await invocation.then(
        () => { throw new Error('Expected Tribunal cancellation'); },
        error => {
          expect(setup.signal?.aborted).toBe(true);
          expect(error).toBe(setup.signal?.reason);
        },
      );
    }
    else result = await invocation;

    if (setup.settleMs) await sleep(setup.settleMs);
    const ratingsFile = join(agonHome, 'ratings.json');
    const ballotsFile = join(outputDir, 'ballots.json');
    return {
      result,
      judgeCalls,
      judgeOutputDirs,
      ratingsText: existsSync(ratingsFile) ? readFileSync(ratingsFile, 'utf-8') : null,
      ratings: existsSync(ratingsFile) ? JSON.parse(readFileSync(ratingsFile, 'utf-8')) : null,
      ballots: existsSync(ballotsFile) ? JSON.parse(readFileSync(ballotsFile, 'utf-8')) : null,
    };
  }

  const record = (mode: string, ratings: any, id: string) => {
    const r = ratings?.byMode?.[mode]?.[id];
    return r ? `${r.wins}-${r.losses}` : 'none';
  };

  const SEED = JSON.stringify({ global: { zeta: { mu: 1600, phi: 80, sigma: 0.06, wins: 3, losses: 1, lastActive: '2026-09-01T00:00:00.000Z' } }, byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} }, byTaskClass: {}, engineMeta: {}, lastUpdated: '2026-09-01T00:00:00.000Z' }, null, 2) + '\n';

  it('a failed seat is on no ballot, casts none and stays unrated; responders are ranked by the judges', async () => {
    const run = await runJudged({ seats: { alpha: 'MA argues well', beta: 'MB argues', gamma: null, delta: 'MD argues' }, judge: rankBy(['MA', 'MB', 'MD']) });
    expect(run.judgeCalls.sort()).toEqual(['alpha', 'beta', 'delta']);
    expect(run.ballots.ballots.flatMap((b: any) => Object.values(b.labelMap))).not.toContain('gamma');
    for (const mode of ['tribunal', 'critique']) {
      expect([record(mode, run.ratings, 'alpha'), record(mode, run.ratings, 'beta'), record(mode, run.ratings, 'delta')]).toEqual(['2-0', '1-1', '0-2']);
      expect(run.ratings.byMode[mode].gamma).toBeUndefined();
    }
    expect(run.ratings.global.gamma).toBeUndefined();
    expect(run.ratings.engineMeta.alpha.identity).toBe('model-alpha');
  });

  it('notes the dispatch identities once per run: a changed model is pending after one run, not confirmed', async () => {
    const seed = JSON.stringify({ global: {}, byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} }, byTaskClass: {}, engineMeta: { alpha: { firstSeen: '', lastActive: '', matchCount: 3, derivedFrom: null, versions: [], identity: 'model-old' } }, lastUpdated: '' });
    const run = await runJudged({ seats: { alpha: 'MA argues', beta: 'MB argues', gamma: 'MC argues' }, seed, judge: rankBy(['MA', 'MB', 'MC']) });
    expect(run.ratings.engineMeta.alpha).toMatchObject({ identity: 'model-old', pendingIdentity: 'model-alpha', pendingCount: 1, versions: [] });
  });

  it('writes no rating at all when only one seat responded', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: null, gamma: null }, judge: rankBy(['MA']) });
    expect(run.ratings?.global ?? {}).toEqual({});
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
  });

  it('AC-3 a 6000-char position ranked last on every ballot loses to an 800-char position ranked first', async () => {
    const run = await runJudged({
      seats: { alpha: `MLONG ${'L'.repeat(6000)}`, beta: `MSHORT ${'S'.repeat(800)}`, gamma: `MMID ${'M'.repeat(300)}` },
      judge: rankBy(['MSHORT', 'MMID', 'MLONG']),
    });
    for (const mode of ['tribunal', 'critique']) {
      expect([record(mode, run.ratings, 'alpha'), record(mode, run.ratings, 'beta'), record(mode, run.ratings, 'gamma')]).toEqual(['0-2', '2-0', '1-1']);
    }
    expect(run.ratings.byMode.tribunal.beta.mu).toBeGreaterThan(run.ratings.byMode.tribunal.alpha.mu);
  });

  it('AC-3 identical judged means skip the pair whatever the lengths (2500 vs 150 chars)', async () => {
    const shown = (judge: string) => ({ alpha: ['MB', 'MC'], beta: ['MA', 'MC'], gamma: ['MA', 'MB'] })[judge]!;
    const run = await runJudged({
      seats: { alpha: `MA ${'A'.repeat(2500)}`, beta: `MB ${'B'.repeat(150)}`, gamma: 'MC short' },
      judge: (judge, labels) => {
        const labelOf = Object.fromEntries(Object.entries(labels).map(([l, m]) => [m, l]));
        const [x, y] = shown(judge).map((m) => labelOf[m]);
        return reply(judge === 'gamma' ? `RANK: ${x} = ${y}` : `RANK: ${x} > ${y}`);
      },
    });
    expect([record('tribunal', run.ratings, 'alpha'), record('tribunal', run.ratings, 'beta'), record('tribunal', run.ratings, 'gamma')]).toEqual(['1-0', '1-0', '0-2']);
  });

  it('AC-4 two positions: the judge is a non-participant even when cesarEngine argued, and it ranks both', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }], config: { cesarEngine: 'alpha' }, judgePool: ['alpha', 'beta', 'delta'],
      judge: rankBy(['MB', 'MA']), rng: () => 0.5,
    });
    expect(run.judgeCalls).toEqual(['delta']);
    expect(run.ballots.ballots[0]).toMatchObject({ judge: 'delta', valid: true });
    expect([record('tribunal', run.ratings, 'beta'), record('tribunal', run.ratings, 'alpha')]).toEqual(['1-0', '0-1']);
    expect(run.ratings.byMode.tribunal.delta).toBeUndefined();
  });

  it('AC-4 draws the judge uniformly from the eligible non-participants with the injected rng', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }, { id: 'epsilon' }], judgePool: ['alpha', 'beta', 'delta', 'epsilon'], judge: rankBy(['MA', 'MB']), rng: () => 0.6 });
    expect(run.judgeCalls).toEqual(['epsilon']);
  });

  it('AC-4 hidden or removed engines are not judges: no judge, no write, ratings.json byte-identical', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'hid' }, { id: 'gone' }], judgePool: ['alpha', 'beta', 'hid', 'gone'],
      config: { hiddenEngines: ['hid'], removedEngines: ['gone'] }, seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0,
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-impartial-judge', summary: { dispatched: 0 } });
  });

  it('AC-4 a non-participant sharing a derivedFrom lineage with a participant is not eligible', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'alpha2', derivedFrom: 'alpha' }], judgePool: ['alpha', 'beta', 'alpha2'], seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0,
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
  });

  it('AC-4 a failing judge writes nothing: ratings.json byte-identical', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }], judgePool: ['alpha', 'beta', 'delta'], seed: SEED, judge: () => reply('', 2), rng: () => 0 });
    expect(run.judgeCalls).toEqual(['delta']);
    expect(run.ratingsText).toBe(SEED);
  });

  it('B2 an explicit selection of two engines sends the debate to no other engine: no judge, no write, note no-impartial-judge', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }], seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0 });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-impartial-judge', summary: { dispatched: 0 } });
  });

  it('B2 the impartial judge comes from the run roster, never from an active engine outside it', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }, { id: 'outsider' }], judgePool: ['alpha', 'beta', 'delta'],
      judge: rankBy(['MA', 'MB']), rng: () => 0.99,
    });
    expect(run.judgeCalls).toEqual(['delta']);
  });

  it('B1 a participant with a CLI binary casts no peer ballot but is still ranked by the text-only judges', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA argues', beta: 'MB argues', gamma: 'MC argues' }, defs: { gamma: { binary: 'sh' } },
      judge: rankBy(['MA', 'MB', 'MC']),
    });
    expect(run.judgeCalls.sort()).toEqual(['alpha', 'beta']);
    expect(run.ballots.ineligibleJudges).toEqual({ gamma: 'not-text-only' });
    expect(run.ballots.ballots.flatMap((b: any) => Object.values(b.labelMap))).toContain('gamma');
    expect(record('tribunal', run.ratings, 'gamma')).toBe('0-2');
  });

  it('B1 a write-capable or CLI engine is never the impartial judge; with none left nothing is rated and ballots.json says why', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, judgePool: ['alpha', 'beta', 'yolo', 'cli'], seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0,
      others: [{ id: 'yolo', exec: { args: ['--yolo', '{prompt}'] } }, { id: 'cli', binary: 'sh' }],
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-text-only-judge', summary: { dispatched: 0 }, ineligibleJudges: { yolo: 'write-capable', cli: 'not-text-only' } });
  });

  it('B1 when no responding participant can judge text-only, no ballot is dispatched, nothing is rated and ballots.json carries the note', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB', gamma: 'MC' }, defs: { alpha: { binary: 'sh' }, beta: { binary: 'sh' }, gamma: { binary: 'sh' } },
      seed: SEED, judge: rankBy(['MA', 'MB', 'MC']),
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-text-only-judge', summary: { dispatched: 0 } });
  });

  it('ratingBallotMaxChars caps the position characters each judge is sent and ballots.json records which labels were cut', async () => {
    const seen: string[] = [];
    const run = await runJudged({
      seats: { alpha: `MA ${'a'.repeat(900)}`, beta: `MB ${'b'.repeat(900)}`, gamma: 'MC short' }, config: { ratingBallotMaxChars: 400 },
      judge: (judge, shown, options) => { seen.push(options.prompt); return rankBy(['MA', 'MB', 'MC'])(judge, shown); },
    });
    expect(run.ballots.ballots.find((b: any) => b.judge === 'gamma').truncated.sort()).toEqual(['P1', 'P2']);
    expect(run.ballots.ballots.find((b: any) => b.judge === 'alpha').truncated).toHaveLength(1);
    for (const prompt of seen) expect(prompt.length).toBeLessThan(2000);
    expect(run.ballots.positionChars.alpha).toBe(903);
  });

  it('an invalid ratingBallotMaxChars falls back to the default cap, which leaves ordinary positions whole', async () => {
    const run = await runJudged({
      seats: { alpha: `MA ${'a'.repeat(900)}`, beta: `MB ${'b'.repeat(900)}`, gamma: 'MC short' }, config: { ratingBallotMaxChars: -5 },
      judge: rankBy(['MA', 'MB', 'MC']),
    });
    expect(run.ballots.ballots.map((b: any) => b.truncated)).toEqual([[], [], []]);
  });

  const threeSeats = { alpha: `MA ${'a'.repeat(300)}`, beta: `MB ${'b'.repeat(200)}`, gamma: `MC ${'c'.repeat(100)}` };
  const unchangedOutput = (result: any) => {
    expect(result.summary).toBe('summary');
    expect(result.positions.map((p: any) => p.arguments)).toEqual([[threeSeats.alpha], [threeSeats.beta], [threeSeats.gamma]]);
    expect(result.panelHealth).toMatchObject({ degraded: false, notes: [] });
  };

  it('AC-6 judges exiting non-zero leave the output unchanged and write no rating', async () => {
    const run = await runJudged({ seats: threeSeats, judge: () => reply('RANK: P1 > P2', 1) });
    unchangedOutput(run.result);
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ballots.ballots.map((b: any) => b.reason)).toEqual(['error', 'error', 'error']);
  });

  it('AC-6 judges hanging past ratingJudgeTimeoutSec time out; the run completes with no rating write', async () => {
    const started = Date.now();
    const run = await runJudged({ seats: threeSeats, config: { ratingJudgeTimeoutSec: 1 }, judge: () => 'hang' });
    expect(Date.now() - started).toBeLessThan(10_000);
    unchangedOutput(run.result);
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ballots.summary).toMatchObject({ dispatched: 3, valid: 0, timedOut: 3 });
  });

  it('AC-6 ratingJudging off dispatches no ballot and writes no tribunal or critique rating', async () => {
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'off' }, judge: rankBy(['MA', 'MB', 'MC']) });
    unchangedOutput(run.result);
    expect(run.judgeCalls).toEqual([]);
    expect(run.ballots).toBeNull();
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ratings?.byMode?.critique ?? {}).toEqual({});
  });

  it('an invalid ratingJudging value behaves as off: no ballot, no ballots.json, no rating', async () => {
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'shdow' }, judge: rankBy(['MA', 'MB', 'MC']) });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ballots).toBeNull();
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
  });

  it('AC-6 shadow dispatches and records the ballots but writes no tribunal or critique rating', async () => {
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'shadow' }, judge: rankBy(['MA', 'MB', 'MC']) });
    unchangedOutput(run.result);
    expect(run.judgeCalls.sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(new Set(run.judgeOutputDirs)).toEqual(new Set([join(outputDir!, 'ballots')]));
    expect(run.ballots).toMatchObject({ judging: 'shadow', summary: { dispatched: 3, valid: 3, timedOut: 0 } });
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ratings?.byMode?.critique ?? {}).toEqual({});
  });

  it('AC-12 prose-only judges: ballots.json records every ballot as invalid no-rank and the summary line is printed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'shadow' }, judge: () => reply('P1 was strongest overall.') });
    expect(run.ballots.ballots).toHaveLength(3);
    for (const ballot of run.ballots.ballots) {
      expect(ballot).toMatchObject({ valid: false, reason: 'no-rank', rankLine: null });
      expect(Object.keys(ballot.labelMap).sort()).toEqual(['P1', 'P2']);
    }
    expect(run.ballots.summary).toMatchObject({ dispatched: 3, valid: 0, timedOut: 0 });
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('ballots: 0/3 valid, 0 timed out'))).toHaveLength(1);
  });

  it('AC-12 a run aborted mid-ballots keeps a partial ballots.json with the ballots completed so far', async () => {
    const controller = new AbortController();
    const run = await runJudged({
      seats: threeSeats, signal: controller.signal, settleMs: 100, expectAbort: true,
      judge: (judge, shown, options) => {
        if (judge === 'alpha') {
          setTimeout(() => controller.abort(), 30);
          return rankBy(['MB', 'MC'])(judge, shown);
        }
        return new Promise<DispatchResult>((resolve) => options.signal?.addEventListener('abort', () => resolve(reply('', 130)), { once: true }));
      },
    });
    expect(run.ballots.ballots).toEqual([expect.objectContaining({ judge: 'alpha', valid: true })]);
    expect(run.ballots.summary).toMatchObject({ dispatched: 3, valid: 1, aborted: true });
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
  });
});
