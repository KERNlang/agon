import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as physical from '../../packages/mod-plan/src/index.js';
import * as frozen from '../fixtures/modular-plan-state-legacy.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('Plan owns the state transitions; core retains only exports and persistence', () => {
  for (const name of ['createCesarPlan', 'approveCesarPlan', 'advanceCesarStep', 'cancelCesarPlan', 'exitCesarPlan']) {
    expect(physical).toHaveProperty(name);
    const core = readFileSync(new URL('../../packages/core/src/cesar/plan.ts', import.meta.url), 'utf8');
    expect(core).not.toContain(`function ${name}(`);
  }
});

it.each(['success', 'failure', 'paused'] as const)('preserves full state payloads through %s, cancellation and exit', status => {
  expect(physical).toHaveProperty('createCesarPlan');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0.25);
  function replay(api: typeof frozen) {
    const initial = api.createCesarPlan('fixture', [
      { id: 'a', type: 'self', description: 'first', estimatedTokens: 2, estimatedCostUsd: 0.2 },
      { id: 'b', type: 'self', description: 'dependent', dependsOn: ['a'], estimatedTokens: 3, estimatedCostUsd: 0.3 },
    ]);
    const approved = api.approveCesarPlan({ ...initial, state: 'awaiting_approval' });
    const first = api.advanceCesarStep(approved, 'a', { status, actualTokens: 4, actualCostUsd: 0.4, durationMs: 5, output: 'raw first', error: status === 'success' ? undefined : 'fixture' });
    const second = api.advanceCesarStep(first, 'b', { status: 'success', actualTokens: 6, actualCostUsd: 0.6, durationMs: 7, output: 'raw second' });
    return { initial, approved, first, second, unknown: api.advanceCesarStep(first, 'missing', { status, actualTokens: 0, actualCostUsd: 0, durationMs: 0, output: '' }), cancelled: api.cancelCesarPlan(first), exited: api.exitCesarPlan(first, '  operator stop  '), emptyExit: api.exitCesarPlan(first, '') };
  }
  expect(replay(physical as unknown as typeof frozen)).toEqual(replay(frozen));
});
