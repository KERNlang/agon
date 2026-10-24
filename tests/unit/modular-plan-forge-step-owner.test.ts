import { afterEach, expect, it, vi } from 'vitest';
import { createForgeStepExecutors } from '../../packages/mod-plan/src/forge-step-execution.js';
import type { PlanForgeHost } from '../../packages/mod-plan/src/forge-step-execution.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

function fixture() {
  const dispatch = vi.fn();
  const host: PlanForgeHost = { cwd: '/fixture', outputDir: '/fixture/runs', assertAvailable: vi.fn(),
    snapshot: vi.fn().mockReturnValueOnce({ tokens: 10, cost: 1 }).mockReturnValue({ tokens: 25, cost: 1.5 }),
    getDispatch: () => dispatch, activeEngines: () => ['engine'], mkdir: vi.fn(),
    readPatch: vi.fn(() => ({ content: 'patch' })), applyPatch: vi.fn(() => ({ ok: true })),
    run: vi.fn().mockResolvedValue({ winner: 'engine', patches: { engine: '/patch' }, results: {} }),
  };
  return { host, dispatch };
}
const step = (type: 'forge' | 'teamforge'): CesarPlanStep => ({ id: 's', type, description: 'task', estimatedTokens: 0, estimatedCostUsd: 0 });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['forge', 'teamforge'] as const)('preserves the %s engine-provider receiver', async kind => {
  const { host } = fixture();
  host.activeEngines = function (this: PlanForgeHost) {
    return this.outputDir === '/fixture/runs' ? ['selected'] : [];
  };
  await createForgeStepExecutors(host)[kind].execute(step(kind), {});
  expect(host.run).toHaveBeenCalledWith(expect.objectContaining({ engines: ['selected'] }), expect.any(Function), kind);
});

it.each(['forge', 'teamforge'] as const)('preserves the %s result when progress cleanup throws', async kind => {
  const { host, dispatch } = fixture();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  dispatch.mockImplementation(event => { if (event.type === 'progress-clear') throw new Error('UI unavailable'); });
  const result = await createForgeStepExecutors(host)[kind].execute(step(kind), {});
  expect(result.result.status).toBe('success');
  expect(host.applyPatch).toHaveBeenCalledOnce();
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('progress-clear'));
});

it.each(['forge', 'teamforge'] as const)('rejects pre-aborted %s even with a no-op host guard', async kind => {
  const { host, dispatch } = fixture();
  const controller = new AbortController();
  controller.abort(new Error('cancelled before entry'));
  await expect(createForgeStepExecutors(host)[kind].execute(step(kind), {}, controller.signal)).rejects.toThrow('cancelled before entry');
  for (const effect of [host.snapshot, host.mkdir, host.run, host.readPatch, host.applyPatch, dispatch]) expect(effect).not.toHaveBeenCalled();
});

it.each(['forge', 'teamforge'] as const)('refuses %s effects after authority or cancellation changes', async kind => {
  for (const fault of ['disabled-after-run', 'disabled-after-read', 'aborted-after-run', 'disabled-noop']) {
    vi.useFakeTimers();
    const { host, dispatch } = fixture();
    const controller = new AbortController();
    let available = true;
    host.assertAvailable = vi.fn(() => { if (!available) throw new Error('disabled during run'); });
    vi.mocked(host.run).mockImplementation(async () => {
      if (fault === 'aborted-after-run') controller.abort(new Error('cancelled during run'));
      else if (fault !== 'disabled-after-read') available = false;
      return fault === 'disabled-noop' ? { winner: null, alreadySatisfied: true }
        : { winner: 'engine', patches: { engine: '/patch' }, results: {} };
    });
    if (fault === 'disabled-after-read') host.readPatch = vi.fn(() => {
      available = false;
      return { content: 'patch' };
    });
    const output = await createForgeStepExecutors(host)[kind].execute(step(kind), {}, controller.signal);
    expect(output.result.status, fault).toBe('failure');
    expect(output.result.error, fault).toMatch(/disabled during run|cancelled during run/);
    expect(output, fault).not.toHaveProperty('contextExport');
    expect(host.applyPatch, fault).not.toHaveBeenCalled();
    if (fault !== 'disabled-after-read') expect(host.readPatch, fault).not.toHaveBeenCalled();
    expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ type: 'progress-clear' });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});

it.each(['forge', 'teamforge'] as const)('refuses disabled %s before filesystem, UI, or backend work', async kind => {
  const { host, dispatch } = fixture();
  host.assertAvailable = vi.fn(() => { throw new Error('disabled'); });
  await expect(createForgeStepExecutors(host)[kind].execute(step(kind), {})).rejects.toThrow('disabled');
  for (const effect of [host.snapshot, host.mkdir, host.run, host.readPatch, host.applyPatch, dispatch]) expect(effect).not.toHaveBeenCalled();
});

it.each(['forge', 'teamforge'] as const)('applies the winning %s patch and clears progress', async kind => {
  vi.useFakeTimers();
  const { host, dispatch } = fixture();
  const signal = new AbortController().signal;
  const output = await createForgeStepExecutors(host)[kind].execute(step(kind), {}, signal);
  expect(host.run).toHaveBeenCalledExactlyOnceWith({ task: 'task', fitnessCmd: 'echo "no fitness"', cwd: '/fixture', forgeDir: '/fixture/runs/s',
    engines: ['engine'], signal, ...(kind === 'teamforge' ? { hardened: true } : {}) }, expect.any(Function), kind);
  expect(host.mkdir).toHaveBeenCalledExactlyOnceWith('/fixture/runs/s');
  expect(host.readPatch).toHaveBeenCalledExactlyOnceWith('/patch');
  expect(host.applyPatch).toHaveBeenCalledExactlyOnceWith('/fixture', 'patch');
  expect(output.result).toMatchObject({ status: 'success', actualTokens: 15, actualCostUsd: 0.5, output: 'Winner: engine (patch applied to cwd)' });
  expect(output.result.artifact).toEqual({ status: 'applied', cwd: '/fixture', patchPath: '/patch',
    patchHash: 'sha256:a4895eb44afc336fecbba6e520cd67e178dace0276655d102fceffa8e5f70570' });
  expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ type: 'progress-clear' });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['forge', 'teamforge'] as const)('fails %s if the winning patch cannot apply', async kind => {
  const { host } = fixture();
  host.applyPatch = vi.fn(() => ({ ok: false, error: 'conflict' }));
  const result = await createForgeStepExecutors(host)[kind].execute(step(kind), {});
  expect(result.result).toMatchObject({ status: 'failure', error: 'patch apply failed: conflict' });
  expect(result.result.artifact).toBeUndefined();
  expect(result).not.toHaveProperty('contextExport');
});

it.each(['forge', 'teamforge'] as const)('records the exact %s bytes and target supplied to application', async kind => {
  const { host } = fixture();
  const patch = { content: 'patch' };
  host.readPatch = vi.fn(() => patch);
  host.applyPatch = vi.fn(() => {
    patch.content = 'changed after application';
    host.cwd = '/another-target';
    return { ok: true };
  });
  const { result } = await createForgeStepExecutors(host)[kind].execute(step(kind), {});
  expect(host.applyPatch).toHaveBeenCalledExactlyOnceWith('/fixture', 'patch');
  expect(result.artifact).toEqual({ status: 'applied', cwd: '/fixture', patchPath: '/patch',
    patchHash: 'sha256:a4895eb44afc336fecbba6e520cd67e178dace0276655d102fceffa8e5f70570' });
});

it.each(['forge', 'teamforge'] as const)('requires %s patch metadata and bytes', async kind => {
  for (const missing of ['path', 'file']) {
    const { host } = fixture();
    if (missing === 'path') vi.mocked(host.run).mockResolvedValue({ winner: 'engine', results: {} });
    else host.readPatch = vi.fn(() => null);
    const result = await createForgeStepExecutors(host)[kind].execute(step(kind), {});
    expect(result.result.status).toBe('failure');
    expect(host.applyPatch).not.toHaveBeenCalled();
  }
});

it.each(['forge', 'teamforge'] as const)('does not apply an empty %s patch', async kind => {
  const { host } = fixture(); host.readPatch = vi.fn(() => ({ content: ' \n ' }));
  const result = (await createForgeStepExecutors(host)[kind].execute(step(kind), {})).result;
  expect(result.status).toBe('success');
  expect(result.artifact).toEqual({ status: 'not-needed', cwd: '/fixture', reason: 'empty-patch' });
  expect(host.applyPatch).not.toHaveBeenCalled();
});

it.each(['forge', 'teamforge'] as const)('cleans %s timers after backend failure', async kind => {
  vi.useFakeTimers(); const { host, dispatch } = fixture();
  vi.mocked(host.run).mockImplementation(async () => { await vi.advanceTimersByTimeAsync(501); throw new Error('failed'); });
  expect((await createForgeStepExecutors(host)[kind].execute(step(kind), {})).result).toMatchObject({ status: 'failure', error: 'failed' });
  expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ type: 'progress-clear' });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['forge', 'teamforge'] as const)('distinguishes satisfied %s no-ops from dispatch crashes', async kind => {
  for (const crashed of [false, true]) {
    const { host } = fixture();
    vi.mocked(host.run).mockResolvedValue({ winner: null, baselinePasses: true, results: { engine: {
      pass: false, score: 0, diffLines: 0, filesChanged: 0, fitnessLogPath: '/fitness', dispatchStdout: crashed ? 'ERROR: failed' : 'already done',
    } } });
    expect((await createForgeStepExecutors(host)[kind].execute(step(kind), {})).result.status).toBe(crashed ? 'failure' : 'success');
    expect(host.applyPatch).not.toHaveBeenCalled();
  }
});
