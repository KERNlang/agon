import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { EngineAdapter } from '@kernlang/agon-core';
import { runSynthesisModus as frozen } from '../fixtures/modular-synthesis-legacy.js';
import { runSynthesisModus as current } from '../../packages/forge/src/synthesis-modus.js';

const health = vi.hoisted(() => ({ filter: vi.fn() }));
vi.mock('../../packages/forge/src/health-check.js', () => ({
  preflightHealthFilter: health.filter,
}));
vi.mock('@kernlang/agon-support-panel', async original => ({
  ...await original<object>(),
  preflightHealthFilter: health.filter,
}));

describe('Synthesis frozen runtime contract', () => {
  it('preserves out-of-order completion and barriers with four engines', async () => {
    const execute = async (run: typeof frozen) => {
      const engines = ['alpha', 'beta', 'gamma', 'delta'];
      health.filter.mockResolvedValue({ healthy: engines, skipped: [] });
      const pending: Array<{ prompt: string; resolve: (value: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }) => void }> = [];
      const calls: unknown[] = [], events: unknown[] = [];
      const dispatch = vi.fn((request: Parameters<EngineAdapter['dispatch']>[0]) => {
        calls.push(request);
        return new Promise(resolve => pending.push({ prompt: request.prompt, resolve }));
      });
      const task = run({ prompt: 'Design', engines, swaps: 2, timeout: 17,
        outputDir: '/fixture/synthesis',
        registry: { get: (id: string) => ({ id }) } as never,
        adapter: { dispatch } as never, onEvent: event => events.push(event) });
      const finish = (index: number, stdout: string) => pending[index].resolve({ stdout, stderr: '', exitCode: 0, timedOut: false });
      await vi.waitFor(() => expect(pending).toHaveLength(4));
      for (const index of [3, 1, 2]) finish(index, `draft ${index}`);
      await vi.waitFor(() => expect(events).toHaveLength(3));
      expect(pending).toHaveLength(4);
      finish(0, 'draft 0');
      await vi.waitFor(() => expect(pending).toHaveLength(6));
      expect(pending.slice(4).every(call => call.prompt.startsWith('## SYNTHESIS SWAP'))).toBe(true);
      finish(5, 'improved 5\n## REASONING\nchange 5');
      await vi.waitFor(() => expect(events).toHaveLength(5));
      expect(pending).toHaveLength(6);
      finish(4, 'improved 4\n## REASONING\nchange 4');
      await vi.waitFor(() => expect(pending).toHaveLength(8));
      finish(7, 'improved 7\n## REASONING\nchange 7');
      await vi.waitFor(() => expect(events).toHaveLength(7));
      expect(pending).toHaveLength(8);
      finish(6, 'improved 6\n## REASONING\nchange 6');
      await vi.waitFor(() => expect(pending).toHaveLength(9));
      expect(pending[8].prompt).toMatch(/^## SYNTHESIS JUDGE/);
      finish(8, 'SCORE_1: 80\nSCORE_2: 60\nWINNER: alpha\nREASONING: fixture');
      return { result: await task, calls, events };
    };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const expected = await execute(frozen);
      const actual = await execute(current);
      expect(actual).toEqual(expected);
      expect(actual.result.drafts.map(draft => draft.engineId)).toEqual(['delta', 'beta', 'gamma', 'alpha']);
      expect(actual.result.swaps.map(swap => swap.improvedContent)).toEqual(['improved 5', 'improved 4', 'improved 7', 'improved 6']);
    } finally {
      random.mockRestore();
      health.filter.mockReset();
    }
  });

  it.each(['draft', 'swap', 'judge'].flatMap(phase => ['resolve', 'reject'].map(outcome => ({ phase, outcome }))))
    ('stops after a late $outcome during cancelled $phase', async ({ phase, outcome }) => {
      const controller = new AbortController();
      health.filter.mockResolvedValue({ healthy: ['alpha', 'beta'], skipped: [] });
      const events: unknown[] = [];
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let eventsAtAbort = 0;
      const dispatch = vi.fn(async (request: Parameters<EngineAdapter['dispatch']>[0]) => {
        expect(request.signal).toBe(controller.signal);
        const activePhase = request.prompt.startsWith('## SYNTHESIS DRAFT') ? 'draft'
          : request.prompt.startsWith('## SYNTHESIS SWAP') ? 'swap' : 'judge';
        if (activePhase === phase) {
          eventsAtAbort = events.length;
          controller.abort(new Error('fixture phase cancellation'));
          await Promise.resolve();
          if (outcome === 'reject') throw new Error('late adapter failure');
        }
        return { stdout: 'fixture response', stderr: '', exitCode: 0, timedOut: false };
      });
      try {
        await expect(current({ prompt: 'Design', engines: ['alpha', 'beta'], swaps: 1,
          timeout: 17, outputDir: '/fixture/synthesis', signal: controller.signal,
          registry: { get: (id: string) => ({ id }) } as never,
          adapter: { dispatch } as never, onEvent: event => events.push(event) }))
          .rejects.toThrow('fixture phase cancellation');
        expect(dispatch).toHaveBeenCalledTimes(phase === 'draft' ? 1 : phase === 'swap' ? 3 : 4);
        expect(events).toHaveLength(eventsAtAbort);
        expect(warnings).not.toHaveBeenCalled();
      } finally {
        warnings.mockRestore();
        health.filter.mockReset();
      }
    });

  it('does not dispatch after cancellation during preflight', async () => {
    const controller = new AbortController();
    let finish!: (value: { healthy: string[]; skipped: never[] }) => void;
    health.filter.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const dispatch = vi.fn();
    const task = current({ prompt: 'Design', engines: ['alpha', 'beta'],
      timeout: 17, outputDir: '/fixture/synthesis', signal: controller.signal,
      registry: {} as never, adapter: { dispatch } as never });
    controller.abort(new Error('fixture preflight cancellation'));
    finish({ healthy: ['alpha', 'beta'], skipped: [] });
    await expect(task).rejects.toThrow('fixture preflight cancellation');
    expect(dispatch).not.toHaveBeenCalled();
    health.filter.mockReset();
  });

  it('retains the source oracle except its relocated import', () => {
    const text = readFileSync(new URL('../fixtures/modular-synthesis-legacy.ts', import.meta.url), 'utf8');
    const original = text.split('\n').slice(2).join('\n')
      .replace("from '../../packages/forge/src/health-check.js'", "from './health-check.js'");
    expect(createHash('sha256').update(original).digest('hex'))
      .toBe('a35b6003124d7c1dec142dc8790849debed9d03b29534ab44705ee7952772ad9');
  });

  it.each([
    { name: 'two-engine pairs', count: 2, rounds: 1 },
    { name: 'odd engine', count: 3, rounds: 1 },
    { name: 'multiple rounds', count: 3, rounds: 2 },
    { name: 'draft only', count: 3, rounds: 0 },
    { name: 'draft throw', count: 3, rounds: 1 },
    { name: 'swap throw', count: 3, rounds: 1 },
    { name: 'judge throw', count: 3, rounds: 1 },
    { name: 'empty draft', count: 3, rounds: 1 },
    { name: 'nonzero draft', count: 3, rounds: 1 },
    { name: 'timed-out draft', count: 3, rounds: 1 },
    { name: 'out-of-pool judge', count: 3, rounds: 1 },
    { name: 'quarantined engine', count: 3, rounds: 1 },
  ])('preserves raw requests, results, warnings and events: $name', async scenario => {
    const engines = ['alpha', 'beta', 'gamma'].slice(0, scenario.count);
    health.filter.mockImplementation(async ({ engineIds }: { engineIds: string[] }) => ({
      healthy: scenario.name === 'quarantined engine' ? engineIds.filter(id => id !== 'alpha') : engineIds,
      skipped: scenario.name === 'quarantined engine'
        ? [{ engineId: 'alpha', status: 'auth-failed', reason: 'fixture quarantine' }] : [],
    }));
    const makeAdapter = () => {
      const dispatch = vi.fn(async (request: Parameters<EngineAdapter['dispatch']>[0]) => {
        const phase = request.prompt.startsWith('## SYNTHESIS DRAFT') ? 'draft'
          : request.prompt.startsWith('## SYNTHESIS SWAP') ? 'swap' : 'judge';
        if (scenario.name === `${phase} throw`) throw new Error(`fixture ${phase} failure`);
        const stdout = phase === 'draft'
          ? scenario.name === 'empty draft' ? '' : `  ${request.engine.id} original  `
          : phase === 'swap' ? `${request.engine.id} improved\n## REASONING\nfixture improvement`
            : 'SCORE_1: 80\nSCORE_2: 60\nSCORE_3: 40\nWINNER: Entry 1\nREASONING: fixture judge';
        return { stdout, stderr: '', durationMs: 1,
          exitCode: phase === 'draft' && scenario.name === 'nonzero draft' ? 2 : 0,
          timedOut: phase === 'draft' && scenario.name === 'timed-out draft' };
      });
      return { dispatch, adapter: { dispatch } as unknown as EngineAdapter };
    };
    const before = makeAdapter(), after = makeAdapter();
    const registry = { get: (id: string) => ({ id }) } as Parameters<typeof frozen>[0]['registry'];
    const options = { prompt: 'Design a fixture', engines, registry, timeout: 17,
      outputDir: '/fixture/synthesis', swaps: scenario.rounds,
      judge: scenario.name === 'out-of-pool judge' ? 'missing' : undefined };
    const beforeEvents: unknown[] = [], afterEvents: unknown[] = [];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const expected = await frozen({ ...options, adapter: before.adapter, onEvent: event => beforeEvents.push(event) });
      const expectedWarnings = [...warnings.mock.calls];
      warnings.mockClear();
      const actual = await current({ ...options, adapter: after.adapter, onEvent: event => afterEvents.push(event) });
      expect(actual).toEqual(expected);
      expect(after.dispatch.mock.calls).toEqual(before.dispatch.mock.calls);
      expect(afterEvents).toEqual(beforeEvents);
      expect(warnings.mock.calls).toEqual(expectedWarnings);
      if (['two-engine pairs', 'odd engine', 'multiple rounds', 'draft only'].includes(scenario.name)) {
        expect(actual.swaps).toHaveLength(Math.floor(scenario.count / 2) * scenario.rounds);
        expect(after.dispatch).toHaveBeenCalledTimes(scenario.count + actual.swaps.length + 1);
        for (const [request] of after.dispatch.mock.calls) expect(request.textOnly).toBe(true);
      }
    } finally {
      warnings.mockRestore();
      random.mockRestore();
      health.filter.mockReset();
    }
  });
});
