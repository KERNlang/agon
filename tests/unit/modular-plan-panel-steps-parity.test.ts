import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tracker } from '@kernlang/agon-core';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

const backends = vi.hoisted(() => ({ brainstorm: vi.fn(), tribunal: vi.fn(), campfire: vi.fn(), delegate: vi.fn() }));
vi.mock('@kernlang/agon-forge', async original => ({ ...await original<Record<string, unknown>>(),
  runBrainstorm: backends.brainstorm, runTribunal: backends.tribunal, runCampfire: backends.campfire, runDelegate: backends.delegate,
}));
import { buildLegacyPanelStepExecutors } from '../fixtures/modular-plan-panel-steps-legacy.js';
import { buildStepExecutors } from '../../packages/cli/src/handlers/plan-mode.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-panel-parity-'));
  vi.stubEnv('AGON_HOME', home);
  vi.spyOn(Date, 'now').mockReturnValue(123456789);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
const cases = (['brainstorm', 'tribunal', 'campfire', 'delegate'] as const).flatMap(kind =>
  ['default', 'explicit', 'empty', 'active-throws', 'error', 'string-error', 'aborted'].map(scenario => ({ kind, scenario })));

it('keeps panel step algorithms out of the CLI host', () => {
  const source = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  expect(source).toContain('createPanelStepExecutors({');
  for (const kind of ['brainstorm', 'tribunal', 'campfire', 'delegate']) {
    expect(source).not.toMatch(new RegExp(`${kind}:\\s*wrap\\(`));
  }
  const physical = readFileSync(new URL('../../packages/mod-plan/src/panel-step-execution.ts', import.meta.url), 'utf8');
  expect(physical).not.toMatch(/from ['"](?:@kernlang\/agon-(?:core|cli|forge)|\.\.\/)/);
});

it.each(cases)('matches raw legacy %s', async ({ kind, scenario }) => {
  const observations = [];
  const controller = new AbortController();
  if (scenario === 'aborted') controller.abort(new Error('cancelled'));
  const ctx = { registry: {}, adapter: {}, activeEngines: () => {
    if (scenario === 'active-throws') throw new Error('no active session');
    return scenario === 'empty' ? [] : ['active', '', ' second '];
  } } as unknown as HandlerContext;
  const step: CesarPlanStep = { id: 'step', type: kind, description: 'task', imports: ['source', 'empty', 'absent'],
    tribunalMode: 'steelman', ...(scenario === 'explicit' ? { engine: 'selected', engines: ['explicit', ' '] } : {}),
    estimatedTokens: 10, estimatedCostUsd: 0.25 };
  for (const build of [buildLegacyPanelStepExecutors, buildStepExecutors]) {
    const stats = vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ totalTokens: 10, meteredCostUsd: 1, totalCostUsd: 90 } as ReturnType<typeof tracker.getStats>)
      .mockReturnValue({ totalTokens: 30, meteredCostUsd: 1.5, totalCostUsd: 150 } as ReturnType<typeof tracker.getStats>);
    for (const backend of Object.values(backends)) backend.mockReset();
    const backend = backends[kind];
    if (scenario === 'error' || scenario === 'string-error') backend.mockRejectedValue(scenario === 'error' ? new Error('failed') : 'failed');
    else backend.mockResolvedValue({ winner: 'winner', response: 'x'.repeat(650), summary: 'verdict', rounds: [{ engineId: 'one', content: 'c'.repeat(220) }, { engineId: 'two', content: 'short' }] });
    let outcome: unknown;
    try { outcome = await build(ctx)[kind].execute(step, { source: 'facts', empty: '' }, controller.signal); }
    catch (error) { outcome = { thrown: error instanceof Error ? error.message : String(error) }; }
    stats.mockRestore();
    if (scenario !== 'aborted') expect(backend.mock.calls[0][0].signal).toBe(controller.signal);
    observations.push({ outcome, calls: backend.mock.calls.slice() });
  }
  expect(observations[1]).toEqual(observations[0]);
});
