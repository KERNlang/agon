import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(), available: vi.fn(), current: vi.fn(), append: vi.fn(),
  track: vi.fn(), add: vi.fn(), record: vi.fn(),
}));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({
  ...await original<object>(),
  processSurfaceClient: () => ({ assertAvailable: mocks.available }),
  captureProcessSurfaceAuthority: () => mocks.current,
}));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(), appendMessage: mocks.append, tracker: { record: mocks.track },
}));
vi.mock('@kernlang/agon-forge', async original => ({ ...await original<object>(), runResearch: mocks.run }));
vi.mock('@kernlang/agon-mod-plan', async original => ({ ...await original<object>(), dispatchPlanNaturalInput: async () => false }));
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: mocks.add } }));
vi.mock('../../packages/cli/src/telemetry/index.js', () => ({ recordRun: mocks.record, formatRunSummary: () => 'summary' }));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(),
  withThreadOutcome: (_cwd: string, _mode: string, _label: string, run: () => Promise<unknown>) => run,
  collectRecentEngineContext: () => '',
}));

import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
import { handleResearch } from '../../packages/cli/src/handlers/research.js';

beforeEach(() => vi.resetAllMocks());

function callbacks() {
  return {
    ctx: { activeEngines: () => ['alpha'], setActiveAbort: vi.fn(),
      chatSession: { id: 'research-session', messages: [] }, registry: {}, adapter: {} },
    dispatch: vi.fn(), runAsJob: vi.fn(),
  };
}

function result() {
  return { ok: true, question: 'Question', intent: 'fact', engineId: 'alpha',
    answer: 'Answer [1].', sources: [{ title: 'Source', url: 'https://source.example', snippet: '', fetched: true }],
    citations: { total: 1, verified: 1, blocked: 0, rejected: 0, results: [] }, outputDir: '/fixture' };
}

it('rejects disabled Research through the full legacy-shaped intent router before scheduling', async () => {
  mocks.available.mockImplementation(() => { throw new Error('Research disabled'); });
  const cb = callbacks();
  await expect(dispatchIntent({ type: 'research', question: 'Question' }, '/research Question', cb as never))
    .rejects.toThrow('Research disabled');
  expect(mocks.available).toHaveBeenCalledWith('/research');
  expect(cb.runAsJob).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('rejects a queued Research job when its generation changes', async () => {
  const cb = callbacks();
  mocks.run.mockResolvedValue(result());
  await dispatchIntent({ type: 'research', question: 'Question' }, '/research Question', cb as never);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  mocks.current.mockImplementation(() => { throw new Error('generation changed'); });
  await expect(cb.runAsJob.mock.calls[0][2](new AbortController().signal)).rejects.toThrow('generation changed');
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(['direct', 'fallback'].flatMap(route => ['before', 'during'].map(phase => ({ route, phase }))))(
  'rejects cancelled Research without late session effects: $route/$phase', async ({ route, phase }) => {
    const controller = new AbortController();
    const cb = callbacks();
    mocks.run.mockImplementation(async () => {
      controller.abort(new Error('job cancelled'));
      cb.dispatch.mockClear();
      return result();
    });
    if (phase === 'before') controller.abort(new Error('job cancelled'));
    if (route === 'fallback') {
      await dispatchIntent({ type: 'research', question: 'Question' }, '/research Question', cb as never);
      expect(cb.runAsJob).toHaveBeenCalledOnce();
    }
    const pending = route === 'direct'
      ? handleResearch('Question', cb.dispatch, cb.ctx as never, { signal: controller.signal } as never)
      : cb.runAsJob.mock.calls[0][2](controller.signal);
    await expect(pending).rejects.toThrow('job cancelled');
    expect(mocks.run).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
    if (phase === 'during') expect(mocks.run.mock.calls[0][0].signal.aborted).toBe(true);
    expect(cb.dispatch.mock.calls.filter(([event]) => event.type !== 'progress-clear')).toEqual([]);
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  },
);

it('keeps enabled successful Research output and session records', async () => {
  const cb = callbacks();
  mocks.run.mockResolvedValue(result());
  await dispatchIntent({ type: 'research', question: 'Question' }, '/research Question', cb as never);
  await cb.runAsJob.mock.calls[0][2](new AbortController().signal);
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: expect.stringContaining('Answer [1].') }));
  expect(mocks.append).toHaveBeenCalledWith(cb.ctx.chatSession, expect.objectContaining({ role: 'engine', content: 'Answer [1].' }));
  expect(mocks.add).toHaveBeenCalledOnce();
  expect(mocks.record).toHaveBeenCalledOnce();
  expect(cb.ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
});

it('rejects a direct disabled handler before starting Research', async () => {
  const cb = callbacks();
  mocks.available.mockImplementation(() => { throw new Error('Research disabled'); });
  await expect(handleResearch('Question', cb.dispatch, cb.ctx as never)).rejects.toThrow('Research disabled');
  expect(mocks.run).not.toHaveBeenCalled();
  expect(cb.dispatch).not.toHaveBeenCalled();
});

it('does not publish a result after the selected generation changes during Research', async () => {
  const cb = callbacks();
  mocks.run.mockImplementation(async () => {
    mocks.current.mockImplementation(() => { throw new Error('generation changed'); });
    cb.dispatch.mockClear();
    return result();
  });
  await expect(handleResearch('Question', cb.dispatch, cb.ctx as never)).rejects.toThrow('generation changed');
  expect(cb.dispatch.mock.calls.filter(([event]) => event.type !== 'progress-clear')).toEqual([]);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

it('clears progress and suppresses late narration after UI cancellation', async () => {
  vi.useFakeTimers();
  try {
    const cb = callbacks();
    const job = new AbortController();
    let finish!: (value: ReturnType<typeof result>) => void;
    mocks.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = handleResearch('Question', cb.dispatch, cb.ctx as never, { signal: job.signal });
    await vi.advanceTimersByTimeAsync(250);
    expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'progress-update' }));
    cb.ctx.setActiveAbort.mock.calls[0][0].abort(new Error('UI cancelled'));
    cb.dispatch.mockClear();
    mocks.run.mock.calls[0][0].onStatus('late narration');
    const rejected = expect(pending).rejects.toThrow('UI cancelled');
    await vi.advanceTimersByTimeAsync(250);
    expect(cb.dispatch.mock.calls).toEqual([[{ type: 'progress-clear' }]]);
    expect(job.signal.aborted).toBe(false);
    finish(result());
    await rejected;
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(cb.ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  } finally { vi.useRealTimers(); }
});

it('stops stale-generation progress while Research remains pending', async () => {
  vi.useFakeTimers();
  let finish!: (value: ReturnType<typeof result>) => void;
  let settled: Promise<unknown> | undefined;
  try {
    const cb = callbacks();
    mocks.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    settled = handleResearch('Question', cb.dispatch, cb.ctx as never).catch(error => error);
    await vi.advanceTimersByTimeAsync(250);
    cb.dispatch.mockClear();
    mocks.current.mockImplementation(() => { throw new Error('generation changed'); });
    await vi.advanceTimersByTimeAsync(250);
    expect(cb.dispatch.mock.calls).toEqual([[{ type: 'progress-clear' }]]);
    expect(mocks.run.mock.calls[0][0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(cb.dispatch.mock.calls).toHaveLength(1);
  } finally {
    finish(result());
    await settled;
    vi.useRealTimers();
  }
});

it.each(['rejection', 'stale narration'])('cleans up when Research fails through %s', async failure => {
  const cb = callbacks();
  mocks.run.mockImplementation(async options => {
    cb.dispatch.mockClear();
    if (failure === 'stale narration') {
      mocks.current.mockImplementation(() => { throw new Error('generation changed'); });
      options.onStatus('obsolete status');
    }
    throw new Error('transport failed');
  });
  await expect(handleResearch('Question', cb.dispatch, cb.ctx as never))
    .rejects.toThrow(failure === 'rejection' ? 'transport failed' : 'generation changed');
  expect(cb.dispatch.mock.calls).toEqual([[{ type: 'progress-clear' }]]);
  expect(cb.ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

it('preserves the enabled no-grounded-answer session note', async () => {
  const cb = callbacks();
  mocks.run.mockResolvedValue({ ...result(), ok: false, note: 'no sources' });
  await handleResearch('Question', cb.dispatch, cb.ctx as never);
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'error', message: 'No grounded answer: no sources' });
  expect(mocks.append).toHaveBeenCalledWith(cb.ctx.chatSession, expect.objectContaining({
    role: 'engine', content: 'Research found no grounded answer. (no sources)',
  }));
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(cb.ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
});
