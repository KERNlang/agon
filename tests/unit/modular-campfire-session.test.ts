import { beforeEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), append: vi.fn(), track: vi.fn(), add: vi.fn(), record: vi.fn(), scan: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => {
  const actual = await original<typeof import('@kernlang/agon-core')>();
  return { ...actual, scanProjectContext: mocks.scan, appendMessage: mocks.append,
    tracker: { ...actual.tracker, record: mocks.track } };
});
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: mocks.add } }));
vi.mock('../../packages/cli/src/telemetry/index.js', async original => ({ ...await original<object>(), recordRun: mocks.record, formatRunSummary: () => 'saved summary' }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => ({ ...await original<object>(), executeProcessCesarRoute: mocks.execute }));
vi.mock('../../packages/cli/src/signals/dispatch/delegation.js', async original => ({
  ...await original<object>(), withThreadOutcome: (_cwd: string, _mode: string, _label: string, run: () => Promise<unknown>) => run,
  collectRecentEngineContext: () => '', shouldAutoContinueDelegatedResult: () => false,
}));
vi.mock('../../packages/cli/src/handlers/cesar-brain.js', async original => ({
  ...await original<object>(), handleCesarBrain: async () => ({ responded: false, delegated: false }),
}));
vi.mock('../../packages/cli/src/cesar/session.js', async original => ({
  ...await original<object>(), resolveCesarBackend: () => ({ backend: 'cli', engine: { id: 'fixture' } }), buildCesarSystemPrompt: () => 'fixture',
}));
import { runPhysicalCesarWorkflow, handleDelegatedAction, handleRecoveredDelegation, runCesarBrainFallback } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { dispatchOrchestrationIntent } from '../../packages/cli/src/signals/dispatch/intent-orchestration.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { runCampfireSession } from '../../packages/mod-campfire/src/session-workflow.js';

const result = { topic: 'Question', rounds: [{ engineId: 'alpha', content: 'A useful perspective.' }] };
const callbacks = () => ({ dispatch: vi.fn(), ctx: { config: {}, activeEngines: () => ['alpha', 'beta'], chatSession: { id: 'fixture' } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scan.mockReturnValue('project evidence');
  mocks.execute.mockResolvedValue({ exitCode: 0, result, stdout: JSON.stringify(result) });
});

it.each(['tui', 'cesar'])('uses selected %s Campfire execution and records individual responses', async surface => {
  const cb = callbacks();
  const signal = new AbortController().signal;
  if (surface === 'cesar') await runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, cb as never, signal, '/selected-cwd');
  else await runPhysicalTuiContribution({ owner: { id: 'agon.campfire' }, payload: {
    inputSchema: { type: 'object' }, run: (input: unknown, context: unknown) => mocks.execute('campfire', input, context),
  } }, { topic: 'Question' }, 'campfire', cb as never, signal);
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('campfire', expect.objectContaining({
    topic: 'Question', context: 'project evidence', engines: 'alpha,beta', strategy: 'all-respond',
  }), expect.objectContaining({ signal }));
  if (surface === 'cesar') expect(mocks.execute.mock.calls[0][2].cwd).toBe('/selected-cwd');
  expect(mocks.append).toHaveBeenCalledExactlyOnceWith(cb.ctx.chatSession, expect.objectContaining({ role: 'engine', engineId: 'alpha', content: 'A useful perspective.' }));
  expect(mocks.track).toHaveBeenCalledExactlyOnceWith('alpha', { prompt: 'Question', response: 'A useful perspective.' });
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'campfire', question: 'Question', engines: ['alpha', 'beta'], winner: null, data: { rounds: result.rounds } }));
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'campfire', success: true, completionState: 'completed' }));
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', engineId: 'alpha', content: 'A useful perspective.' }));
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('does not record late responses after job cancellation', async () => {
  const cb = callbacks();
  const controller = new AbortController();
  mocks.execute.mockImplementationOnce(async () => { controller.abort(new Error('job cancelled')); return { exitCode: 0, result }; });
  await expect(runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, cb as never, controller.signal)).rejects.toThrow('job cancelled');
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(cb.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block' }));
});

it.each(['disabled', 'generation replaced'])('does not save a result when execution is %s', async reason => {
  mocks.execute.mockRejectedValueOnce(new Error(reason));
  const cb = callbacks();
  await expect(runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, cb as never)).rejects.toThrow(reason);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenLastCalledWith({ type: 'progress-clear' });
});

it('does not grant Campfire session effects to an external mod with the same public name', async () => {
  const cb = callbacks();
  await runPhysicalTuiContribution({ owner: { id: 'external.fixture' }, payload: {
    inputSchema: { type: 'object' }, run: async () => ({ exitCode: 0, stdout: 'external' }),
  } }, { topic: 'Question' }, 'campfire', cb as never, new AbortController().signal);
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'external' });
});

it('reports a partial store failure without recording completed telemetry', async () => {
  mocks.add.mockImplementationOnce(() => { throw new Error('store full'); });
  const cb = callbacks();
  await expect(runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, cb as never)).rejects.toThrow('store full');
  expect(mocks.append).toHaveBeenCalledOnce();
  expect(mocks.track).toHaveBeenCalledOnce();
  expect(mocks.add).toHaveBeenCalledOnce();
  expect(mocks.record).not.toHaveBeenCalled();
});

it('checks cancellation between history and result writes', async () => {
  const controller = new AbortController();
  mocks.append.mockImplementationOnce(() => controller.abort(new Error('cancelled during history')));
  await expect(runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, callbacks() as never, controller.signal)).rejects.toThrow('cancelled during history');
  expect(mocks.append).toHaveBeenCalledOnce();
  expect(mocks.track).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

it('keeps a saved completion when optional summary display fails', async () => {
  const cb = callbacks();
  cb.dispatch.mockImplementation(event => { if (event.type === 'info' && event.message === 'saved summary') throw new Error('display closed'); });
  await expect(runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, cb as never)).resolves.toEqual(result);
  expect(mocks.record).toHaveBeenCalledOnce();
});

it.each([null, {}, { rounds: [{}] }, { rounds: [null] }])('rejects invalid result %j before history writes', async invalid => {
  mocks.execute.mockResolvedValueOnce({ exitCode: 0, result: invalid });
  await expect(runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, callbacks() as never)).rejects.toThrow('invalid session result');
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
});

it('retires the legacy Campfire session owner', () => {
  expect(existsSync(new URL('../../packages/cli/src/handlers/campfire.ts', import.meta.url))).toBe(false);
  const source = readFileSync(new URL('../../packages/cli/src/signals/dispatch/intent-orchestration.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('handleCampfire');
});

it('keeps history attached to the originating session', async () => {
  const cb = callbacks();
  const original = cb.ctx.chatSession;
  mocks.execute.mockImplementationOnce(async () => {
    cb.ctx.chatSession = { id: 'replacement' };
    return { exitCode: 0, result };
  });
  await runPhysicalCesarWorkflow('campfire', { topic: 'Question' }, cb as never);
  expect(mocks.append).toHaveBeenCalledWith(original, expect.any(Object));
});

it('records the same normalized positional topic that execution receives', async () => {
  await runPhysicalCesarWorkflow('campfire', { topic: ' Explain ', _: [' Explain ', 'caching'] }, callbacks() as never);
  expect(mocks.execute).toHaveBeenCalledWith('campfire', expect.objectContaining({ topic: 'Explain caching', _: [] }), expect.any(Object));
  expect(mocks.track).toHaveBeenCalledWith('alpha', expect.objectContaining({ prompt: 'Explain caching' }));
  expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ question: 'Explain caching' }));
});

it('contains interval display failures and stops progress while execution settles', async () => {
  let tick!: () => void;
  let finish!: (value: { exitCode: number; result: typeof result }) => void;
  const stop = vi.fn();
  const dispatch = vi.fn(event => { if (event.type === 'progress-update') throw new Error('display closed'); });
  const pending = runCampfireSession({ topic: 'Question' }, new AbortController().signal, {
    cwd: () => '/fixture', hasSession: () => true, defaultEngines: () => ({ active: ['alpha'], excluded: [] }),
    scanContext: () => '', now: () => 1000, dispatch,
    scheduleEvery: callback => { tick = callback; return stop; },
    appendMessage: mocks.append, track: mocks.track, addResult: mocks.add, recordRun: mocks.record,
  }, () => new Promise(resolve => { finish = resolve; }));
  expect(() => tick()).not.toThrow();
  expect(stop).toHaveBeenCalledOnce();
  finish({ exitCode: 0, result });
  await expect(pending).resolves.toEqual(result);
  expect(stop).toHaveBeenCalledOnce();
});

it.each(['intent', 'delegated', 'recovered', 'fallback'])('forwards the actual %s job signal to Campfire', async route => {
  const cb = { ...callbacks(), runAsJob: vi.fn(), askQuestion: vi.fn().mockResolvedValue('y') };
  Object.assign(cb.ctx, { cesar: {}, chatSession: { id: 'fixture', messages: [] },
    adapter: { dispatch: vi.fn().mockResolvedValue({ stdout: '[SUGGEST:campfire] Discuss this.' }) }, setCesarSession: vi.fn() });
  if (route === 'intent') await dispatchOrchestrationIntent({ type: 'campfire', topic: 'Question' }, 'Question', cb as never);
  else if (route === 'delegated') await handleDelegatedAction({ action: 'campfire', task: 'Question' }, 'Question', cb as never);
  else if (route === 'recovered') await handleRecoveredDelegation({ action: 'campfire', task: 'Question', createdAt: Date.now() }, 'Question', cb as never);
  else await runCesarBrainFallback('Question', cb as never, null, false);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  const signal = new AbortController().signal;
  const previousMessages = mocks.append.mock.calls.length;
  await cb.runAsJob.mock.calls[0][2](signal);
  expect(mocks.execute).toHaveBeenCalledOnce();
  expect(mocks.execute.mock.calls[0][2].signal).toBe(signal);
  expect(mocks.append).toHaveBeenCalledTimes(previousMessages + 1);
  expect(mocks.append).toHaveBeenLastCalledWith(cb.ctx.chatSession, expect.objectContaining({ engineId: 'alpha', content: 'A useful perspective.' }));
});
