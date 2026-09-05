import { afterEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ records: [] as unknown[], quarantine: false, partial: false, dedupThrows: false }));
vi.mock('node:crypto', async original => ({ ...await original<object>(), randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(),
  getRatings: () => ({ byMode: { brainstorm: {} }, global: {} }),
  seedNewEnginesFromRegistry: () => { effects.records.push(['seed']); },
  classifyTask: () => 'code',
  updateGlickoRanked: (...args: unknown[]) => { effects.records.push(['ratings', ...args]); },
  createSidechainLogger: (options: unknown) => {
    effects.records.push(['logger', options]);
    return { log: (...args: unknown[]) => { effects.records.push(['log', ...args]); } };
  },
}));
vi.mock('../../packages/forge/src/health-check.js', () => ({
  preflightHealthFilter: async ({ engineIds }: { engineIds: string[] }) => ({
    healthy: effects.quarantine ? [] : effects.partial ? engineIds.slice(1) : engineIds,
    skipped: effects.quarantine || effects.partial ? (effects.quarantine ? engineIds : engineIds.slice(0, 1)).map(engineId => ({ engineId, status: 'quarantined', reason: 'fixture' })) : [],
  }),
}));
vi.mock('../../packages/forge/src/dedup-bridge.js', () => ({
  dedupBrainstormDrafts: async (drafts: unknown) => {
    effects.records.push(['dedup', drafts]);
    if (effects.dedupThrows) throw new Error('fixture dedup abort');
    return { groups: null, status: { status: 'unavailable', detail: 'fixture' } };
  },
}));

import { runBrainstorm } from '../../packages/forge/src/brainstorm.js';
import { runBrainstorm as legacy } from '../fixtures/modular-brainstorm-workflow-legacy.js';
afterEach(() => { vi.restoreAllMocks(); effects.quarantine = false; effects.partial = false; effects.dedupThrows = false; });

it.each(['divergent', 'grounded', 'empty-synthesis', 'failed-synthesis', 'throw-synthesis', 'no-drafts', 'quarantined', 'partial-panel', 'dedup-abort'])('preserves raw results and effect order: %s', async scenario => {
  vi.spyOn(Math, 'random').mockReturnValue(0.25);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  effects.quarantine = scenario === 'quarantined';
  effects.partial = scenario === 'partial-panel';
  effects.dedupThrows = scenario === 'dedup-abort';
  async function execute(run: typeof legacy) {
    effects.records = [];
    const calls: unknown[] = []; const events: unknown[] = [];
    const adapter = { dispatch: async (options: any) => {
      calls.push({ ...options, signal: undefined });
      const synthesis = options.prompt.includes('Multiple AI engines analyzed');
      if (synthesis && scenario === 'throw-synthesis') throw new Error('fixture synthesis exception');
      return { exitCode: synthesis && scenario === 'failed-synthesis' ? 1 : 0,
        stdout: scenario === 'no-drafts' || synthesis && scenario === 'empty-synthesis' ? '' : synthesis
          ? '<think>private</think>fixture synthesis'
          : '{"approach":"A sufficiently detailed fixture approach","confidence":75}',
        stderr: '', timedOut: false };
    } };
    try {
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
  if (scenario === 'quarantined') expect(expected.calls).toHaveLength(0);
  else if (scenario === 'no-drafts') expect(expected.error).toContain('no engine produced a usable draft');
  else if (scenario === 'dedup-abort') expect(expected.error).toContain('fixture dedup abort');
  else expect(expected.result?.synthesis?.status).toBe(scenario.includes('synthesis') ? 'fallback' : 'completed');
});
