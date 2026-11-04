import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlanCoordinator } from '../../packages/mod-plan/src/execution-coordinator.js';
import type { PlanCoordinatorHost } from '../../packages/mod-plan/src/execution-coordinator.js';
import { createPlanExecutor } from '../../packages/mod-plan/src/executor.js';
import { createPlanCallbacks } from '../../packages/mod-plan/src/execution-callbacks.js';
import { approveCesarPlan, cancelCesarPlan, createCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import { loadCesarPlan, saveCesarPlan } from '../../packages/mod-plan/src/execution-store.js';
import { prepareCesarPlanResume } from '../../packages/mod-plan/src/resume-policy.js';
import { runPlanResumeApproval } from '../../packages/mod-plan/src/resume-workflow.js';
import type { CesarPlan, CesarPlanStep, CesarStepResult } from '../../packages/mod-plan/src/execution-model.js';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const result: CesarStepResult = { status: 'success', output: 'changed', actualTokens: 2, actualCostUsd: 0.1, durationMs: 1 };

function fixture(parallel = false) {
  const root = mkdtempSync(join(tmpdir(), 'agon-plan-checkpoint-'));
  roots.push(root);
  vi.stubEnv('AGON_HOME', root);
  const plan = { ...approveCesarPlan(createCesarPlan('checkpoint effects', [
    { id: 'first', type: 'self', description: 'first', estimatedTokens: 10, estimatedCostUsd: 1, exports: ['proof'], parallel },
    { id: 'second', type: 'self', description: 'second', estimatedTokens: 10, estimatedCostUsd: 1, parallel },
  ])), selfReview: false };
  const execute = vi.fn(async (_step: CesarPlanStep) => ({ result, contextExport: 'effect receipt' }));
  const save = vi.fn(saveCesarPlan);
  const notify = vi.fn();
  const run = vi.fn(createPlanExecutor({ recordStepCompletion: vi.fn() }));
  const callbacks = vi.fn((value: CesarPlan) => createPlanCallbacks(value, {
    dispatch: vi.fn(), setActivePlan: vi.fn(), todos: () => [], save,
    writeMarkdown: vi.fn(), warn: vi.fn(),
  }));
  const host: PlanCoordinatorHost = {
    createExecutors: () => ({ self: { execute } }),
    executePlan: run,
    callbacks,
    setActivePlan: vi.fn(), setAbort: vi.fn(), releaseAbort: vi.fn(), save,
    writeMarkdown: vi.fn(), hasWorkingTreeChanges: () => false,
    estimateReview: () => ({ tokens: 0, costUsd: 0 }),
    takeFallback: () => undefined, notify, warn: vi.fn(),
  };
  const coordinator = createPlanCoordinator(host);
  return { plan, execute, save, coordinator, notify, run, callbacks, host };
}

it('rejects a retained checkpoint callback after its execution phase settles', async () => {
  const { plan, coordinator, run } = fixture();
  await coordinator.executeApprovedPlan(plan);
  const saved = loadCesarPlan(plan.id);
  const callbacks = run.mock.calls[0][2];
  expect(() => callbacks.onCheckpoint?.(plan)).toThrow(/settled/i);
  expect(loadCesarPlan(plan.id)).toEqual(saved);
});

it.each([false, true])('drains mixed parallel outcomes without enabling resume, invalid finishes last=%s', async invalidLast => {
  const { plan, execute, coordinator } = fixture(true);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  execute.mockImplementation(async step => {
    if ((step.id === 'first') === invalidLast) {
      entered();
      await waiting;
    }
    if (step.id === 'first') return { result: {} as CesarStepResult, contextExport: 'unproven' };
    return { result, contextExport: 'proven' };
  });
  let settled = false;
  const task = coordinator.executeApprovedPlan(plan).finally(() => { settled = true; });
  await started;
  expect(settled).toBe(false);
  release();
  await task;
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.state).toBe('paused');
  expect(saved.steps[0].state).toBe('running');
  expect(saved.steps[0].result).toBeUndefined();
  expect(saved.steps[1]).toMatchObject({ state: 'done', result });
  expect(saved.stepContext.proof).toBeUndefined();
  expect(saved.totalActualCostUsd).toBe(result.actualCostUsd);
  expect(() => prepareCesarPlanResume(saved, 'resume')).toThrow(/unknown/);
  expect(execute).toHaveBeenCalledTimes(2);
});

it('retains unknown outcome evidence when cancelled during a malformed return', async () => {
  const { plan, execute, coordinator, run } = fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  execute.mockImplementationOnce(async () => {
    entered();
    await waiting;
    return { result: {} as CesarStepResult, contextExport: '' };
  });
  const task = coordinator.executeApprovedPlan(plan);
  await started;
  run.mock.calls[0][2].onPlanUpdate(cancelCesarPlan(plan));
  release();
  await task;
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.state).toBe('cancelled');
  expect(saved.steps[0].startedAt).toBeTruthy();
  expect(saved.steps[0].result).toBeUndefined();
  expect(() => prepareCesarPlanResume(saved, 'resume')).toThrow(/unknown/);
  expect(execute).toHaveBeenCalledOnce();
});

it('blocks mixed-outcome fallback before a failed intent write can erase earlier uncertainty', async () => {
  const { plan, execute, coordinator, host, save, run, notify } = fixture(true);
  execute.mockImplementation(async step => ({ result: step.id === 'first' ? {} as CesarStepResult
    : { ...result, status: 'failure', error: 'timeout' }, contextExport: '' }));
  host.takeFallback = () => ({ engine: 'fallback', stepId: 'second' });
  let failed = false;
  save.mockImplementation(value => {
    if (!failed && value.fallbackRetriesUsed?.second && value.steps[1].state === 'running') {
      failed = true;
      throw new Error('fallback intent write failed');
    }
    saveCesarPlan(value);
  });
  await coordinator.executeApprovedPlan(plan);
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.steps[0].state).toBe('running');
  expect(() => prepareCesarPlanResume(saved, 'resume')).toThrow(/unknown/);
  expect(run).toHaveBeenCalledOnce();
  expect(failed).toBe(false);
  expect(notify.mock.calls.some(([, message]) => message.includes('Use /plan resume to retry'))).toBe(false);
});

it('does not reset a previously started unknown step when a new intent checkpoint fails', async () => {
  const { plan, coordinator, save } = fixture();
  plan.steps[0] = { ...plan.steps[0], state: 'running', startedAt: '2026-01-01T00:00:00Z' };
  let failed = false;
  save.mockImplementation(value => {
    if (!failed && value.steps[1].state === 'running') {
      failed = true;
      throw new Error('new intent write failed');
    }
    saveCesarPlan(value);
  });
  await coordinator.executeApprovedPlan(plan);
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.steps[0].state).toBe('running');
  expect(saved.steps[1].state).toBe('pending');
  expect(() => prepareCesarPlanResume(saved, 'resume')).toThrow(/unknown/);
});

it('does not let a checkpoint revive a cancelled phase', async () => {
  const { plan, execute, coordinator, run } = fixture();
  let release!: () => void;
  let reportStarted!: () => void;
  const started = new Promise<void>(resolve => { reportStarted = resolve; });
  execute.mockImplementationOnce(async () => {
    reportStarted();
    await new Promise<void>(resolve => { release = resolve; });
    return { result, contextExport: 'effect receipt' };
  });
  const task = coordinator.executeApprovedPlan(plan);
  await started;
  const callbacks = run.mock.calls[0][2];
  callbacks.onPlanUpdate(cancelCesarPlan(plan));
  try {
    expect(() => callbacks.onCheckpoint?.(plan)).toThrow(/cancelled/i);
  } finally {
    release();
    await task;
  }
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.state).toBe('cancelled');
  expect(saved.steps[0]).toMatchObject({ state: 'done', result });
  expect(saved.stepContext.proof).toBe('effect receipt');
  expect(saved.totalActualTokens).toBe(result.actualTokens);
  expect(saved.totalActualCostUsd).toBe(result.actualCostUsd);
  expect(prepareCesarPlanResume(saved, 'resume').steps[0].state).toBe('skipped');
  expect(execute).toHaveBeenCalledOnce();
});

it('persists a completed parallel sibling before a slower sibling settles', async () => {
  const { plan, execute, coordinator } = fixture(true);
  let release!: () => void;
  let reportStarted!: () => void;
  const started = new Promise<void>(resolve => { reportStarted = resolve; });
  execute.mockImplementation(async step => {
    if (step.id === 'second') {
      reportStarted();
      await new Promise<void>(resolve => { release = resolve; });
    }
    return { result, contextExport: 'effect receipt' };
  });
  const task = coordinator.executeApprovedPlan(plan);
  await started;
  try {
    await vi.waitFor(() => {
      const saved = loadCesarPlan(plan.id)!;
      expect(saved.steps[0]).toMatchObject({ state: 'done', result });
      expect(saved.steps[1].state).toBe('running');
      expect(saved.stepContext.proof).toBe('effect receipt');
      expect(saved.totalActualTokens).toBe(result.actualTokens);
    }, { timeout: 1000 });
  } finally { release(); await task; }
});

it('persists the raw result and export before waiting for optional summarization', async () => {
  vi.useFakeTimers();
  const { plan, coordinator, callbacks } = fixture();
  const create = callbacks.getMockImplementation()!;
  let release!: () => void;
  let reportStarted!: () => void;
  const started = new Promise<void>(resolve => { reportStarted = resolve; });
  callbacks.mockImplementation(value => ({ ...create(value), summarizeStepOutput: async () => {
    reportStarted();
    await new Promise<void>(resolve => { release = resolve; });
    return 'summary';
  } }));
  const task = coordinator.executeApprovedPlan(plan);
  await started;
  try {
    await vi.advanceTimersByTimeAsync(301);
    const saved = loadCesarPlan(plan.id)!;
    expect(saved.steps[0]).toMatchObject({ state: 'done', result });
    expect(saved.stepContext.proof).toBe('effect receipt');
  } finally { release(); await task; }
});

it('resumes a dependency chain across a completed checkpoint without replay', async () => {
  const { plan, execute, coordinator } = fixture();
  plan.steps[0] = { ...plan.steps[0], state: 'done', result };
  plan.steps.push({ id: 'third', type: 'self', description: 'dependent effect', dependsOn: ['first', 'second'], state: 'blocked', estimatedTokens: 1, estimatedCostUsd: 0 });
  plan.state = 'paused';
  await coordinator.executeApprovedPlan(prepareCesarPlanResume(plan, 'resume'));
  expect(execute.mock.calls.map(([step]) => step.id)).toEqual(['second', 'third']);
  expect(loadCesarPlan(plan.id)?.state).toBe('done');
});

it.each([undefined, 'failure'] as const)('does not satisfy dependencies from a skipped step with result %s', async status => {
  const { plan, execute, coordinator } = fixture();
  plan.steps[0] = { ...plan.steps[0], state: 'skipped', result: status ? { ...result, status } : undefined };
  plan.steps.push({ id: 'third', type: 'self', description: 'blocked effect', dependsOn: ['first', 'second'], state: 'blocked', estimatedTokens: 1, estimatedCostUsd: 0 });
  await coordinator.executeApprovedPlan(plan);
  expect(execute.mock.calls.map(([step]) => step.id)).toEqual(['second']);
  expect(loadCesarPlan(plan.id)?.state).toBe('paused');
});

it('drains mixed parallel outcomes after a transient checkpoint failure without replay', async () => {
  const { plan, execute, save, coordinator } = fixture(true);
  plan.steps[1].exports = ['secondProof'];
  const failed: CesarStepResult = { ...result, status: 'failure', error: 'backend refused', actualTokens: 7, actualCostUsd: 0.4 };
  let release!: () => void;
  let refused!: () => void;
  const refusal = new Promise<void>(resolve => { refused = resolve; });
  execute.mockImplementation(async step => {
    if (step.id === 'second') {
      await new Promise<void>(resolve => { release = resolve; });
      return { result: failed, contextExport: 'failure receipt' };
    }
    return { result, contextExport: 'effect receipt' };
  });
  let didRefuse = false;
  save.mockImplementation(value => {
    if (!didRefuse && value.steps[0].result) {
      didRefuse = true;
      refused();
      throw new Error('EBUSY result');
    }
    saveCesarPlan(value);
  });
  let settled = false;
  const task = coordinator.executeApprovedPlan(plan).finally(() => { settled = true; });
  await refusal;
  try {
    expect(settled).toBe(false);
    // The refused write leaves intent on disk until a recovery write succeeds.
    expect(loadCesarPlan(plan.id)?.steps[0]).toMatchObject({ state: 'running' });
    expect(loadCesarPlan(plan.id)?.steps[0].result).toBeUndefined();
  } finally { release(); await task; }
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.steps).toMatchObject([{ state: 'done', result }, { state: 'failed', result: failed }]);
  expect(saved.stepContext).toEqual({ proof: 'effect receipt', secondProof: 'failure receipt' });
  expect(saved.totalActualTokens).toBe(9);
  expect(saved.totalActualCostUsd).toBe(0.5);
  expect(saved.state).toBe('paused');
  expect(execute).toHaveBeenCalledTimes(2);
});

it('refuses ordinary resume of a cancelled step with unknown effects', () => {
  const { plan } = fixture();
  plan.steps[0] = { ...plan.steps[0], state: 'running', startedAt: new Date().toISOString() };
  const cancelled = cancelCesarPlan(plan);
  const before = structuredClone(cancelled);
  expect(() => prepareCesarPlanResume(cancelled, 'resume')).toThrow(/first.*outcome.*unknown/i);
  expect(cancelled).toEqual(before);
  expect(prepareCesarPlanResume(cancelled, 'restart').steps[0].state).toBe('pending');
});

it.each(['fallback', 'review'] as const)('keeps checkpoint failures bounded to the %s phase', async phase => {
  for (const failure of ['intent', 'result']) {
    const { plan, execute, save, coordinator, host, run } = fixture();
    plan.selfReview = phase === 'review';
    let secondCalls = 0;
    execute.mockImplementation(async step => {
      if (phase === 'fallback' && step.id === 'second' && ++secondCalls === 1) {
        return { result: { ...result, status: 'failure', error: 'timeout' }, contextExport: 'interrupted' };
      }
      return { result, contextExport: 'effect receipt' };
    });
    host.createExecutors = () => ({ self: { execute }, review: { execute } });
    host.hasWorkingTreeChanges = () => phase === 'review';
    host.takeFallback = () => phase === 'fallback' ? { engine: 'replacement', stepId: 'second' } : undefined;
    const phaseStep = (value: CesarPlan) => value.steps.find(step => phase === 'review'
      ? step.type === 'review' : step.engine === 'replacement');
    save.mockImplementation(value => {
      const step = phaseStep(value);
      if (step && (failure === 'intent' ? step.state === 'running' && !step.result : !!step.result)) {
        throw new Error(`ENOSPC ${phase} ${failure}`);
      }
      saveCesarPlan(value);
    });
    await coordinator.executeApprovedPlan(plan);
    const saved = loadCesarPlan(plan.id)!;
    expect(saved.steps[0]).toMatchObject({ state: 'done', result });
    expect(saved.stepContext.proof).toBe('effect receipt');
    expect(saved.state).not.toBe('done');
    expect(phaseStep(saved)?.state).toBe(failure === 'intent' ? 'pending' : 'running');
    expect(phaseStep(saved)?.result).toBeUndefined();
    const calls = execute.mock.calls.filter(([step]) => phase === 'review'
      ? step.type === 'review' : step.engine === 'replacement');
    expect(calls).toHaveLength(failure === 'intent' ? 0 : 1);
    if (failure === 'result') expect(() => prepareCesarPlanResume(saved, 'resume')).toThrow(/outcome.*unknown/i);
    expect(() => run.mock.calls[0][2].onCheckpoint?.(plan)).toThrow(/settled/i);
    expect(loadCesarPlan(plan.id)).toEqual(saved);
  }
});

it.each([false, true])('records running intent before any effect (parallel=%s)', async parallel => {
  vi.useFakeTimers();
  const { plan, execute, coordinator } = fixture(parallel);
  const observed: CesarPlan[] = [];
  execute.mockImplementation(async () => {
    observed.push(loadCesarPlan(plan.id)!);
    return { result, contextExport: 'effect receipt' };
  });
  await coordinator.executeApprovedPlan(plan);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(observed[0].steps[0].state).toBe('running');
  expect(observed[1].steps[1].state).toBe('running');
  if (!parallel) {
    expect(observed[1].steps[0]).toMatchObject({ state: 'done', result });
    expect(observed[1].stepContext.proof).toBe('effect receipt');
  }
  expect(loadCesarPlan(plan.id)?.state).toBe('done');
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('starts no effects when the intent write fails (parallel=%s)', async parallel => {
  const { plan, execute, save, coordinator } = fixture(parallel);
  save.mockImplementation(value => {
    if (value.steps.some(step => step.state === 'running')) throw new Error('ENOSPC intent');
    saveCesarPlan(value);
  });
  await coordinator.executeApprovedPlan(plan);
  expect(execute).not.toHaveBeenCalled();
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.state).toBe('paused');
  expect(saved.steps.every(step => step.state === 'pending')).toBe(true);
});

it.each([false, true])('retains uncertain running intent when every result write fails (parallel=%s)', async parallel => {
  vi.useFakeTimers();
  const { plan, execute, save, coordinator, notify } = fixture(parallel);
  save.mockImplementation(value => {
    if (value.steps.some(step => step.result)) throw new Error('ENOSPC result');
    saveCesarPlan(value);
  });
  await coordinator.executeApprovedPlan(plan);
  expect(execute).toHaveBeenCalledTimes(parallel ? 2 : 1);
  const saved = loadCesarPlan(plan.id)!;
  expect(saved.steps[0]).toMatchObject({ state: 'running' });
  expect(saved.steps[0].result).toBeUndefined();
  expect(() => prepareCesarPlanResume(saved, 'resume')).toThrow(/first.*outcome.*unknown/i);
  expect(notify.mock.calls.some(([level]) => level === 'success')).toBe(false);
  await vi.runAllTimersAsync();
  expect(loadCesarPlan(plan.id)).toEqual(saved);
});

it('recovers a known outcome after a transient save failure without replaying it', async () => {
  vi.useFakeTimers();
  const { plan, execute, save, coordinator } = fixture();
  let refused = false;
  save.mockImplementation(value => {
    if (!refused && value.steps[0].result) {
      refused = true;
      throw new Error('EBUSY result');
    }
    saveCesarPlan(value);
  });
  await coordinator.executeApprovedPlan(plan);
  expect(execute).toHaveBeenCalledOnce();
  const saved = loadCesarPlan(plan.id)!;
  expect(saved).toMatchObject({ state: 'paused', stepContext: { proof: 'effect receipt' } });
  expect(saved.steps[0]).toMatchObject({ state: 'done', result });
  await vi.runAllTimersAsync();
  expect(loadCesarPlan(plan.id)).toEqual(saved);
  await coordinator.executeApprovedPlan(prepareCesarPlanResume(saved, 'resume'));
  expect(execute).toHaveBeenCalledTimes(2);
  expect(loadCesarPlan(plan.id)?.state).toBe('done');
});

it('requires an explicit restart for an interrupted step without a stored outcome', () => {
  const { plan } = fixture();
  plan.steps[0].state = 'running';
  const before = structuredClone(plan);
  expect(() => prepareCesarPlanResume(plan, 'resume')).toThrow(/first.*outcome.*unknown/i);
  expect(plan).toEqual(before);
  expect(prepareCesarPlanResume(plan, 'restart').steps[0].state).toBe('pending');
});

it.each(['running', 'done'] as const)('refuses resume approval for a %s step without a stored result', async state => {
  const { plan } = fixture();
  plan.state = 'paused';
  plan.steps[0].state = state;
  const before = structuredClone(plan);
  const execute = vi.fn(async () => {});
  const notify = vi.fn();
  await runPlanResumeApproval(plan, { available: () => true, choose: async () => '1', execute, notify });
  expect(execute).not.toHaveBeenCalled();
  expect(notify).toHaveBeenLastCalledWith('error', expect.stringMatching(/first.*(outcome.*unknown|missing its result)/i));
  expect(plan).toEqual(before);
});

it('flushes the authoritative recovery snapshot instead of an older UI snapshot', async () => {
  vi.useFakeTimers();
  const { plan } = fixture();
  const save = vi.fn(saveCesarPlan);
  const callbacks = createPlanCallbacks(plan, { dispatch: vi.fn(), setActivePlan: vi.fn(), todos: () => [], save, writeMarkdown: vi.fn(), warn: vi.fn() });
  callbacks.onPlanUpdate(plan);
  const recovered: CesarPlan = { ...plan, state: 'paused', steps: [{ ...plan.steps[0], state: 'done', result }, plan.steps[1]], stepContext: { proof: 'durable result' } };
  callbacks.flush(recovered);
  expect(loadCesarPlan(plan.id)).toMatchObject(recovered);
  expect(vi.getTimerCount()).toBe(0);
  await vi.runAllTimersAsync();
  expect(save).toHaveBeenCalledExactlyOnceWith(recovered);
});
