import { afterEach, expect, it, vi } from 'vitest';
import { createPipelineStepExecutor } from '../../packages/mod-plan/src/pipeline-step-execution.js';
import type { PlanPipelineHost, PlanPipelineIssue, PlanPipelineRun } from '../../packages/mod-plan/src/pipeline-step-execution.js';

const step = { id: 'p', type: 'pipeline' as const, description: 'task', estimatedTokens: 0, estimatedCostUsd: 0 };
function fixture() {
  const dispatch = vi.fn();
  const host: PlanPipelineHost<{ logicalPlanId: string }, PlanPipelineRun, PlanPipelineIssue> = {
    cwd: '/fixture', outputDir: '/runs', assertAvailable: vi.fn((_, signal) => signal?.throwIfAborted()),
    isCancellation: signal => signal?.aborted ?? false,
    snapshot: vi.fn().mockReturnValueOnce({ tokens: 10, cost: 1 }).mockReturnValue({ tokens: 20, cost: 1.5 }),
    activeEngines: () => ['one', 'two', 'three', 'four'], getDispatch: () => dispatch,
    brainstorm: vi.fn().mockResolvedValue({ winner: 'one', response: 'approach' }),
    forge: vi.fn().mockResolvedValue({ winner: 'one' }),
    tribunal: vi.fn().mockResolvedValue({ summary: 'review' }),
    workflow: {
      resolve: vi.fn(() => ({ id: 'workflow', plan: { logicalPlanId: 'plan' } })),
      verifyPlan: vi.fn(() => []), rejectPlan: vi.fn(() => { throw new Error('invalid plan'); }),
      createRun: vi.fn(() => ({ status: 'pending', events: [] })),
      append: vi.fn((run, phaseId, type) => ({ status: type === 'failed' || type === 'cancelled' ? type : 'running', events: [...run.events, { phaseId, type }] })),
      verifyRun: vi.fn(() => []),
    },
  };
  return { host, dispatch, execute: (signal?: AbortSignal) => createPipelineStepExecutor(host).execute(step, {}, signal) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('preserves the engine-provider method receiver', async () => {
  const { host, execute } = fixture();
  host.activeEngines = function () { return this.cwd === '/fixture' ? ['selected'] : []; };
  await execute();
  expect(host.brainstorm).toHaveBeenCalledWith(expect.objectContaining({ engines: ['selected'] }));
});

it.each(['info', 'progress-update'])('refuses Forge after cancellation in initial %s callback', async type => {
  const { host, dispatch, execute } = fixture();
  const controller = new AbortController();
  dispatch.mockImplementation(event => { if (event.type === type) controller.abort(new Error('cancelled by progress')); });
  expect((await execute(controller.signal)).result).toMatchObject({ status: 'failure', error: 'cancelled by progress' });
  expect(host.forge).not.toHaveBeenCalled();
  expect(host.tribunal).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'] as const)('rechecks pipeline ownership before %s backend entry', async phase => {
  const { host, dispatch, execute } = fixture();
  let parentAvailable = true;
  host.assertAvailable = type => { if (type === 'pipeline' && !parentAvailable) throw new Error('pipeline disabled'); };
  dispatch.mockImplementation(event => { if (event.type === 'workflow-phase-started' && event.phaseId === phase) parentAvailable = false; });
  expect((await execute()).result).toMatchObject({ status: 'failure', error: 'pipeline disabled' });
  expect(host[phase]).not.toHaveBeenCalled();
});

it.each(['workflow-run-conformance-failed', 'workflow-run-completed', 'progress-clear'])('retains result and attempts terminal notification when %s throws', async type => {
  const { host, dispatch, execute } = fixture();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (type === 'workflow-run-conformance-failed') vi.mocked(host.workflow.verifyRun).mockReturnValue([{ code: 'invalid-phase', message: 'missing evidence' }]);
  dispatch.mockImplementation(event => { if (event.type === type) throw new Error('UI unavailable'); });
  const result = await execute();
  expect(result.result.status).toBe(type === 'workflow-run-conformance-failed' ? 'failure' : 'success');
  expect(dispatch.mock.calls.filter(([event]) => event.type === 'workflow-run-completed')).toHaveLength(1);
  expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ type: 'progress-clear' });
  expect(warning).toHaveBeenCalledWith(expect.stringContaining(type));
});

it.each(['no-winner', 'exception', 'cancelled'])('agrees on verification failure after %s', async failure => {
  const { host, dispatch, execute } = fixture();
  const controller = new AbortController();
  host.forge = vi.fn(async () => {
    if (failure === 'exception') throw new Error('backend failed');
    if (failure === 'cancelled') controller.abort(new Error('cancelled'));
    return { winner: null };
  });
  vi.mocked(host.workflow.verifyRun).mockReturnValue([{ code: 'invalid-phase', message: 'missing evidence' }]);
  const result = await execute(controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: 'workflow-conformance-failed' });
  expect(result).not.toHaveProperty('contextExport');
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow-run-completed', status: 'failed', reason: 'workflow-conformance-failed' }));
});

it('rejects a pre-aborted pipeline even with a no-op host guard', async () => {
  const { host, execute } = fixture();
  host.assertAvailable = vi.fn();
  const controller = new AbortController();
  controller.abort(new Error('cancelled before entry'));
  await expect(execute(controller.signal)).rejects.toThrow('cancelled before entry');
  expect(host.workflow.resolve).not.toHaveBeenCalled();
  expect(host.snapshot).not.toHaveBeenCalled();
  expect(host.brainstorm).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'] as const)('refuses stale %s phase completion without a success receipt', async phase => {
  for (const fault of ['child-disabled', 'pipeline-disabled', 'cancelled']) {
    const { host, dispatch, execute } = fixture();
    const controller = new AbortController();
    let unavailable = '';
    host.assertAvailable = vi.fn(type => { if (type === unavailable) throw new Error(fault); });
    const revoke = () => {
      if (fault === 'cancelled') controller.abort(new Error(fault));
      else unavailable = fault === 'child-disabled' ? phase : 'pipeline';
    };
    if (phase === 'brainstorm') host.brainstorm = vi.fn(async () => { revoke(); return { winner: 'one', response: 'approach' }; });
    if (phase === 'forge') host.forge = vi.fn(async () => { revoke(); return { winner: 'one' }; });
    if (phase === 'tribunal') host.tribunal = vi.fn(async () => { revoke(); return { summary: 'review' }; });
    const output = await execute(controller.signal);
    expect(output.result).toMatchObject({ status: 'failure', error: fault, actualTokens: 10, actualCostUsd: 0.5 });
    expect(output).not.toHaveProperty('contextExport');
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow-phase-completed', phaseId: phase }));
    const terminal = dispatch.mock.calls.filter(([event]) => event.type === 'workflow-run-completed');
    expect(terminal).toHaveLength(1);
    expect(terminal[0][0].status).toBe(fault === 'cancelled' ? 'cancelled' : 'failed');
    if (phase === 'brainstorm') expect(host.forge).not.toHaveBeenCalled();
    if (phase !== 'tribunal') expect(host.tribunal).not.toHaveBeenCalled();
  }
});

it('refuses disabled pipeline before compiler or effects', async () => {
  const { host, execute } = fixture();
  host.assertAvailable = vi.fn(() => { throw new Error('disabled'); });
  await expect(execute()).rejects.toThrow('disabled');
  expect(host.workflow.resolve).not.toHaveBeenCalled();
  expect(host.snapshot).not.toHaveBeenCalled();
  expect(host.brainstorm).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'] as const)('preserves host-classified authority failure during %s', async phase => {
  const { host, dispatch, execute } = fixture();
  const controller = new AbortController();
  host.isCancellation = vi.fn(() => false);
  const refuse = () => controller.abort(new Error('generation changed'));
  if (phase === 'brainstorm') host.brainstorm = vi.fn(async () => { refuse(); return { winner: 'one', response: 'approach' }; });
  if (phase === 'forge') host.forge = vi.fn(async () => { refuse(); return { winner: 'one' }; });
  if (phase === 'tribunal') host.tribunal = vi.fn(async () => { refuse(); return { summary: 'review' }; });
  const result = await execute(controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: 'generation changed' });
  expect(result).not.toHaveProperty('contextExport');
  expect(host.isCancellation).toHaveBeenCalledExactlyOnceWith(controller.signal);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow-phase-failed', phaseId: phase, reason: 'generation changed' }));
  const terminal = dispatch.mock.calls.filter(([event]) => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0][0]).toMatchObject({ status: 'failed', reason: 'generation changed' });
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow-phase-cancelled' }));
});

it('rejects an invalid compiled plan before starting a run', async () => {
  const { host, execute } = fixture();
  vi.mocked(host.workflow.verifyPlan).mockReturnValue([{ code: 'missing-node', message: 'missing' }]);
  await expect(execute()).rejects.toThrow('invalid plan');
  expect(host.workflow.rejectPlan).toHaveBeenCalledExactlyOnceWith([{ code: 'missing-node', message: 'missing' }], 'agon.brainstorm-forge-tribunal@v1 flow verification failed');
  expect(host.workflow.createRun).not.toHaveBeenCalled();
  expect(host.brainstorm).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'] as const)('checks %s authority before backend effects', async phase => {
  const { host, execute } = fixture();
  host.assertAvailable = vi.fn(type => { if (type === phase) throw new Error('disabled child'); });
  expect((await execute()).result).toMatchObject({ status: 'failure', error: 'disabled child' });
  expect(host[phase]).not.toHaveBeenCalled();
});

it('stops after a tracking failure and emits one terminal event', async () => {
  const { host, dispatch, execute } = fixture();
  vi.mocked(host.workflow.append).mockImplementation(() => { throw new Error('journal failed'); });
  expect((await execute()).result).toMatchObject({ status: 'failure', error: 'workflow-conformance-failed' });
  expect(host.brainstorm).not.toHaveBeenCalled();
  expect(host.forge).not.toHaveBeenCalled();
  expect(dispatch.mock.calls.filter(([event]) => event.type === 'workflow-run-completed')).toHaveLength(1);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow-run-conformance-failed', issues: [{ code: 'invalid-phase', message: 'journal failed', path: 'workflowRun' }] }));
});

it('preserves structured tracking diagnostics and completed phase output', async () => {
  const { host, dispatch, execute } = fixture();
  const append = host.workflow.append;
  const issues = [{ code: 'missing-node', message: 'lost phase' }];
  host.workflow.append = vi.fn((run, phase, type, message, data) => {
    if (phase === 'forge') throw Object.assign(new Error('bad phase'), { issues });
    return append(run, phase, type, message, data);
  });
  expect((await execute()).result).toMatchObject({ status: 'failure', output: 'Partial pipeline (brainstorm done): approach' });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow-run-conformance-failed', issues }));
  expect(host.forge).not.toHaveBeenCalled();
});

it('does not review a Forge run without a winner', async () => {
  const { host, execute } = fixture();
  vi.mocked(host.forge).mockResolvedValue({ winner: null });
  expect((await execute()).result).toMatchObject({ status: 'failure', error: 'Forge produced no winner' });
  expect(host.tribunal).not.toHaveBeenCalled();
});

it('cleans progress timers after Forge fails', async () => {
  vi.useFakeTimers(); const { host, dispatch, execute } = fixture();
  vi.mocked(host.forge).mockImplementation(async () => { await vi.advanceTimersByTimeAsync(501); throw new Error('forge failed'); });
  expect((await execute()).result).toMatchObject({ status: 'failure', error: 'forge failed' });
  expect(vi.getTimerCount()).toBe(0);
  expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ type: 'progress-clear' });
});

it('preserves metered billing, three reviewers, and bounded context export', async () => {
  const { host, execute } = fixture();
  vi.mocked(host.tribunal).mockResolvedValue({ summary: 'x'.repeat(400) });
  const signal = new AbortController().signal;
  const output = await execute(signal);
  expect(output.result).toMatchObject({ status: 'success', actualTokens: 10, actualCostUsd: 0.5 });
  expect(output.contextExport).toBe(`Pipeline result: forge winner one. Tribunal: ${'x'.repeat(300)}`);
  expect(host.tribunal).toHaveBeenCalledWith(expect.objectContaining({ engines: ['one', 'two', 'three'], signal }));
  expect(vi.mocked(host.forge).mock.calls[0][2]).toBe('forge');
});

it.each(['issues', 'exception', 'empty-exception'] as const)('refuses final validation %s without a success receipt', async failure => {
  const { host, dispatch, execute } = fixture();
  const issues = [{ code: 'missing-node', message: 'completion evidence missing' }];
  vi.mocked(host.workflow.verifyRun).mockImplementation(() => {
    if (failure === 'empty-exception') throw Object.assign(new Error('validator unavailable'), { issues: [] });
    if (failure === 'exception') throw Object.assign(new Error('validator unavailable'), { issues });
    return issues;
  });
  const output = await execute();
  expect(output.result).toMatchObject({ status: 'failure', error: 'workflow-conformance-failed' });
  expect(output).not.toHaveProperty('contextExport');
  expect(host.workflow.verifyRun).toHaveBeenCalledOnce();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow-run-conformance-failed',
    issues: failure === 'empty-exception' ? [{ code: 'invalid-phase', message: 'validator unavailable', path: 'workflowRun' }] : issues,
  }));
  const terminal = dispatch.mock.calls.filter(([event]) => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0][0]).toMatchObject({ status: 'failed', reason: 'workflow-conformance-failed', workflowStatus: 'failed' });
  expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ type: 'progress-clear' });
});
