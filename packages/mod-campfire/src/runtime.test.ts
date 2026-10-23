import { describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import type { EngineRegistry } from '@kernlang/agon-core';
import { runCampfire as legacy } from '../../../tests/fixtures/modular-campfire-legacy.js';
import { runCampfireRuntime } from './runtime.js';
import { runCampfire as compatibility } from '../../forge/src/campfire.js';

describe('Campfire frozen legacy oracle', () => {
  it.each([
    ['lead-first', 'normal'], ['all-respond', 'normal'],
    ['lead-first', 'empty-lead'], ['lead-first', 'throw-lead'],
    ['lead-first', 'agreement'], ['lead-first', 'short-observer'],
    ['lead-first', 'throw-observer'], ['all-respond', 'throw-observer'],
    ['lead-first', 'single'], ['all-respond', 'empty-lead'],
  ] as const)('preserves dispatch and raw rounds: %s/%s', async (strategy, scenario) => {
    const calls = () => {
      const dispatch = vi.fn(async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
        const id = options.engine.id;
        if ((scenario === 'throw-lead' && id === 'alpha') || (scenario === 'throw-observer' && id === 'beta')) throw new Error('fixture failure');
        const stdout = id === 'alpha' && scenario === 'empty-lead' ? ''
          : id === 'beta' && scenario === 'agreement' ? 'Agree, nothing substantive to add.'
          : id === 'beta' && scenario === 'short-observer' ? 'Short view'
          : `${id}: a substantive independent perspective.`;
        return { engineId: id, stdout, stderr: '', exitCode: 0, timedOut: false, durationMs: 1 };
      });
      return { dispatch, adapter: { dispatch } as unknown as EngineAdapter };
    };
    const old = calls();
    const current = calls();
    const facade = calls();
    const registry = { get: (id: string) => ({ id }) as EngineDefinition, findBinary: () => '/fixture/engine' } as unknown as EngineRegistry;
    const options = {
      topic: 'Physical ownership', context: 'Project context', seedPlan: 'Prior assessment',
      engines: scenario === 'single' ? ['alpha'] : ['alpha', 'beta'], registry, strategy,
      leadEngine: 'alpha', timeout: 17, outputDir: '/fixture/campfire',
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const expected = await legacy({ ...options, adapter: old.adapter });
      const actual = await runCampfireRuntime({ ...options, cwd: process.cwd(), adapter: current.adapter }, { loadConfig: () => ({}), warn: () => {} });
      expect({ topic: actual.topic, rounds: actual.rounds }).toEqual(expected);
      expect(await compatibility({ ...options, adapter: facade.adapter })).toEqual(expected);
      // The extracted runtime owns a child signal so revocation can stop siblings.
      expect(current.dispatch.mock.calls.map(([{ signal, ...args }]) => {
        expect(signal?.aborted).toBe(false);
        return args;
      })).toEqual(old.dispatch.mock.calls.map(([{ signal: _signal, ...args }]) => args));
      expect(facade.dispatch.mock.calls.map(([{ signal: _signal, ...args }]) => args))
        .toEqual(old.dispatch.mock.calls.map(([{ signal: _signal, ...args }]) => args));
      expect(current.dispatch).toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });
});
