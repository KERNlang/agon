import { beforeEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ append: vi.fn(), track: vi.fn(), add: vi.fn(), record: vi.fn(), command: vi.fn(), current: vi.fn() }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => {
  const record = { id: 'tuiSlashCommands:0063', kind: 'intent', owner: { id: 'agon.synthesis' },
    payload: { inputSchema: { type: 'object' }, run: effects.command } };
  return { ...await original<object>(),
    captureProcessSurfaceAuthority: () => effects.current,
    processSurfaceClient: () => ({ assertAvailable: () => record, project: () => ({ entries: [record] }) }) };
});
vi.mock('@kernlang/agon-core', async original => {
  const actual = await original<typeof import('@kernlang/agon-core')>();
  return { ...actual, appendMessage: effects.append, tracker: { ...actual.tracker, record: effects.track } };
});
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: effects.add } }));
vi.mock('../../packages/cli/src/telemetry/index.js', async original => ({
  ...await original<object>(), recordRun: effects.record, formatRunSummary: () => 'saved summary',
}));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(), withThreadOutcome: (_cwd: string, _mode: string, _label: string, run: () => Promise<unknown>) => run,
  collectRecentEngineContext: () => '',
}));
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { createMod } from '../../packages/mod-synthesis/src/implementation.js';
import type { IntentContribution, Registrar } from '@kernlang/agon-mod-api';

beforeEach(() => vi.resetAllMocks());

it('retains the winning Synthesis revision in the interactive session through generated routing', async () => {
  const original = { id: 'original', messages: [] };
  const cb = { dispatch: vi.fn(), runAsJob: vi.fn(), ctx: { config: {},
    activeEngines: () => ['alpha', 'beta'], chatSession: original, setActiveAbort: vi.fn() } };
  effects.command.mockResolvedValue({ exitCode: 0, result: {
    prompt: 'Design', drafts: [{ engineId: 'alpha', content: 'initial draft', round: 0 },
      { engineId: 'beta', content: 'other draft', round: 0 }],
    swaps: [{ round: 1, fromEngineId: 'beta', toEngineId: 'alpha', originalContent: 'other draft',
      improvedContent: 'winning revision', reasoning: 'improved' }],
    scores: [{ engineId: 'alpha', score: 90 }], winner: 'alpha', judgeReasoning: 'selected',
  } });
  await dispatchIntent({ type: 'synthesis', _modSurface: { publicId: 'synthesis',
    registryId: 'tuiSlashCommands:0063', kind: 'intent', value: { input: 'Design', swaps: 1, judge: 'beta' } } },
  '/synthesis Design --swaps 1', cb as never);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  await cb.runAsJob.mock.calls[0][2](new AbortController().signal);
  expect(effects.command).toHaveBeenCalledOnce();
  expect(effects.command.mock.calls[0][0]).toMatchObject({ judge: 'beta' });
  expect(effects.append).toHaveBeenCalledWith(original, expect.objectContaining({
    role: 'engine', engineId: 'alpha', content: 'winning revision',
  }));
  expect(effects.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'synthesis', winner: 'alpha' }));
  expect(effects.record).toHaveBeenCalledWith(expect.objectContaining({ mode: 'synthesis', success: true }));
});

const winnerResult = { prompt: 'Design', drafts: [{ engineId: 'alpha', content: 'draft', round: 0 }],
  swaps: [], scores: [{ engineId: 'alpha', score: 90 }], winner: 'alpha', judgeReasoning: 'selected' };
function callbacks() {
  return { dispatch: vi.fn(), ctx: { config: {}, activeEngines: () => ['alpha', 'beta'],
    chatSession: { id: 'original', messages: [] }, setActiveAbort: vi.fn() } };
}
function runSession(cb: ReturnType<typeof callbacks>, signal: AbortSignal, owner = 'agon.synthesis') {
  return runPhysicalTuiContribution({ owner: { id: owner }, payload: {
    inputSchema: { type: 'object' }, run: effects.command,
  } }, { input: 'Design', swaps: 1 }, 'synthesis', cb as never, signal);
}

it('propagates a failed generated Synthesis command to the background job', async () => {
  const cb = { ...callbacks(), runAsJob: vi.fn() };
  effects.command.mockResolvedValue({ exitCode: 1, stderr: 'judge failed' });
  await dispatchIntent({ type: 'synthesis', _modSurface: { publicId: 'synthesis',
    registryId: 'tuiSlashCommands:0063', kind: 'intent', value: { input: 'Design' } } },
  '/synthesis Design', cb as never);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  await expect(cb.runAsJob.mock.calls[0][2](new AbortController().signal)).rejects.toThrow('judge failed');
  expect(effects.record).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
});

it('saves to the captured chat when the user switches sessions during execution', async () => {
  const cb = callbacks();
  const original = cb.ctx.chatSession;
  effects.command.mockImplementation(async () => {
    cb.ctx.chatSession = { id: 'new', messages: [] };
    return { exitCode: 0, result: winnerResult };
  });
  await runSession(cb, new AbortController().signal);
  expect(effects.command.mock.calls[0][0]).toMatchObject({ engines: 'alpha,beta' });
  expect(effects.append).toHaveBeenCalledTimes(2);
  expect(effects.append.mock.calls.every(([session]) => session === original)).toBe(true);
});

it.each(['before', 'during', 'stale'])('does not save an unauthorized Synthesis result: %s', async phase => {
  const cb = callbacks();
  const controller = new AbortController();
  if (phase === 'before') controller.abort(new Error('cancelled'));
  effects.command.mockImplementation(async () => {
    if (phase === 'during') controller.abort(new Error('cancelled'));
    if (phase === 'stale') effects.current.mockImplementation(() => { throw new Error('generation changed'); });
    return { exitCode: 0, result: winnerResult };
  });
  await expect(runSession(cb, controller.signal)).rejects.toThrow(phase === 'stale' ? 'generation changed' : 'cancelled');
  expect(effects.command).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
  expect(cb.dispatch.mock.calls.filter(([event]) => event.type === 'engine-block')).toHaveLength(0);
});

it.each([
  { exitCode: 1, stderr: 'judge failed' },
  { exitCode: 0, result: { ...winnerResult, drafts: null } },
  { exitCode: 0, result: { ...winnerResult, winner: 'unknown-engine' } },
  { exitCode: 0, result: { ...winnerResult, scores: [{ engineId: 'alpha', score: Infinity }] } },
])('rejects failed or malformed results without session persistence: %j', async output => {
  effects.command.mockResolvedValue(output);
  await expect(runSession(callbacks(), new AbortController().signal)).rejects.toThrow();
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});

it('records a no-winner outcome without inventing a winning chat response', async () => {
  const cb = callbacks();
  effects.command.mockResolvedValue({ exitCode: 0, result: { ...winnerResult, winner: '' } });
  await runSession(cb, new AbortController().signal);
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Synthesis produced no winner.' });
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.add).toHaveBeenCalledWith(expect.objectContaining({ winner: null }));
  expect(effects.record).toHaveBeenCalledWith(expect.objectContaining({ success: false, winner: undefined }));
});

it('does not give session effects to an external command named synthesis', async () => {
  effects.command.mockResolvedValue({ exitCode: 0, result: winnerResult });
  await runSession(callbacks(), new AbortController().signal, 'external.fixture');
  expect(effects.command).toHaveBeenCalledOnce();
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});

it.each(['cancelled', 'stale'])('disposes pending progress safely when the invocation becomes %s', async state => {
  vi.useFakeTimers();
  try {
    const cb = callbacks();
    const controller = new AbortController();
    let finish!: (value: unknown) => void;
    effects.command.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = runSession(cb, controller.signal);
    const rejected = expect(pending).rejects.toThrow(state);
    await vi.advanceTimersByTimeAsync(250);
    expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'progress-update' }));
    if (state === 'cancelled') controller.abort(new Error(state));
    else effects.current.mockImplementation(() => { throw new Error(state); });
    await vi.advanceTimersByTimeAsync(250);
    const clearsBeforeSettlement = cb.dispatch.mock.calls.filter(([event]) => event.type === 'progress-clear').length;
    const timersBeforeSettlement = vi.getTimerCount();
    finish({ exitCode: 0, result: winnerResult });
    await rejected;
    expect(clearsBeforeSettlement).toBe(state === 'cancelled' ? 1 : 0);
    expect(timersBeforeSettlement).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(cb.dispatch.mock.calls.filter(([event]) => event.type === 'progress-clear')).toHaveLength(state === 'cancelled' ? 1 : 0);
    expect(effects.record).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('parses and runs the real Synthesis contribution with the session-selected engines', async () => {
  let contribution: IntentContribution | undefined;
  const dispatch = vi.fn(async (engine: string, prompt: string) => ({ exitCode: 0, stderr: '',
    stdout: prompt.includes('SCORE_N')
      ? 'SCORE_1: 90\nSCORE_2: 80\nWINNER: alpha\nREASONING: selected'
      : prompt.includes('DRAFT BY') ? `${engine} improved\n## REASONING\nclearer` : `${engine} initial`,
  }));
  const record = vi.fn();
  const mod = createMod({ engines: { listActive: async () => ['wrong-default'], dispatch },
    receipts: { record },
  } as never);
  await mod.activate({
    command: (surface, value) => { if (surface === 'tui') contribution = value as IntentContribution; return () => {}; },
    tool: () => () => {}, resultType: () => () => {}, config: () => () => {},
  } as Registrar);
  expect(contribution).toBeDefined();
  const parsed = await contribution!.parse!('/synthesis Design --swaps 1');
  expect(parsed).toEqual({ input: 'Design', swaps: 1 });
  const cb = callbacks();
  await runPhysicalTuiContribution({ owner: { id: 'agon.synthesis' }, payload: contribution },
    parsed as never, 'synthesis', cb as never, new AbortController().signal);
  expect(new Set(dispatch.mock.calls.map(([engine]) => engine))).toEqual(new Set(['alpha', 'beta']));
  expect(record).toHaveBeenCalledOnce();
  expect(effects.append).toHaveBeenLastCalledWith(cb.ctx.chatSession,
    expect.objectContaining({ role: 'engine', engineId: 'alpha', content: 'alpha improved' }));
  expect(effects.add).toHaveBeenCalledOnce();
});
