import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), append: vi.fn(), track: vi.fn(), add: vi.fn(), record: vi.fn(), available: vi.fn(), current: vi.fn() }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({
  ...await original<object>(),
  processSurfaceClient: () => ({ assertAvailable: mocks.available, project: () => ({ entries: [{
    id: 'tuiSlashCommands:0063', kind: 'intent', owner: { id: 'agon.synthesis' },
    payload: { inputSchema: { type: 'object' }, run: async (input: object, context: { signal: AbortSignal }) => ({
      exitCode: 0, result: await mocks.run({ ...input, signal: context.signal }),
    }) },
  }] }) }),
  captureProcessSurfaceAuthority: () => mocks.current,
}));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(), appendMessage: mocks.append, tracker: { record: mocks.track },
}));
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: mocks.add } }));
vi.mock('../../packages/cli/src/telemetry/index.js', () => ({ recordRun: mocks.record, formatRunSummary: () => 'summary' }));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(), withThreadOutcome: (_cwd: string, _mode: string, _label: string, run: () => Promise<unknown>) => run,
  collectRecentEngineContext: () => '',
}));
import { handleSynthesis } from '../../packages/cli/src/handlers/synthesis.js';
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';

beforeEach(() => vi.resetAllMocks());

it.each([0, 1, 2])('publishes and saves the winning content after %i completed swaps', async rounds => {
  const dispatch = vi.fn();
  const chatSession = { id: 'winner-session', messages: [] };
  const setActiveAbort = vi.fn();
  const swaps = Array.from({ length: rounds }, (_, index) => ({
    round: index + 1, fromEngineId: 'beta', toEngineId: 'alpha',
    originalContent: 'beta draft', improvedContent: `alpha revision ${index + 1}`, reasoning: 'improved',
  }));
  swaps.push({ round: rounds + 1, fromEngineId: 'alpha', toEngineId: 'beta',
    originalContent: 'alpha draft', improvedContent: 'beta revision', reasoning: 'not the winner' });
  mocks.run.mockResolvedValue({
    drafts: [{ engineId: 'alpha', content: 'alpha draft', round: 0 },
      { engineId: 'beta', content: 'beta draft', round: 0 }],
    swaps, scores: [], winner: 'alpha', judgeReasoning: 'chosen final content',
  });
  await handleSynthesis('Design', dispatch, { config: {}, activeEngines: () => ['alpha', 'beta'],
    setActiveAbort, chatSession, registry: {}, adapter: {} } as never);
  const expected = rounds ? `alpha revision ${rounds}` : 'alpha draft';
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block',
    engineId: 'alpha', content: `★ Winner: alpha\n\n${expected}\n\n— Judge —\nchosen final content` }));
  expect(mocks.append).toHaveBeenCalledWith(chatSession, expect.objectContaining({
    role: 'engine', engineId: 'alpha', content: expected,
  }));
  expect(setActiveAbort).toHaveBeenLastCalledWith(null);
});

it('rejects a disabled Synthesis fallback before starting a session job', async () => {
  mocks.available.mockImplementation(() => { throw new Error('Synthesis disabled'); });
  const cb = { ctx: { chatSession: { messages: [] } }, dispatch: vi.fn(), runAsJob: vi.fn() };
  await expect(dispatchOrchestrationIntent({ type: 'synthesis', input: 'Design' }, '/synthesis Design', cb as never))
    .rejects.toThrow('Synthesis disabled');
  expect(mocks.available).toHaveBeenCalledWith('/synthesis');
  expect(cb.runAsJob).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('rejects a queued Synthesis fallback when its selected generation changes', async () => {
  mocks.run.mockResolvedValue({ drafts: [], scores: [], winner: '', judgeReasoning: '' });
  const cb = { ctx: { config: {}, chatSession: { messages: [] }, activeEngines: () => ['alpha', 'beta'],
    setActiveAbort: vi.fn(), registry: {}, adapter: {} }, dispatch: vi.fn(), runAsJob: vi.fn() };
  await dispatchOrchestrationIntent({ type: 'synthesis', input: 'Design' }, '/synthesis Design', cb as never);
  mocks.current.mockImplementation(() => { throw new Error('generation changed'); });
  await expect(cb.runAsJob.mock.calls[0][2](new AbortController().signal)).rejects.toThrow('generation changed');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('clears published progress when the UI controller cancels an active job', async () => {
  vi.useFakeTimers();
  try {
    let progress: unknown = null;
    const dispatch = vi.fn(event => {
      if (event.type === 'progress-update') progress = event.engines;
      if (event.type === 'progress-clear') progress = null;
    });
    let finish!: (result: unknown) => void;
    mocks.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const job = new AbortController();
    const setActiveAbort = vi.fn();
    const pending = handleSynthesis('Design', dispatch, { config: {}, activeEngines: () => ['alpha', 'beta'],
      setActiveAbort, chatSession: { messages: [] }, registry: {}, adapter: {} } as never, { signal: job.signal });
    await vi.advanceTimersByTimeAsync(250);
    expect(progress).not.toBeNull();
    const rejected = expect(pending).rejects.toThrow('UI cancelled');
    setActiveAbort.mock.calls[0][0].abort(new Error('UI cancelled'));
    finish({ drafts: [], swaps: [], scores: [], winner: 'alpha', judgeReasoning: 'late' });
    await rejected;
    expect(job.signal.aborted).toBe(false);
    expect(progress).toBeNull();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it.each(['direct', 'fallback'].flatMap(route => ['before', 'during'].map(phase => ({ route, phase }))))('rejects cancelled Synthesis session without publishing a result: $route/$phase', async ({ route, phase }) => {
  const controller = new AbortController();
  const dispatch = vi.fn();
  const setActiveAbort = vi.fn();
  const ctx = { config: {}, activeEngines: () => ['alpha', 'beta'], setActiveAbort,
    chatSession: { id: 'original', messages: [] }, registry: {}, adapter: {} };
  mocks.run.mockImplementation(async () => {
    controller.abort(new Error('job cancelled'));
    dispatch.mockClear();
    return { drafts: [{ engineId: 'alpha', content: 'late draft', round: 0 }],
      swaps: [], scores: [], winner: 'alpha', judgeReasoning: 'late verdict' };
  });
  if (phase === 'before') controller.abort(new Error('job cancelled'));
  const cb = { ctx, dispatch, runAsJob: vi.fn() };
  if (route === 'fallback') {
    await dispatchOrchestrationIntent({ type: 'synthesis', input: 'Design' }, '/synthesis Design', cb as never);
    expect(cb.runAsJob).toHaveBeenCalledOnce();
  }
  const pending = route === 'direct'
    ? handleSynthesis('Design', dispatch, ctx as never, { signal: controller.signal })
    : cb.runAsJob.mock.calls[0][2](controller.signal);
  await expect(pending).rejects.toThrow('job cancelled');
  expect(mocks.run).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  if (phase === 'during') expect(mocks.run.mock.calls[0][0].signal.aborted).toBe(true);
  expect(dispatch.mock.calls.filter(([event]) => event.type !== 'progress-clear')).toEqual([]);
  expect(dispatch.mock.calls.filter(([event]) => event.type === 'progress-clear')).toHaveLength(phase === 'before' ? 0 : 1);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.track).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});
