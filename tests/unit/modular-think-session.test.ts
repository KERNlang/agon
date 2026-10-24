import { beforeEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const effects = vi.hoisted(() => ({ append: vi.fn(), track: vi.fn(), add: vi.fn(), record: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => {
  const actual = await original<typeof import('@kernlang/agon-core')>();
  return { ...actual, appendMessage: effects.append, tracker: { ...actual.tracker, record: effects.track } };
});
vi.mock('../../packages/cli/src/models/session-results.js', () => ({ sessionResultStore: { add: effects.add } }));
vi.mock('../../packages/cli/src/telemetry/index.js', async original => ({
  ...await original<object>(), recordRun: effects.record, formatRunSummary: () => 'saved summary',
}));
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { runThinkSession } from '../../packages/mod-think/src/session-workflow.js';
import { createMod } from '../../packages/mod-think/src/implementation.js';
import { createThinkHostServices } from '../../packages/mod-think/src/host.js';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';

const result = {
  ok: true, problem: 'Question', strategy: 'linear', engineId: 'alpha',
  thoughts: [{ thoughtNumber: 1, totalThoughts: 1, thought: 'Check the evidence.', kind: 'analysis', nextThoughtNeeded: false }],
  summary: 'A useful conclusion.', openQuestions: ['What remains?'], refinedSpec: '', protocolValid: true,
};
const callbacks = () => ({ dispatch: vi.fn(), ctx: {
  config: {}, activeEngines: () => ['alpha'], chatSession: { id: 'origin' },
  registry: { resolveId: (id: string) => id, activeIds: () => ['alpha'] },
} });
beforeEach(() => vi.resetAllMocks());

it('puts an inactive-critic warning in the Think transcript, not host stderr', async () => {
  const warn = vi.fn();
  const think = createThinkHostServices({
    openRegistry: () => ({ get: id => ({ id }) as EngineDefinition, resolveId: id => id }),
    createAdapter: () => ({ dispatch: async () => ({ engineId: 'alpha', exitCode: 0,
      stdout: JSON.stringify(result), stderr: '', timedOut: false, durationMs: 1 }) }) as EngineAdapter,
    selectEngines: () => ({ activeEngineIds: ['alpha'], defaultEngineIds: ['alpha'] }),
    captureAuthority: () => () => {}, warn,
  });
  let command!: CommandContribution;
  await (await createMod({ think, runs: {
    start: async () => ({ id: 'run', path: '/fixture/run', startedAt: '2026-01-01T00:00:00Z' }), finish: vi.fn(),
  }, receipts: { record: async () => 'receipt' } } as unknown as ModServices)).activate({
    command: (surface, value) => { if (surface === 'tui') command = value; return () => {}; },
    resultType: () => () => {},
  } as Registrar);
  const cb = callbacks();
  await runPhysicalTuiContribution({ owner: { id: 'agon.think' }, payload: command },
    { input: 'Question', critic: 'inactive' }, 'think', cb as never, new AbortController().signal);
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: "[agon] --critic 'inactive' is not an active engine — skipping the adversarial critique." });
  expect(warn).not.toHaveBeenCalled();
  expect(effects.append).toHaveBeenCalledTimes(2);
});

it('retires the second Think session owner', () => {
  expect(existsSync(new URL('../../packages/cli/src/handlers/think.ts', import.meta.url))).toBe(false);
  expect(readFileSync(new URL('../../packages/cli/src/signals/dispatch/intent-orchestration.ts', import.meta.url), 'utf8')).not.toContain('handleThink');
});

it.each([['qwen', 'alpha'], ['kimi', 'minimax', 'alpha']])('filters default engines: %j', async (...engines) => {
  const cb = callbacks();
  cb.ctx.activeEngines = () => engines;
  const run = vi.fn().mockResolvedValue({ exitCode: 0, result });
  await runPhysicalTuiContribution({ owner: { id: 'agon.think' }, payload: { inputSchema: { type: 'object' }, run } },
    { input: 'Question' }, 'think', cb as never, new AbortController().signal);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ engine: 'alpha' }), expect.anything());
});

it('does not execute when every default engine is excluded', async () => {
  const cb = callbacks();
  cb.ctx.activeEngines = () => ['qwen', 'kimi'];
  const run = vi.fn();
  await expect(runPhysicalTuiContribution({ owner: { id: 'agon.think' }, payload: { inputSchema: { type: 'object' }, run } },
    { input: 'Question' }, 'think', cb as never, new AbortController().signal)).rejects.toThrow('No engines available');
  expect(run).not.toHaveBeenCalled();
  expect(effects.append).not.toHaveBeenCalled();
});

it('preserves Think history, result storage and telemetry on the physical TUI path', async () => {
  const cb = callbacks();
  const signal = new AbortController().signal;
  const run = vi.fn().mockResolvedValue({ exitCode: 0, result });
  await runPhysicalTuiContribution({ owner: { id: 'agon.think' }, payload: {
    inputSchema: { type: 'object' }, run,
  } }, { input: 'Question' }, 'think', cb as never, signal);
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][1].signal).toBe(signal);
  expect(effects.append).toHaveBeenCalledTimes(2);
  expect(effects.append).toHaveBeenNthCalledWith(1, cb.ctx.chatSession, expect.objectContaining({ role: 'user', content: '[think] Question' }));
  expect(effects.append).toHaveBeenNthCalledWith(2, cb.ctx.chatSession, expect.objectContaining({ role: 'engine', engineId: 'alpha', content: result.summary }));
  expect(effects.track).toHaveBeenCalledExactlyOnceWith('alpha', { prompt: 'Question', response: result.summary });
  expect(effects.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: 'think', question: 'Question', engines: ['alpha'], winner: 'alpha',
    data: { strategy: 'linear', thoughtCount: 1, summary: result.summary, openQuestions: result.openQuestions },
  }));
  expect(effects.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'think', success: true, winner: 'alpha', completionState: 'completed' }));
  expect(cb.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', engineId: 'alpha', content: result.summary }));
});

it('does not grant Think session effects to an external mod with the same command name', async () => {
  const cb = callbacks();
  await runPhysicalTuiContribution({ owner: { id: 'external.fixture' }, payload: {
    inputSchema: { type: 'object' }, run: async () => ({ exitCode: 0, stdout: 'external' }),
  } }, { input: 'Question' }, 'think', cb as never, new AbortController().signal);
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
  expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info', message: 'external' });
});

function sessionHost() {
  return {
    assertCurrent: vi.fn(), now: () => 1000, defaultEngine: () => 'alpha', dispatch: vi.fn(),
    scheduleEvery: vi.fn(() => vi.fn()), appendMessage: effects.append, track: effects.track,
    addResult: effects.add, recordRun: effects.record,
  };
}

it.each(['cancel', 'replace'])('rejects late results after %s before writing history', async fault => {
  const controller = new AbortController();
  const host = sessionHost();
  await expect(runThinkSession({ input: 'Question' }, { cwd: '/fixture', signal: controller.signal }, host, async () => {
    if (fault === 'cancel') controller.abort(new Error('cancelled'));
    else host.assertCurrent.mockImplementation(() => { throw new Error('generation replaced'); });
    return { exitCode: 0, result };
  })).rejects.toThrow(fault === 'cancel' ? 'cancelled' : 'generation replaced');
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
  expect(host.scheduleEvery.mock.results[0].value).toHaveBeenCalledOnce();
});

it.each([null, {}, { ...result, thoughts: [null] }, { ...result, openQuestions: [1] }])('rejects invalid results before stores: %j', async invalid => {
  await expect(runThinkSession({ input: 'Question' }, { cwd: '/fixture', signal: new AbortController().signal }, sessionHost(),
    async () => ({ exitCode: 0, result: invalid }))).rejects.toThrow('invalid session result');
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
});

it('checks cancellation between the two history writes', async () => {
  const controller = new AbortController();
  effects.append.mockImplementationOnce(() => controller.abort(new Error('cancelled in history')));
  await expect(runThinkSession({ input: 'Question' }, { cwd: '/fixture', signal: controller.signal }, sessionHost(),
    async () => ({ exitCode: 0, result }))).rejects.toThrow('cancelled in history');
  expect(effects.append).toHaveBeenCalledOnce();
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});

it('does not claim completed telemetry after result storage fails', async () => {
  effects.add.mockImplementationOnce(() => { throw new Error('disk full'); });
  await expect(runThinkSession({ input: 'Question' }, { cwd: '/fixture', signal: new AbortController().signal }, sessionHost(),
    async () => ({ exitCode: 0, result }))).rejects.toThrow('disk full');
  expect(effects.append).toHaveBeenCalledTimes(2);
  expect(effects.record).not.toHaveBeenCalled();
});

it('retains the originating chat if the active session changes during execution', async () => {
  const cb = callbacks();
  const origin = cb.ctx.chatSession;
  await runPhysicalTuiContribution({ owner: { id: 'agon.think' }, payload: {
    inputSchema: { type: 'object' }, run: async () => { cb.ctx.chatSession = { id: 'new' }; return { exitCode: 0, result }; },
  } }, { input: 'Question' }, 'think', cb as never, new AbortController().signal);
  expect(effects.append).toHaveBeenNthCalledWith(1, origin, expect.any(Object));
  expect(effects.append).toHaveBeenNthCalledWith(2, origin, expect.any(Object));
});

it.each(['resolve', 'reject'])('does not clear newer progress when a stale invocation %s', async outcome => {
  const host = sessionHost();
  let finish!: (value: { exitCode: number; result: typeof result }) => void;
  let fail!: (error: Error) => void;
  const pending = runThinkSession({ input: 'Question' }, { cwd: '/fixture', signal: new AbortController().signal }, host,
    () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  host.assertCurrent.mockImplementation(() => { throw new Error('generation replaced'); });
  host.dispatch.mockClear();
  const settled = expect(pending).rejects.toThrow();
  if (outcome === 'resolve') finish({ exitCode: 0, result });
  else fail(new Error('old engine failed'));
  await settled;
  expect(host.dispatch).not.toHaveBeenCalled();
  expect(host.scheduleEvery.mock.results[0].value).toHaveBeenCalledOnce();
  expect(effects.append).not.toHaveBeenCalled();
});

it('stops progress while cancelled execution is still pending', async () => {
  const controller = new AbortController();
  const host = sessionHost();
  let tick!: () => void;
  const stop = vi.fn();
  host.scheduleEvery.mockImplementation((callback: () => void) => { tick = callback; return stop; });
  let finish!: (value: { exitCode: number; result: typeof result }) => void;
  const pending = runThinkSession({ input: 'Question' }, { cwd: '/fixture', signal: controller.signal }, host,
    () => new Promise(resolve => { finish = resolve; }));
  controller.abort(new Error('cancel pending engine'));
  host.dispatch.mockClear();
  tick();
  expect(stop).toHaveBeenCalledOnce();
  expect(host.dispatch).not.toHaveBeenCalled();
  const rejected = expect(pending).rejects.toThrow('cancel pending engine');
  finish({ exitCode: 0, result });
  await rejected;
  expect(stop).toHaveBeenCalledOnce();
  expect(effects.append).not.toHaveBeenCalled();
});

it('keeps the completed chain visible and stored when only the receipt failed', async () => {
  const host = sessionHost();
  await expect(runThinkSession({ input: 'Question' }, { cwd: '/fixture', signal: new AbortController().signal }, host,
    async () => ({ exitCode: 1, result, stderr: 'Receipt failed at /fixture/run. Inspect before retrying.',
      failure: { code: 'THINK_RECEIPT_FAILED', message: 'Receipt failed at /fixture/run.' } }))).rejects.toThrow('Receipt failed');
  expect(host.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: result.summary }));
  expect(effects.append).toHaveBeenCalledTimes(2);
  expect(effects.add).toHaveBeenCalledOnce();
  expect(effects.record).not.toHaveBeenCalled();
});
