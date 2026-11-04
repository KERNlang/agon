import { describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import type { EngineRegistry } from '@kernlang/agon-core';
import { runThinkChain as legacy, runAdversarialCritique as legacyCritique } from '../../../tests/fixtures/modular-think-legacy.js';
import { runThinkRuntime } from './runtime.js';
import { runThinkChain as compatibility, runAdversarialCritique as compatibilityCritique } from '../../forge/src/thinking.js';
import { createThinkHostServices } from './host.js';

describe('Think frozen legacy runtime', () => {
  it.each(['success','empty','exit','timeout','throw'])('preserves direct critic API with omitted cwd: %s', async scenario => {
    const makeAdapter = () => {
      const dispatch = vi.fn(async () => {
        if (scenario === 'throw') throw new Error('critic unavailable');
        return {stdout:scenario==='empty'?'':'  Critique  ',stderr:'',exitCode:scenario==='exit'?2:0,timedOut:scenario==='timeout',durationMs:1};
      });
      return {dispatch,adapter:{dispatch} as unknown as EngineAdapter};
    };
    const before = makeAdapter(), after = makeAdapter();
    const options = {problem:'Inspect',thoughts:[],summary:'Done',criticId:'critic',registry:{get:(id:string)=>({id})} as EngineRegistry,timeout:17,outputDir:'/fixture/critic'};
    const warnings = vi.spyOn(console,'warn').mockImplementation(()=>{});
    try {
      const expected = await legacyCritique({...options,adapter:before.adapter});
      const expectedWarnings = [...warnings.mock.calls];
      warnings.mockClear();
      expect(await compatibilityCritique({...options,adapter:after.adapter})).toEqual(expected);
      expect(after.dispatch.mock.calls).toEqual(before.dispatch.mock.calls);
      expect(warnings.mock.calls).toEqual(expectedWarnings);
      expect(after.dispatch).toHaveBeenCalledWith(expect.objectContaining({cwd:process.cwd(),textOnly:true}));
    } finally { warnings.mockRestore(); }
  });
  it('captures engine selection and denies dispatch after host revocation', async () => {
    let current = true;
    const active = ['fixture', 'critic'];
    const defaults = ['fixture'];
    const registry = { get: (id: string) => ({ id }) as EngineDefinition, resolveId: (id: string) => id };
    const dispatch = vi.fn();
    const selectEngines = vi.fn(() => ({ activeEngineIds: active, defaultEngineIds: defaults }));
    const host = createThinkHostServices({
      openRegistry: vi.fn(() => registry), selectEngines,
      createAdapter: () => ({ dispatch }) as unknown as EngineAdapter,
      captureAuthority: () => () => { if (!current) throw new Error('host revoked'); }, warn: vi.fn(),
    });
    const context = { cwd: '/captured/think', invocationId: 'fixture', platform: 'darwin-arm64' as const,
      signal: new AbortController().signal, config: {} };
    const session = await host.open(context);
    active.length = 0;
    defaults.push('later');
    expect(session.activeEngineIds).toEqual(['fixture', 'critic']);
    expect(session.defaultEngineIds).toEqual(['fixture']);
    expect(selectEngines).toHaveBeenCalledExactlyOnceWith(registry, context.cwd);
    current = false;
    await expect(session.adapter.dispatch({engine: registry.get('fixture'), prompt: 'blocked', cwd: context.cwd,
      mode: 'exec', timeout: 17, outputDir: '/fixture/think'})).rejects.toThrow('host revoked');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    'linear', 'reflexion', 'tot', 'graph', 'hypothesis', 'invalid',
    'exit', 'timeout', 'empty', 'throw', 'critic', 'critic-throw',
    'critic-timeout', 'same-critic', 'malformed', 'grounded', 'thought-cap',
  ])('preserves raw requests, results and warnings: %s', async scenario => {
    const strategy = ['linear', 'reflexion', 'tot', 'graph', 'hypothesis', 'invalid'].includes(scenario) ? scenario : 'linear';
    const stdout = JSON.stringify({
      thoughts: scenario === 'thought-cap' ? Array.from({length:100},(_,index)=>({thoughtNumber:index+1,totalThoughts:100,thought:'Cap fixture',kind:'analysis',nextThoughtNeeded:true})) : [
        { thoughtNumber: 1, totalThoughts: 2, thought: 'Inspect `packages/mod-think/src/runtime.ts` and `packages/missing-think-fixture.ts`', kind: 'analysis', nextThoughtNeeded: true, branchId: 'alpha', score: 0.8 },
        { thoughtNumber: 2, totalThoughts: 2, thought: 'Choose the verified result', kind: 'decision', nextThoughtNeeded: false, branchId: 'beta', score: 0.9 },
      ], summary: 'Use verified result', openQuestions: ['Any missing evidence?'], refinedSpec: 'Implement the verified choice',
    });
    const createAdapter = () => {
      const dispatch = vi.fn(async (request: Parameters<EngineAdapter['dispatch']>[0]) => {
        const critic = request.engine.id === 'critic';
        if (scenario === 'throw' || (critic && scenario === 'critic-throw')) throw new Error('fixture dispatch failed');
        return { engineId: request.engine.id, stdout: critic ? 'Check the unstated assumption.' : scenario === 'empty' ? '' : scenario === 'malformed' ? 'Not JSON, but a nonempty answer' : stdout,
          stderr: scenario === 'exit' ? 'fixture failure' : '', exitCode: scenario === 'exit' ? 2 : 0,
          timedOut: scenario === 'timeout' || (critic && scenario === 'critic-timeout'), durationMs: 1 };
      });
      return { dispatch, adapter: { dispatch } as unknown as EngineAdapter };
    };
    const before = createAdapter();
    const after = createAdapter();
    const facade = createAdapter();
    const options = { problem: 'Choose an implementation', strategy, engineId: 'fixture',
      maxThoughts: scenario === 'thought-cap' ? 20 : 6, branches: scenario === 'thought-cap' ? 8 : 2, critic: scenario === 'same-critic' ? 'fixture' : scenario.startsWith('critic') ? 'critic' : undefined,
      timeout: 17, outputDir: '/fixture/think/output', cwd: scenario === 'grounded' ? process.cwd() : '/fixture/think', ground: scenario === 'grounded',
      registry: { get: (id: string) => ({ id }) as EngineDefinition } as EngineRegistry };
    const legacyWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const expected = await legacy({ ...options, adapter: before.adapter });
      const warnings = legacyWarning.mock.calls.map(([message]) => message);
      const warn = vi.fn();
      const actual = await runThinkRuntime({ ...options, adapter: after.adapter }, { warn });
      expect(actual).toEqual(expected);
      if (scenario === 'thought-cap') expect(actual.thoughts).toHaveLength(80);
      if (scenario === 'grounded') expect(actual.groundingIssues.join('\n')).toContain('missing-think-fixture.ts');
      expect(after.dispatch.mock.calls).toEqual(before.dispatch.mock.calls);
      expect(warn.mock.calls.map(([message]) => message)).toEqual(warnings);
      legacyWarning.mockClear();
      expect(await compatibility({ ...options, adapter: facade.adapter })).toEqual(expected);
      expect(facade.dispatch.mock.calls).toEqual(before.dispatch.mock.calls);
      expect(legacyWarning.mock.calls.map(([message]) => message)).toEqual(warnings);
      expect(after.dispatch).toHaveBeenCalled();
    } finally { legacyWarning.mockRestore(); }
  });

  it.each([
    ['cancellation', 'before'], ['cancellation', 'reasoner'], ['cancellation', 'critic'],
    ['generation', 'before'], ['generation', 'reasoner'], ['generation', 'critic'],
  ])('rejects %s at %s', async (fault, phase) => {
    const controller = new AbortController();
    let current = true;
    const message = fault === 'cancellation' ? 'operator cancelled' : 'generation changed';
    const revoke = () => {
      if (fault === 'cancellation') controller.abort(new Error(message));
      else current = false;
    };
    if (phase === 'before') revoke();
    const dispatch = vi.fn(async (request: Parameters<EngineAdapter['dispatch']>[0]) => {
      if ((phase === 'reasoner' && request.engine.id === 'fixture') || (phase === 'critic' && request.engine.id === 'critic')) {
        revoke();
      }
      return { stdout: request.engine.id === 'critic' ? 'Critique' : JSON.stringify({ thoughts: [], summary: 'Must not publish' }),
        stderr: '', exitCode: 0, timedOut: false, durationMs: 1 };
    });
    await expect(runThinkRuntime({ problem: 'Cancel', strategy: 'linear', engineId: 'fixture', critic: 'critic',
      maxThoughts: 6, timeout: 17, outputDir: '/fixture/think', cwd: '/fixture/think', ground: false,
      registry: { get: id => ({ id }) as EngineDefinition }, adapter: { dispatch } as unknown as EngineAdapter,
      signal: controller.signal }, { warn: vi.fn(), assertCurrent: () => { if (!current) throw new Error(message); } })).rejects.toThrow(message);
    expect(dispatch).toHaveBeenCalledTimes(phase === 'before' ? 0 : phase === 'reasoner' ? 1 : 2);
  });
});
