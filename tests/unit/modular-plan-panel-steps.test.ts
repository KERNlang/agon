import { afterEach, expect, it, vi } from 'vitest';
import { createPanelStepExecutors, buildPlanStepContext, resolvePlanStepEngines } from '../../packages/mod-plan/src/panel-step-execution.js';
import type { PlanPanelStepHost, PlanPanelStepType } from '../../packages/mod-plan/src/panel-step-execution.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

const kinds = ['brainstorm', 'tribunal', 'campfire', 'delegate'] as const;
function fixture() {
  const host: PlanPanelStepHost = {
    outputDir: '/fixture', assertAvailable: vi.fn(), activeEngines: () => ['active'],
    snapshot: vi.fn().mockReturnValueOnce({ tokens: 10, cost: 1 }).mockReturnValue({ tokens: 17, cost: 1.25 }),
    brainstorm: vi.fn().mockResolvedValue({ winner: 'winner', response: 'answer' }),
    tribunal: vi.fn().mockResolvedValue({ summary: 'verdict' }),
    campfire: vi.fn().mockResolvedValue({ rounds: [{ engineId: 'speaker', content: 'x'.repeat(230) }] }),
    delegate: vi.fn().mockResolvedValue({ response: 'y'.repeat(550) }),
  };
  return host;
}
function step(type: PlanPanelStepType): CesarPlanStep {
  return { id: 'step', type, description: 'task', imports: ['empty', 'source', 'missing'], estimatedTokens: 0, estimatedCostUsd: 0 };
}
afterEach(() => { vi.restoreAllMocks(); });

it.each(['brainstorm', 'tribunal', 'campfire'] as const)('preserves the active engine method receiver for %s', async kind => {
  const host = Object.assign(fixture(), { selected: ['session-engine'] });
  host.activeEngines = function() { return this === host ? host.selected : []; };
  await createPanelStepExecutors(host)[kind].execute(step(kind), {});
  expect(host[kind]).toHaveBeenCalledWith(expect.objectContaining({ engines: ['session-engine'] }));
});

it.each(kinds)('refuses pre-aborted %s before host or backend effects', async kind => {
  const host = fixture();
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(createPanelStepExecutors(host)[kind].execute(step(kind), {}, controller.signal)).rejects.toThrow('cancelled');
  expect(host.assertAvailable).not.toHaveBeenCalled();
  expect(host.snapshot).not.toHaveBeenCalled();
  for (const key of kinds) expect(host[key]).not.toHaveBeenCalled();
});

it.each(kinds)('refuses stale %s completion and preserves measured usage', async kind => {
  for (const fault of ['disabled', 'cancelled']) {
    const host = fixture();
    const controller = new AbortController();
    let available = true;
    host.assertAvailable = vi.fn(() => { if (!available) throw new Error('disabled'); });
    const revoke = () => { if (fault === 'disabled') available = false; else controller.abort(new Error('cancelled')); };
    host.brainstorm = vi.fn(async () => { revoke(); return { winner: 'winner', response: 'answer' }; });
    host.tribunal = vi.fn(async () => { revoke(); return { summary: 'answer' }; });
    host.campfire = vi.fn(async () => { revoke(); return { rounds: [] }; });
    host.delegate = vi.fn(async () => { revoke(); return { response: 'answer' }; });
    const output = await createPanelStepExecutors(host)[kind].execute(step(kind), {}, controller.signal);
    expect(output.result).toMatchObject({ status: 'failure', actualTokens: 7, actualCostUsd: 0.25, error: fault });
    expect(output).not.toHaveProperty('contextExport');
  }
});

it.each(kinds)('owns %s arguments, measured costs, output, and exports', async kind => {
  const host = fixture();
  vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValue(140);
  const signal = new AbortController().signal;
  const result = await createPanelStepExecutors(host)[kind].execute(step(kind), { empty: '', source: 'facts' }, signal);
  expect(vi.mocked(host[kind]).mock.calls[0][0].signal).toBe(signal);
  expect(vi.mocked(host.assertAvailable).mock.calls).toEqual([[kind, signal], [kind, signal]]);
  expect(host[kind]).toHaveBeenCalledExactlyOnceWith({
    [kind === 'campfire' ? 'topic' : kind === 'delegate' ? 'task' : 'question']: 'task\n\n## source\nfacts',
    ...(kind === 'delegate' ? { engineId: 'claude' } : { engines: ['active'] }),
    ...(kind === 'tribunal' ? { rounds: 2, mode: undefined } : {}),
    ...(kind === 'campfire' ? { strategy: 'all-respond' } : {}),
    timeout: 120, outputDir: '/fixture/step', signal,
  });
  const outputs = { brainstorm: 'Winner: winner\nanswer', tribunal: 'verdict', campfire: `speaker: ${'x'.repeat(200)}`, delegate: 'y'.repeat(550) };
  const exports = { brainstorm: 'answer', tribunal: 'verdict', campfire: outputs.campfire, delegate: 'y'.repeat(500) };
  expect(result).toEqual({ result: { status: 'success', actualTokens: 7, actualCostUsd: 0.25, durationMs: 40, output: outputs[kind] }, contextExport: exports[kind] });
});

it.each(kinds)('refuses disabled %s before any backend or meter effect', async kind => {
  const host = fixture();
  host.assertAvailable = vi.fn(() => { throw new Error('unavailable'); });
  await expect(createPanelStepExecutors(host)[kind].execute(step(kind), {})).rejects.toThrow('unavailable');
  expect(host.snapshot).not.toHaveBeenCalled();
  for (const key of kinds) expect(host[key]).not.toHaveBeenCalled();
});

it.each(kinds)('reports %s failure with measured usage and no context export', async kind => {
  const host = fixture();
  vi.mocked(host[kind]).mockRejectedValue('backend failed');
  vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValue(140);
  await expect(createPanelStepExecutors(host)[kind].execute(step(kind), {})).resolves.toEqual({
    result: { status: 'failure', actualTokens: 7, actualCostUsd: 0.25, durationMs: 40, output: '', error: 'backend failed' },
  });
});

it('preserves import order, missing-value handling, and explicit engine precedence', () => {
  const value = { ...step('tribunal'), engines: [' explicit ', '', '  '] };
  const active = vi.fn(() => ['other']);
  expect(buildPlanStepContext(value, { source: 'data' })).toBe('task\n\n## source\ndata');
  expect(resolvePlanStepEngines(value, active)).toEqual([' explicit ']);
  expect(active).not.toHaveBeenCalled();
  expect(resolvePlanStepEngines(step('tribunal'), () => [' ', 'active'])).toEqual(['active']);
  expect(resolvePlanStepEngines(step('tribunal'), () => { throw new Error('no session'); })).toBeUndefined();
});
