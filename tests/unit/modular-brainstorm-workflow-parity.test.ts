import { afterEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ records: [] as unknown[], quarantine: false, partial: false, dedupThrows: false }));
vi.mock('node:crypto', async original => ({ ...await original<object>(), randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
vi.mock('../../packages/core/src/signals/glicko.js', () => ({
  getRatings: () => ({ byMode: { brainstorm: {} }, global: {} }),
  seedNewEnginesFromRegistry: () => { effects.records.push(['seed']); },
  updateGlickoRanked: (...args: unknown[]) => { effects.records.push(['ratings', ...args]); },
}));
vi.mock('../../packages/core/src/blocks/task-classifier.js', () => ({ classifyTask: () => 'code' }));
vi.mock('../../packages/core/src/blocks/sidechain-logger.js', () => ({
  createSidechainLogger: (options: unknown) => {
    effects.records.push(['logger', options]);
    return { log: (...args: unknown[]) => { effects.records.push(['log', ...args]); } };
  },
}));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(),
  ...await import('../../packages/core/src/signals/glicko.js'),
  ...await import('../../packages/core/src/blocks/task-classifier.js'),
  ...await import('../../packages/core/src/blocks/sidechain-logger.js'),
}));
vi.mock('@kernlang/agon-support-panel', async original => ({
  ...await original<object>(),
  preflightHealthFilter: async ({ engineIds }: { engineIds: string[] }) => ({
    healthy: effects.quarantine ? [] : effects.partial ? engineIds.slice(1) : engineIds,
    skipped: effects.quarantine || effects.partial ? (effects.quarantine ? engineIds : engineIds.slice(0, 1)).map(engineId => ({ engineId, status: 'quarantined', reason: 'fixture' })) : [],
  }),
}));
vi.mock('../../packages/forge/src/health-check.js', async () => ({
  preflightHealthFilter: (await import('@kernlang/agon-support-panel')).preflightHealthFilter,
}));
vi.mock('@kernlang/agon-support-dedup', () => ({
  dedupBrainstormDrafts: async (drafts: unknown) => {
    effects.records.push(['dedup', drafts]);
    if (effects.dedupThrows) throw new Error('fixture dedup abort');
    return { groups: null, status: { status: 'unavailable', detail: 'fixture' } };
  },
}));
vi.mock('../../packages/forge/src/dedup-bridge.js', async () => ({
  dedupBrainstormDrafts: (await import('@kernlang/agon-support-dedup')).dedupBrainstormDrafts,
}));

import { runBrainstorm, runScout } from '../../packages/forge/src/brainstorm.js';
import { runBrainstorm as legacy, runScout as legacyScout } from '../fixtures/modular-brainstorm-workflow-legacy.js';
import { runBrainstorm as generated } from '../../packages/mod-brainstorm/src/implementation.js';
import { createBrainstormHostServices } from '../../packages/core/src/blocks/brainstorm-host.js';
import type { BrainstormModServices } from '../../packages/mod-brainstorm/src/host.js';
afterEach(() => { vi.restoreAllMocks(); effects.quarantine = false; effects.partial = false; effects.dedupThrows = false; });

it.each(['divergent', 'grounded', 'empty-synthesis', 'failed-synthesis', 'throw-synthesis', 'no-drafts', 'quarantined', 'partial-panel', 'dedup-abort', 'retry-once'])('preserves raw results and effect order: %s', async scenario => {
  vi.spyOn(Math, 'random').mockReturnValue(0.25);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  effects.quarantine = scenario === 'quarantined';
  effects.partial = scenario === 'partial-panel';
  effects.dedupThrows = scenario === 'dedup-abort';
  async function execute(run: typeof legacy, useGenerated = false) {
    effects.records = [];
    const calls: unknown[] = []; const events: unknown[] = [];
    const attempts = new Map<string, number>();
    const adapter = { dispatch: async (options: any) => {
      calls.push({ ...options, signal: undefined });
      const synthesis = options.prompt.includes('Multiple AI engines analyzed');
      if (!synthesis) attempts.set(options.engine.id, (attempts.get(options.engine.id) ?? 0) + 1);
      if (synthesis && scenario === 'throw-synthesis') throw new Error('fixture synthesis exception');
      return { exitCode: synthesis && scenario === 'failed-synthesis' ? 1 : 0,
        stdout: scenario === 'no-drafts' || scenario === 'retry-once' && !synthesis && attempts.get(options.engine.id) === 1 || synthesis && scenario === 'empty-synthesis' ? '' : synthesis
          ? '<think>private</think>fixture synthesis'
          : '{"approach":"A sufficiently detailed fixture approach","confidence":75}',
        stderr: '', timedOut: false };
    } };
    try {
      if (useGenerated) {
        const context = { invocationId: 'fixture', cwd: process.cwd(), platform: 'darwin-arm64' as const,
          signal: new AbortController().signal, config: {} };
        const services = {
          brainstorm: createBrainstormHostServices(() => ({ get: (id: string) => ({ id }) }) as any, () => adapter as any),
          runs: { start: async () => ({ path: '/fixture', startedAt: 'fixture' }), finish: async () => {} },
          receipts: { record: async () => 'fixture' },
        } as unknown as BrainstormModServices;
        const response = await generated({ question: 'build fixture', engines: 'a,b', timeout: 1,
          style: scenario === 'grounded' ? 'grounded' : 'divergent' }, context, services);
        if (response.exitCode !== 0) throw new Error(response.stderr?.trim());
        return { result: response.result, calls, events, records: effects.records };
      }
      const result = await run({ question: 'build fixture', engines: ['a', 'b'], style: scenario === 'grounded' ? 'grounded' : undefined,
        registry: { get: (id: string) => ({ id }) } as any, adapter: adapter as any,
        timeout: 1, outputDir: '/fixture', onEvent: event => events.push(event) });
      return { result, calls, events, records: effects.records };
    } catch (error) {
      return { error: String(error), calls, events, records: effects.records };
    }
  }
  const expected = await execute(legacy);
  expect(await execute(runBrainstorm)).toEqual(expected);
  // UI callbacks are tested separately; raw results, dispatches and persisted
  // logger/rating/dedup effects must match without result normalization.
  const { events: _events, ...rawExpected } = expected;
  const { events: _generatedEvents, ...rawGenerated } = await execute(legacy, true);
  expect(rawGenerated).toEqual(rawExpected);
  if (scenario === 'retry-once') expect(expected.calls).toHaveLength(5);
  if (scenario === 'quarantined') expect(expected.calls).toHaveLength(0);
  else if (scenario === 'no-drafts') expect(expected.error).toContain('no engine produced a usable draft');
  else if (scenario === 'dedup-abort') expect(expected.error).toContain('fixture dedup abort');
  else expect(expected.result?.synthesis?.status).toBe(scenario.includes('synthesis') ? 'fallback' : 'completed');
});

it.each([
  { count: undefined, partial: false, empty: false },
  { count: 0, partial: false, empty: false },
  { count: 1, partial: false, empty: false },
  { count: 3, partial: false, empty: false },
  { count: 1, partial: true, empty: false },
  { count: 2, partial: false, empty: true },
])('preserves scout selection, timeout and raw bids: %j', async scenario => {
  effects.partial = scenario.partial;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  async function execute(run: typeof legacyScout) {
    const calls: unknown[] = [];
    const registry = { get: (id: string) => { calls.push(['lookup', id]); return { id }; } };
    const adapter = { dispatch: async (options: any) => {
      calls.push(['dispatch', options]);
      return { exitCode: 0, stdout: scenario.empty ? '' : '{"approach":"verify risk","confidence":85}', stderr: '', timedOut: false };
    } };
    const result = await run({ question: 'fixture', engines: ['a', 'b', 'c'], scoutCount: scenario.count,
      registry: registry as any, adapter: adapter as any, timeout: 120, outputDir: '/fixture' });
    return { result, calls };
  }
  const expected = await execute(legacyScout);
  expect(await execute(runScout)).toEqual(expected);
  if (scenario.partial) expect(expected.result.leadEngine).toBe('b');
  if (scenario.count === 0) expect(expected.calls).toHaveLength(0);
});
