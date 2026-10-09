import { describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as physical from '@kernlang/agon-mod-plan';
import type { CesarPlan } from '../../packages/mod-plan/src/execution-model.js';

function plan(type: 'self' | 'forge' | 'brainstorm' = 'self'): CesarPlan {
  return { id: 'fixture', intent: 'retain this intent', state: 'done',
    steps: [{ id: 's1', type, description: 'step', state: 'done', estimatedTokens: 10, estimatedCostUsd: 1 }],
    stepContext: { retained: 'context' }, createdAt: '2026-01-01T00:00:00Z',
    totalEstimatedTokens: 10, totalEstimatedCostUsd: 1, totalActualTokens: 8, totalActualCostUsd: 0.5 };
}

function fixture(changed: string[] = ['file.txt']) {
  const callbacks = { onStepStart: vi.fn(), onStepDone: vi.fn(), onPlanUpdate: vi.fn(),
    onBudgetWarning: vi.fn(), flush: vi.fn() };
  const host = { createExecutors: vi.fn(() => ({})),
    executePlan: vi.fn(async (value: CesarPlan) => ({ ...value, state: 'done' as const })),
    callbacks: vi.fn(() => callbacks), setActivePlan: vi.fn(), setAbort: vi.fn(), releaseAbort: vi.fn(),
    save: vi.fn(), writeMarkdown: vi.fn(), hasWorkingTreeChanges: vi.fn(() => changed.length > 0),
    estimateReview: vi.fn(() => ({ tokens: 20, costUsd: 0.25 })),
    takeFallback: vi.fn(() => undefined), notify: vi.fn(), warn: vi.fn() };
  expect(physical).toHaveProperty('createPlanCoordinator');
  return { host, callbacks, coordinator: physical.createPlanCoordinator(host) };
}

describe('physical Plan execution coordinator', () => {
  it('does not demote verified work when terminal cost formatting fails', async () => {
    const { coordinator, host } = fixture([]);
    const value = { ...plan(), selfReview: false, totalActualCostUsd: null } as unknown as CesarPlan;
    await coordinator.executeApprovedPlan(value);
    expect(host.save.mock.calls.at(-1)![0].state).toBe('done');
    expect(host.notify.mock.calls.some(([level]) => level === 'error')).toBe(false);
    expect(host.warn).toHaveBeenCalledWith('[plan] failed to report completion message:', expect.any(TypeError));
  });
  it('reuses a successful gate after a save failure when resume executes no new mutation', async () => {
    const { coordinator, host } = fixture();
    let reviewCalls = 0;
    let failSave = true;
    const execute = async (step: { type: string }) => {
      if (step.type === 'review') reviewCalls++;
      return { result: { status: 'success' as const, output: 'done', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } };
    };
    host.createExecutors.mockReturnValue({ self: { execute }, review: { execute } });
    host.executePlan.mockImplementation(physical.createPlanExecutor({ recordStepCompletion: vi.fn() }));
    host.save.mockImplementation(snapshot => {
      if (failSave && snapshot.state === 'done' && snapshot.reviewCyclesUsed === 1) {
        failSave = false;
        throw new Error('save failed');
      }
    });
    const value = { ...plan(), state: 'running' as const };
    value.steps[0].state = 'pending';
    await coordinator.executeApprovedPlan(value);
    const paused = host.save.mock.calls.at(-1)![0];
    expect(paused.state).toBe('paused');
    await coordinator.executeApprovedPlan(physical.prepareCesarPlanResume(paused, 'resume'));
    expect(reviewCalls).toBe(1);
    expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', reviewCyclesUsed: 1 });
  });
  it('retains a satisfied review through real storage and a new coordinator', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plan-review-roundtrip-'));
    const previous = process.env.AGON_HOME;
    process.env.AGON_HOME = root;
    try {
      const value = { ...plan(), state: 'paused' as const, reviewCyclesUsed: 1 };
      value.steps[0].result = { status: 'success', output: 'changed', actualTokens: 1, actualCostUsd: 1, durationMs: 1 };
      value.steps.push({ id: 'review-1', type: 'review', description: 'verified', state: 'done',
        estimatedTokens: 1, estimatedCostUsd: 1, selfReviewCycle: 1,
        result: { status: 'success', output: 'checked', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } });
      expect(physical.cesarPlanJsonPath(value.id)).toBe(join(root, 'plans', 'fixture.json'));
      physical.saveCesarPlan(value);
      const loaded = physical.loadCesarPlan(value.id)!;
      expect(loaded.steps[1].selfReviewCycle).toBe(1);
      const { coordinator, host } = fixture();
      host.save.mockImplementation(physical.saveCesarPlan);
      host.executePlan.mockImplementation(physical.createPlanExecutor({ recordStepCompletion: vi.fn() }));
      await coordinator.executeApprovedPlan(physical.prepareCesarPlanResume(loaded, 'resume'));
      expect(physical.loadCesarPlan(value.id)).toMatchObject({ state: 'done', reviewCyclesUsed: 1 });
      expect(host.estimateReview).not.toHaveBeenCalled();
      expect(host.hasWorkingTreeChanges).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.AGON_HOME;
      else process.env.AGON_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('does not reuse an old successful gate after a mutation runs again', async () => {
    const { coordinator, host } = fixture();
    const value = { ...plan(), state: 'running' as const, reviewCyclesUsed: 1 };
    value.steps[0].state = 'pending';
    value.steps.push({ id: 'review-old', type: 'review', description: 'old gate', estimatedTokens: 1, estimatedCostUsd: 1,
      state: 'skipped', selfReviewCycle: 1, result: { status: 'success', output: 'old', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } });
    const execute = vi.fn(async () => ({ result: { status: 'success' as const, output: 'new', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } }));
    host.createExecutors.mockReturnValue({ self: { execute }, review: { execute } });
    host.executePlan.mockImplementation(physical.createPlanExecutor({ recordStepCompletion: vi.fn() }));
    await coordinator.executeApprovedPlan(value);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', reviewCyclesUsed: 2 });
  });
  it('does not store completion before a required verification probe finishes', async () => {
    const { coordinator, host, callbacks } = fixture();
    const seen: string[] = [];
    callbacks.onPlanUpdate.mockImplementation(snapshot => { seen.push(snapshot.state); });
    host.executePlan.mockImplementationOnce(async (value, _executors, observed) => {
      const done = { ...value, state: 'done' as const };
      observed.onPlanUpdate(done);
      return done;
    });
    let stateAtProbe: string | undefined;
    host.hasWorkingTreeChanges.mockImplementationOnce(() => {
      stateAtProbe = host.save.mock.calls.at(-1)?.[0].state;
      throw new Error('probe failed');
    });
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(stateAtProbe).toBe('paused');
    expect(seen).not.toContain('done');
    expect(host.save.mock.calls.some(([snapshot]) => snapshot.state === 'done')).toBe(false);
  });
  it('does not append another review after the current gate succeeds on resume', async () => {
    const { coordinator, host } = fixture();
    let reviewCalls = 0;
    const execute = async (step: { type: string }) => ({ result: {
      status: step.type === 'review' && ++reviewCalls === 1 ? 'failure' as const : 'success' as const,
      output: 'result', actualTokens: 1, actualCostUsd: 1, durationMs: 1,
    } });
    host.createExecutors.mockReturnValue({ self: { execute }, review: { execute } });
    host.executePlan.mockImplementation(physical.createPlanExecutor({ recordStepCompletion: vi.fn() }));
    const value = { ...plan(), state: 'running' as const };
    value.steps[0].state = 'pending';
    await coordinator.executeApprovedPlan(value);
    const paused = host.save.mock.calls.at(-1)![0];
    expect(paused).toMatchObject({ state: 'paused', reviewCyclesUsed: 1 });
    await coordinator.executeApprovedPlan(physical.prepareCesarPlanResume(paused, 'resume'));
    expect(reviewCalls).toBe(2);
    expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', reviewCyclesUsed: 1 });
  });
  it('counts retained successful skipped steps when describing a later resume', () => {
    const value = plan();
    value.steps[0] = { ...value.steps[0], state: 'skipped', result: {
      status: 'success', output: '', actualTokens: 0, actualCostUsd: 0, durationMs: 0 } };
    expect(physical.buildResumePromptContext(value)).toMatchObject({ doneCount: 1, remainingCount: 0 });
  });
  it('resumes a failed review probe without rerunning completed mutations or skipping review', async () => {
    const { coordinator, host } = fixture();
    const executed: string[] = [];
    const execute = async (step: { id: string }) => {
      executed.push(step.id);
      return { result: { status: 'success' as const, output: 'done', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } };
    };
    host.createExecutors.mockReturnValue({ self: { execute }, review: { execute } });
    host.executePlan.mockImplementation(physical.createPlanExecutor({ recordStepCompletion: vi.fn() }));
    host.hasWorkingTreeChanges.mockImplementationOnce(() => { throw new Error('git unavailable'); });
    const value = { ...plan(), state: 'running' as const };
    value.steps[0].state = 'pending';
    await coordinator.executeApprovedPlan(value);
    const paused = host.save.mock.calls.at(-1)![0];
    expect(paused.state).toBe('paused');
    expect(host.notify.mock.calls.some(([level]) => level === 'success')).toBe(false);
    await coordinator.executeApprovedPlan(physical.prepareCesarPlanResume(paused, 'resume'));
    expect(executed).toEqual(['s1', expect.stringMatching(/^review-/)]);
    expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', reviewCyclesUsed: 1 });
  });
  it('does not let a host replace Plan transitions or discard completed exports', async () => {
    const { coordinator, host } = fixture([]);
    const value = { ...plan(), state: 'running' as const, selfReview: false };
    value.steps = ['a', 'b'].map(id => ({ ...value.steps[0], id, state: 'pending', parallel: true, exports: [id] }));
    host.createExecutors.mockReturnValue({ self: { execute: async step => ({ result: {
      status: 'success', output: step.id, actualTokens: 1, actualCostUsd: 1, durationMs: 1 }, contextExport: `export-${step.id}` }) } });
    const foreignAdvance = vi.fn(() => { throw new Error('foreign transition must not run'); });
    host.executePlan.mockImplementation(physical.createPlanExecutor({ advance: foreignAdvance,
      recordStepCompletion: vi.fn() } as any));
    await coordinator.executeApprovedPlan(value);
    expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', stepContext: { a: 'export-a', b: 'export-b' },
      steps: [{ id: 'a', state: 'done' }, { id: 'b', state: 'done' }] });
    expect(foreignAdvance).not.toHaveBeenCalled();
  });
  it.each([false, true])('retains exported context when estimation history fails (parallel=%s)', async parallel => {
    const { coordinator, host } = fixture([]);
    const value = { ...plan(), state: 'running' as const, selfReview: false };
    value.steps = ['a', 'b'].map(id => ({ ...value.steps[0], id, state: 'pending', parallel,
      ...(id === 'a' ? { exports: ['spec'] } : { imports: ['spec'] }) }));
    const onEstimationError = vi.fn();
    const inputs = new Map<string, Record<string, string | undefined>>();
    host.createExecutors.mockReturnValue({ self: { execute: async (step, context) => {
      inputs.set(step.id, { ...context });
      return { result: {
      status: 'success', output: step.id, actualTokens: 1, actualCostUsd: 1, durationMs: 1 },
      ...(step.id === 'a' ? { contextExport: 'retained specification' } : {}) }; } } });
    host.executePlan.mockImplementation(physical.createPlanExecutor({
      recordStepCompletion: () => { throw new Error('history unavailable'); }, onEstimationError }));
    await coordinator.executeApprovedPlan(value);
    expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', stepContext: { spec: 'retained specification' },
      steps: [{ id: 'a', state: 'done' }, { id: 'b', state: 'done' }] });
    expect(onEstimationError).toHaveBeenCalledTimes(2);
    if (!parallel) expect(inputs.get('b')?.spec).toBe('retained specification');
  });
  it.each(['paused', 'cancelled'] as const)('does not probe review effects for an already %s plan', async state => {
    const { coordinator, host } = fixture([]);
    host.hasWorkingTreeChanges.mockImplementation(() => { throw new Error('git unavailable'); });
    const value = { ...plan(), state };
    expect(await coordinator.finalizePlanWithReviewGate(value, {}, new AbortController().signal)).toBe(value);
    expect(host.hasWorkingTreeChanges).not.toHaveBeenCalled();
  });
  it.each(['read-only', 'review disabled', 'review exhausted'])('does not require Git when %s and no Forge result needs inspection', async reason => {
    const { coordinator, host } = fixture([]);
    host.hasWorkingTreeChanges.mockImplementation(() => { throw new Error('git unavailable'); });
    const value = plan(reason === 'read-only' ? 'brainstorm' : 'self');
    if (reason === 'review disabled') value.selfReview = false;
    if (reason === 'review exhausted') value.reviewCyclesUsed = 2;
    expect(await coordinator.finalizePlanWithReviewGate(value, {}, new AbortController().signal)).toBe(value);
    expect(host.hasWorkingTreeChanges).not.toHaveBeenCalled();
  });
  it.each(['onPlanUpdate', 'onStepStart', 'onStepDone', 'onBudgetWarning'] as const)(
    'keeps real parallel execution correct when the %s view callback throws', async hook => {
      const { coordinator, host, callbacks } = fixture([]);
      const value = { ...plan(), state: 'running' as const, selfReview: false, totalEstimatedCostUsd: 0.01 };
      value.steps = ['a', 'b'].map(id => ({ ...value.steps[0], id, state: 'pending', parallel: true }));
      const execute = vi.fn(async () => ({ result: { status: 'success' as const, output: 'written',
        actualTokens: 5, actualCostUsd: 1, durationMs: 1 } }));
      host.createExecutors.mockReturnValue({ self: { execute } });
      host.executePlan.mockImplementation(physical.createPlanExecutor({ recordStepCompletion: vi.fn() }));
      callbacks[hook].mockImplementation(() => { throw new Error('view failed'); });
      await coordinator.executeApprovedPlan(value);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'done', totalActualCostUsd: 2.5,
        steps: [{ id: 'a', state: 'done' }, { id: 'b', state: 'done' }] });
      expect(callbacks[hook]).toHaveBeenCalled();
      expect(host.warn).toHaveBeenCalled();
    });
  it.each(['notify', 'publish'])('retains completed work when %s fails', async fault => {
    const { coordinator, host } = fixture([]);
    if (fault === 'notify') host.notify.mockImplementation(() => { throw new Error('notification failed'); });
    else host.setActivePlan.mockImplementation(() => { throw new Error('publication failed'); });
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(host.save.mock.calls.at(-1)![0].state).toBe('done');
    expect(host.warn).toHaveBeenCalledWith(fault === 'notify'
      ? '[plan] failed to report execution status:' : '[plan] failed to publish execution state:', expect.any(Error));
  });
  it('preserves completed progress if reporting an executor fault also fails', async () => {
    const { coordinator, host } = fixture([]);
    const value = { ...plan(), state: 'running' as const };
    value.steps = [{ ...value.steps[0], state: 'pending' }, { ...value.steps[0], id: 's2', state: 'pending' }];
    host.executePlan.mockImplementationOnce(async (_value, _executors, observed) => {
      observed.onStepDone('s1', { status: 'success', output: 'done', actualTokens: 1, actualCostUsd: 1, durationMs: 1 });
      throw new Error('executor failed');
    });
    host.notify.mockImplementation((level) => { if (level === 'error') throw new Error('UI failed'); });
    await coordinator.executeApprovedPlan(value);
    expect(host.save.mock.calls.at(-1)![0].steps[0]).toMatchObject({ state: 'done', result: { output: 'done' } });
  });
  it('normalizes a returned cancellation even without a terminal callback', async () => {
    const { coordinator, host, callbacks } = fixture([]);
    host.executePlan.mockImplementationOnce(async value => ({ ...value, state: 'cancelled',
      steps: value.steps.map(step => ({ ...step, state: 'running' })) }));
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    const saved = host.save.mock.calls.at(-1)![0];
    expect(saved).toMatchObject({ state: 'cancelled', steps: [{ state: 'cancelled' }] });
    expect(callbacks.onPlanUpdate).toHaveBeenCalledWith(saved);
  });
  it('attributes fallback failure to the newly reset step, not an earlier retry', async () => {
    const { coordinator, host } = fixture([]);
    const value = { ...plan(), state: 'running' as const, fallbackRetriesUsed: { s1: 1 } };
    value.steps = [{ ...value.steps[0], state: 'pending' }, { ...value.steps[0], id: 's2', state: 'failed', engine: 'old',
      result: { status: 'failure', error: 'timeout', output: '', actualTokens: 0, actualCostUsd: 0, durationMs: 0 } }];
    host.executePlan.mockImplementationOnce(async current => ({ ...current, state: 'paused' }))
      .mockRejectedValueOnce(new Error('retry startup failed'));
    host.takeFallback.mockReturnValueOnce({ engine: 'new', stepId: 's2' });
    await coordinator.executeApprovedPlan(value);
    expect(host.save.mock.calls.at(-1)![0].steps).toMatchObject([
      { id: 's1', state: 'pending' }, { id: 's2', state: 'failed', result: { error: 'retry startup failed' } },
    ]);
  });
  it('pauses a directly invoked review gate when callback setup fails', async () => {
    const { coordinator, host } = fixture();
    host.callbacks.mockImplementationOnce(() => { throw new Error('setup failed'); });
    await expect(coordinator.finalizePlanWithReviewGate(plan(), {}, new AbortController().signal)).rejects.toThrow('setup failed');
    expect(host.save).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'paused', reviewCyclesUsed: 1 }));
  });
  it('reports a scheduler pre-marked running step exactly once', async () => {
    const { coordinator, host, callbacks } = fixture([]);
    host.executePlan.mockImplementationOnce(async (value, _executors, observed) => {
      observed.onPlanUpdate({ ...value, steps: [{ ...value.steps[0], state: 'running' }] });
      observed.onStepStart('s1');
      observed.onStepStart('s1');
      return { ...value, state: 'done' };
    });
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(callbacks.onStepStart.mock.calls).toEqual([['s1']]);
  });
  it.each(['executors', 'registration', 'callbacks'])('persists a paused snapshot when %s setup fails', async fault => {
    const { coordinator, host } = fixture([]);
    const fail = () => { throw new Error('setup failed'); };
    if (fault === 'executors') host.createExecutors.mockImplementationOnce(fail);
    if (fault === 'registration') host.setAbort.mockImplementationOnce(fail);
    if (fault === 'callbacks') host.callbacks.mockImplementationOnce(fail);
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(host.save).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'paused' }));
    expect(host.setActivePlan).toHaveBeenLastCalledWith(host.save.mock.calls.at(-1)![0]);
    expect(host.executePlan).not.toHaveBeenCalled();
  });
  it('publishes returned snapshots only after required persistence succeeds', async () => {
    const { coordinator, host } = fixture([]);
    host.save.mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error('disk unavailable'); });
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(host.setActivePlan).toHaveBeenCalledTimes(1);
    expect(host.setActivePlan).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' }));
    expect(host.notify.mock.calls.some(([level]) => level === 'success')).toBe(false);
    expect(host.warn).toHaveBeenCalledWith('[plan] failed to persist recovery snapshot:', expect.any(Error));
  });
  it('retains the added review when review callback setup fails', async () => {
    const { coordinator, host, callbacks } = fixture();
    host.callbacks.mockReturnValueOnce(callbacks).mockImplementationOnce(() => { throw new Error('review UI failed'); });
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(host.save).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'paused', reviewCyclesUsed: 1,
      steps: [expect.objectContaining({ id: 's1' }), expect.objectContaining({ type: 'review' })] }));
    expect(host.executePlan).toHaveBeenCalledOnce();
  });
  it('attributes an early fallback exception and releases both controllers in reverse order', async () => {
    const { coordinator, host } = fixture([]);
    const value = { ...plan(), state: 'running' as const };
    value.steps[0].state = 'pending';
    value.steps[0].engine = 'original';
    host.executePlan.mockImplementationOnce(async (_value, _executors, observed) => {
      observed.onStepStart('s1');
      throw new Error('timeout');
    }).mockRejectedValueOnce(new Error('fallback setup failed'));
    host.takeFallback.mockImplementationOnce(signal => {
      expect(signal.aborted).toBe(false);
      return { engine: 'replacement', stepId: 's1' };
    });
    await coordinator.executeApprovedPlan(value);
    expect(host.executePlan).toHaveBeenCalledTimes(2);
    expect(host.save).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'paused',
      fallbackRetriesUsed: { s1: 1 }, steps: [expect.objectContaining({ engine: 'replacement', state: 'failed',
        result: expect.objectContaining({ error: 'fallback setup failed' }) })] }));
    expect(host.releaseAbort).toHaveBeenCalledTimes(2);
    expect(host.releaseAbort.mock.calls[0][0]).toBe(host.setAbort.mock.calls[1][0]);
    expect(host.releaseAbort.mock.calls[1][0]).toBe(host.setAbort.mock.calls[0][0]);
  });
  it('does not resurrect cancellation when the executor returns a stale success', async () => {
    const { coordinator, host } = fixture([]);
    host.executePlan.mockImplementationOnce(async (value, _executors, callbacks) => {
      callbacks.onStepStart('s1');
      callbacks.onPlanUpdate({ ...value, state: 'cancelled' });
      return { ...value, state: 'done' };
    });
    const value = { ...plan(), state: 'running' as const };
    value.steps[0].state = 'pending';
    await coordinator.executeApprovedPlan(value);
    expect(host.save).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'cancelled',
      steps: [expect.objectContaining({ state: 'cancelled' })] }));
    expect(host.notify.mock.calls.some(([level]) => level === 'success')).toBe(false);
  });
  it('reports a post-completion exception as a warning without claiming execution failed', async () => {
    const { coordinator, host } = fixture([]);
    host.executePlan.mockImplementationOnce(async (value, _executors, callbacks) => {
      callbacks.onPlanUpdate({ ...value, state: 'done' });
      throw new Error('late transport cleanup');
    });
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(host.save.mock.calls.at(-1)![0].state).toBe('done');
    expect(host.notify.mock.calls.some(([level]) => level === 'error')).toBe(false);
    expect(host.notify).toHaveBeenCalledWith('warning', expect.stringContaining('late transport cleanup'));
  });
  it('ignores duplicate starts and starts of completed steps', async () => {
    const { coordinator, host, callbacks } = fixture([]);
    const value = { ...plan(), state: 'running' as const };
    value.steps.push({ ...value.steps[0], id: 's2', state: 'pending' });
    host.executePlan.mockImplementationOnce(async (_value, _executors, observed) => {
      observed.onStepStart('s1');
      observed.onStepStart('s2');
      observed.onStepStart('s2');
      throw new Error('interrupted');
    });
    await coordinator.executeApprovedPlan(value);
    expect(callbacks.onStepStart.mock.calls).toEqual([['s2']]);
    expect(host.save.mock.calls.at(-1)![0].steps[0].state).toBe('done');
  });
  it('uses distinct review IDs when two cycles begin within the same millisecond', async () => {
    const { coordinator } = fixture();
    const now = vi.spyOn(Date, 'now').mockReturnValue(12345);
    try {
      const first = await coordinator.finalizePlanWithReviewGate(plan(), {}, new AbortController().signal);
      const second = await coordinator.finalizePlanWithReviewGate(first, {}, new AbortController().signal);
      expect(new Set(second.steps.map(step => step.id)).size).toBe(second.steps.length);
    } finally { now.mockRestore(); }
  });
  it.each([NaN, Infinity, -1, 0.5])('refuses a malformed fallback retry budget: %s', used => {
    const value = plan();
    value.state = 'paused';
    value.fallbackRetriesUsed = { s1: used };
    value.steps[0] = { ...value.steps[0], state: 'failed', engine: 'original',
      result: { status: 'failure', error: 'timeout', output: '', actualTokens: 0, actualCostUsd: 0, durationMs: 0 } };
    expect(physical.preparePlanFallbackRetry(value, 'fallback', 's1')).toBeNull();
  });
  it('does not retry the same engine when singular and plural engine fields overlap', () => {
    const value = plan();
    value.state = 'paused';
    value.steps[0] = { ...value.steps[0], state: 'failed', engine: 'fixture', engines: ['fixture'],
      result: { status: 'failure', error: 'timeout', output: '', actualTokens: 0, actualCostUsd: 0, durationMs: 0 } };
    expect(physical.preparePlanFallbackRetry(value, 'fixture')).toBeNull();
  });
  it('owns fallback policies instead of importing the CLI owner', async () => {
    const legacy = await import('../../packages/cli/src/signals/dispatch/plan-execution.js');
    expect(physical).toHaveProperty('preparePlanFallbackRetry', legacy.preparePlanFallbackRetry);
    expect(physical).toHaveProperty('failedPlanStepIsFallbackRetryable', legacy.failedPlanStepIsFallbackRetryable);
    const legacySource = readFileSync(new URL('../../packages/cli/src/signals/dispatch/plan-execution.ts', import.meta.url), 'utf8');
    expect(legacySource).not.toMatch(/function preparePlanFallbackRetry|function failedPlanStepIsFallbackRetryable|const MUTATING\s*=|await executePlan\(/);
  });
  it.each(['disabled', 'budget', 'read-only', 'paused', 'clean'])('does not append review when %s', async reason => {
    const { coordinator, host } = fixture(reason === 'clean' ? [] : ['file.txt']);
    const value = plan(reason === 'read-only' ? 'brainstorm' : 'self');
    if (reason === 'disabled') value.selfReview = false;
    if (reason === 'budget') value.reviewCyclesUsed = 2;
    if (reason === 'paused') value.state = 'paused';
    expect(await coordinator.finalizePlanWithReviewGate(value, {}, new AbortController().signal)).toBe(value);
    expect(host.executePlan).not.toHaveBeenCalled();
  });
  it('pauses an unapplied Forge winner instead of claiming completion', async () => {
    const { coordinator, host } = fixture([]);
    const value = plan('forge');
    const result = await coordinator.finalizePlanWithReviewGate(value, {}, new AbortController().signal);
    expect(result).toEqual({ ...value, state: 'paused' });
    expect(host.save).toHaveBeenCalledWith(result);
    expect(host.executePlan).not.toHaveBeenCalled();
  });
  it('clears completion metadata when an unapplied Forge plan becomes paused', async () => {
    const { coordinator } = fixture([]);
    const value = { ...plan('forge'), completedAt: '2026-01-01T00:01:00Z' };
    expect((await coordinator.finalizePlanWithReviewGate(value, {}, new AbortController().signal)).completedAt).toBeUndefined();
  });
  it('does not describe an interrupted second review as proven blocking findings', async () => {
    const { coordinator, host } = fixture();
    host.executePlan.mockImplementationOnce(async value => ({ ...value, state: 'paused' }));
    const value = { ...plan(), reviewCyclesUsed: 1 };
    const result = await coordinator.finalizePlanWithReviewGate(value, {}, new AbortController().signal);
    expect(result.reviewCyclesUsed).toBe(2);
    expect(host.notify.mock.calls.some(([, message]) => message.includes('still found blocking issues'))).toBe(false);
    expect(host.notify).toHaveBeenCalledWith('error',
      'Self-review cycle 2/2 paused before completion. Auto-review exhausted. Inspect the plan and decide manually.');
  });
  it('reports an actually failed second review distinctly from an interruption', async () => {
    const { coordinator, host } = fixture();
    host.executePlan.mockImplementationOnce(async value => ({ ...value, state: 'paused',
      steps: value.steps.map(step => step.type === 'review' ? { ...step, state: 'failed' } : step) }));
    await coordinator.finalizePlanWithReviewGate({ ...plan(), reviewCyclesUsed: 1 }, {}, new AbortController().signal);
    expect(host.notify).toHaveBeenCalledWith('error',
      'Self-review cycle 2/2 failed. Auto-review exhausted. Inspect the plan and decide manually.');
  });
  it('preserves context, increments the review budget and uses fresh callbacks', async () => {
    const { coordinator, host, callbacks } = fixture();
    const value = plan();
    const snapshot = structuredClone(value);
    const signal = new AbortController().signal;
    const executors = {};
    host.executePlan.mockImplementationOnce(async (current, _executors, callbacks) => {
      callbacks.onPlanUpdate(current);
      callbacks.onStepStart(current.steps.at(-1)!.id);
      return { ...current, state: 'done' };
    });
    await coordinator.finalizePlanWithReviewGate(value, executors, signal);
    const reviewed = host.executePlan.mock.calls[0][0];
    expect(reviewed).toMatchObject({ state: 'running', reviewCyclesUsed: 1,
      stepContext: { retained: 'context', __plan_intent: value.intent } });
    expect(reviewed.steps).toHaveLength(2);
    expect(reviewed.steps[1]).toMatchObject({ type: 'review', state: 'pending', estimatedTokens: 20, estimatedCostUsd: 0.25 });
    expect(host.callbacks).toHaveBeenCalledWith(reviewed);
    expect(host.executePlan).toHaveBeenCalledWith(reviewed, executors,
      expect.objectContaining({ onStepDone: expect.any(Function), onPlanUpdate: expect.any(Function) }), expect.any(AbortSignal));
    expect(callbacks.onPlanUpdate).toHaveBeenCalledWith(reviewed);
    expect(callbacks.onStepStart).toHaveBeenCalledWith(reviewed.steps.at(-1)!.id);
    expect(value).toEqual(snapshot);
  });
  it('persists a paused plan if the review executor throws', async () => {
    const { coordinator, host } = fixture();
    host.executePlan.mockRejectedValueOnce(new Error('review crashed'));
    const result = await coordinator.finalizePlanWithReviewGate(plan(), {}, new AbortController().signal);
    expect(result.state).toBe('paused');
    expect(host.save).toHaveBeenLastCalledWith(result);
    expect(host.notify).toHaveBeenCalledWith('error', 'Self-review cycle failed mid-execution: review crashed');
  });
  it('drains callbacks and clears the controller after execution failure', async () => {
    const { coordinator, host, callbacks } = fixture();
    host.executePlan.mockRejectedValueOnce(new Error('executor crashed'));
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(callbacks.flush).toHaveBeenCalledOnce();
    expect(host.executePlan.mock.calls[0][3].aborted).toBe(true);
    expect(host.releaseAbort.mock.calls[0][0]).toBe(host.setAbort.mock.calls[0][0]);
    expect(host.notify).toHaveBeenCalledWith('error', 'Plan execution failed: executor crashed');
  });
  it('releases a controller when registration mutates the host and then throws', async () => {
    const { coordinator, host } = fixture();
    host.setAbort.mockImplementationOnce(() => { throw new Error('setter failed after registration'); });
    await coordinator.executeApprovedPlan(plan());
    expect(host.releaseAbort.mock.calls[0][0]).toBe(host.setAbort.mock.calls[0][0]);
    expect(host.executePlan).not.toHaveBeenCalled();
  });
  it('retains observed review progress and records the exception', async () => {
    const { coordinator, host } = fixture();
    host.executePlan.mockImplementationOnce(async (value, _executors, callbacks) => {
      const latest = { ...value, totalActualCostUsd: 2.5, totalActualTokens: 123 };
      callbacks.onPlanUpdate(latest);
      throw new Error('review transport failed');
    });
    const result = await coordinator.finalizePlanWithReviewGate(plan(), {}, new AbortController().signal);
    expect(result).toMatchObject({ state: 'paused', totalActualCostUsd: 2.5, totalActualTokens: 123 });
    expect(result.steps.at(-1)).toMatchObject({ state: 'failed', result: { error: 'review transport failed' } });
    expect(host.save).toHaveBeenLastCalledWith(result);
  });
  it('stops before further execution when required persistence fails', async () => {
    const { coordinator, host } = fixture();
    host.save.mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error('EACCES: fixture'); });
    await coordinator.executeApprovedPlan(plan());
    expect(host.executePlan).toHaveBeenCalledOnce();
    expect(host.takeFallback).not.toHaveBeenCalled();
    expect(host.notify).toHaveBeenCalledWith('error', 'Plan execution failed: EACCES: fixture');
    expect(host.notify.mock.calls.some(([level]) => level === 'success')).toBe(false);
    expect(host.releaseAbort.mock.calls[0][0]).toBe(host.setAbort.mock.calls[0][0]);
  });
  it('retains a completed step if an exception precedes the next plan update', async () => {
    const { coordinator, host } = fixture([]);
    const value = { ...plan(), state: 'running' as const };
    value.steps = [ { ...value.steps[0], state: 'pending' }, { ...value.steps[0], id: 's2', state: 'pending' } ];
    host.executePlan.mockImplementationOnce(async (_value, _executors, callbacks) => {
      callbacks.onStepStart('s1');
      callbacks.onStepDone('s1', { status: 'success', output: 'finished', actualTokens: 5, actualCostUsd: 0.1, durationMs: 1 });
      throw new Error('after completion');
    });
    await coordinator.executeApprovedPlan(value);
    expect(host.save.mock.calls.at(-1)![0]).toMatchObject({ state: 'paused',
      steps: [{ id: 's1', state: 'done', result: { output: 'finished' } }, { id: 's2', state: 'pending' }] });
  });
  it('seals execution callbacks when the phase returns', async () => {
    const { coordinator, host, callbacks } = fixture([]);
    let retained: any;
    host.executePlan.mockImplementationOnce(async (value, _executors, observed) => {
      retained = observed;
      return { ...value, state: 'paused' };
    });
    const value = { ...plan(), state: 'running' as const };
    value.steps[0].state = 'pending';
    await coordinator.executeApprovedPlan(value);
    const before = callbacks.onPlanUpdate.mock.calls.length;
    retained.onPlanUpdate({ ...plan(), state: 'running' });
    retained.onStepStart('s1');
    retained.onStepDone('s1', { status: 'success', output: '', actualTokens: 0, actualCostUsd: 0, durationMs: 0 });
    retained.onBudgetWarning(2, 1);
    expect(callbacks.onPlanUpdate).toHaveBeenCalledTimes(before);
    expect(callbacks.onStepStart).not.toHaveBeenCalled();
    expect(callbacks.onStepDone).not.toHaveBeenCalled();
    expect(callbacks.onBudgetWarning).not.toHaveBeenCalled();
  });
  it('preserves a cancellation reported before an executor exception', async () => {
    const { coordinator, host } = fixture([]);
    host.executePlan.mockImplementationOnce(async (value, _executors, callbacks) => {
      callbacks.onPlanUpdate({ ...value, state: 'cancelled' });
      throw new Error('aborted');
    });
    await coordinator.executeApprovedPlan({ ...plan(), state: 'running' });
    expect(host.save.mock.calls.at(-1)![0].state).toBe('cancelled');
  });
  it('does not launch review against an already aborted signal', async () => {
    const { coordinator, host } = fixture();
    const controller = new AbortController();
    controller.abort();
    const result = await coordinator.finalizePlanWithReviewGate(plan(), {}, controller.signal);
    expect(result.state).toBe('paused');
    expect(host.executePlan).not.toHaveBeenCalled();
    expect(host.estimateReview).not.toHaveBeenCalled();
  });
});
