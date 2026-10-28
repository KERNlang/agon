import { beforeEach, expect, it, vi } from 'vitest';
import type { IntentContribution, Registrar } from '@kernlang/agon-mod-api';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));

const effects = vi.hoisted(() => ({ append: vi.fn(), track: vi.fn(), add: vi.fn(), record: vi.fn(), command: vi.fn(), current: vi.fn() }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => {
  const record = { id: 'tuiSlashCommands:0055', kind: 'intent', owner: { id: 'agon.research' },
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
import { handleResearch } from '../../packages/cli/src/handlers/research.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { createMod } from '../../packages/mod-research/src/implementation.js';

beforeEach(() => vi.resetAllMocks());

const grounded = { ok: true, question: 'npm parser', intent: 'package', engineId: 'alpha', answer: 'Claim [1].',
  sources: [{ title: 'Package', url: 'https://www.npmjs.com/package/parser', snippet: 'Parser', fetched: true }],
  citations: { total: 1, verified: 1, blocked: 0, results: [] } };
function callbacks() {
  return { dispatch: vi.fn(), ctx: { config: {}, activeEngines: () => ['alpha'],
    registry: { resolveId: (id: string) => id, activeIds: () => ['alpha'] },
    chatSession: { id: 'original', messages: [] }, setActiveAbort: vi.fn() } };
}
function runSession(cb: ReturnType<typeof callbacks>, signal: AbortSignal, owner = 'agon.research') {
  return runPhysicalTuiContribution({ owner: { id: owner }, payload: {
    inputSchema: { type: 'object' }, run: effects.command,
  } }, { question: 'npm parser' }, 'research', cb as never, signal);
}

it.each(['before', 'during', 'ui'])('preserves compatibility-handler cancellation: %s', async phase => {
  const cb = callbacks();
  const caller = new AbortController();
  const reason = new Error('cancelled');
  if (phase === 'before') caller.abort(reason);
  effects.command.mockImplementation(async () => {
    if (phase === 'during') caller.abort(reason);
    if (phase === 'ui') cb.ctx.setActiveAbort.mock.calls[0][0].abort(reason);
    return { exitCode: 0, result: grounded };
  });
  await expect(handleResearch('npm parser', cb.dispatch, cb.ctx as never,
    { signal: caller.signal })).rejects.toBe(reason);
  expect(effects.command).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
  if (phase === 'before') expect(cb.ctx.setActiveAbort).not.toHaveBeenCalled();
  else expect(cb.ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  if (phase === 'ui') expect(caller.signal.aborted).toBe(false);
});

it('preserves successful compatibility-handler execution and cleanup', async () => {
  const cb = callbacks();
  effects.command.mockResolvedValue({ exitCode: 0, result: grounded });
  await handleResearch('npm parser', cb.dispatch, cb.ctx as never);
  expect(effects.command).toHaveBeenCalledOnce();
  expect(effects.append).toHaveBeenCalledTimes(2);
  expect(effects.add).toHaveBeenCalledOnce();
  expect(effects.record).toHaveBeenCalledOnce();
  expect(cb.ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
});

it('saves only to the captured chat when the user switches sessions', async () => {
  const cb = callbacks();
  const original = cb.ctx.chatSession;
  effects.command.mockImplementation(async () => {
    cb.ctx.chatSession = { id: 'new', messages: [] };
    return { exitCode: 0, result: grounded };
  });
  await runSession(cb, new AbortController().signal);
  expect(effects.append).toHaveBeenCalledTimes(2);
  expect(effects.append.mock.calls.every(([session]) => session === original)).toBe(true);
});

it.each(['before', 'during', 'stale'])('does not persist unauthorized results: %s', async phase => {
  const controller = new AbortController();
  if (phase === 'before') controller.abort(new Error('cancelled'));
  effects.command.mockImplementation(async () => {
    if (phase === 'during') controller.abort(new Error('cancelled'));
    if (phase === 'stale') effects.current.mockImplementation(() => { throw new Error('stale'); });
    return { exitCode: 0, result: grounded };
  });
  await expect(runSession(callbacks(), controller.signal)).rejects.toThrow(phase === 'stale' ? 'stale' : 'cancelled');
  expect(effects.command).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});

it.each(['cancelled', 'stale'])('cleans up pending progress without overwriting newer output: %s', async state => {
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
    const timers = vi.getTimerCount();
    const clears = cb.dispatch.mock.calls.filter(([event]) => event.type === 'progress-clear').length;
    finish({ exitCode: 0, result: grounded });
    await rejected;
    expect(timers).toBe(0);
    expect(clears).toBe(state === 'cancelled' ? 1 : 0);
    expect(effects.append).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it.each([{ ...grounded, sources: null }, { ...grounded, answer: '' },
  { ...grounded, citations: { ...grounded.citations, verified: Infinity } }])('rejects malformed output before persistence', async result => {
  effects.command.mockResolvedValue({ exitCode: 0, result });
  await expect(runSession(callbacks(), new AbortController().signal)).rejects.toThrow('invalid session result');
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.add).not.toHaveBeenCalled();
});

it('does not grant session effects to an external contribution named research', async () => {
  effects.command.mockResolvedValue({ exitCode: 0, result: grounded });
  await runSession(callbacks(), new AbortController().signal, 'external.fixture');
  expect(effects.command).toHaveBeenCalledOnce();
  expect(effects.append).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});

it.each(['alias', 'missing'])('preserves forced-engine selection and unavailable-engine fallback: %s', async engine => {
  const cb = { ...callbacks(), ctx: { ...callbacks().ctx,
    registry: { resolveId: (id: string) => id === 'alias' ? 'alpha' : id, activeIds: () => ['alpha'] } } };
  effects.command.mockResolvedValue({ exitCode: 0, result: grounded });
  await runPhysicalTuiContribution({ owner: { id: 'agon.research' }, payload: {
    inputSchema: { type: 'object' }, run: effects.command,
  } }, { question: 'npm parser', engine }, 'research', cb as never, new AbortController().signal);
  expect(effects.command.mock.calls[0][0]).toMatchObject({ engine: engine === 'alias' ? 'alpha' : '', engines: 'alpha' });
  if (engine === 'missing') expect(cb.dispatch).toHaveBeenCalledWith({ type: 'info',
    message: "Engine 'missing' is not available — using rating-based selection." });
});

it('runs the real parsed contribution through discovery, citation verification and session storage', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ objects: [{ package: { name: 'parser', description: 'Parser',
      links: { npm: 'https://www.npmjs.com/package/parser' } } }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response('Package evidence', { status: 200 }))
    .mockResolvedValueOnce(new Response('Package evidence', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  try {
    let contribution: IntentContribution | undefined;
    const dispatch = vi.fn(async () => ({ exitCode: 0, stdout: 'Claim [1].' }));
    const mod = createMod({ permissions: { check: async () => 'allow' },
      engines: { listActive: async () => ['alpha'], dispatch }, receipts: { record: async () => 'receipt' },
    } as never);
    await mod.activate({
      command: (surface, value) => { if (surface === 'tui') contribution = value as IntentContribution; return () => {}; },
      resultType: () => () => {}, config: () => () => {}, tool: () => () => {},
    } as Registrar);
    expect(contribution).toBeDefined();
    const parsed = await contribution!.parse!('/research npm parser --count 1 --engine alpha');
    effects.command.mockImplementation((input, context) => contribution!.run(input, context));
    const cb = { ...callbacks(), runAsJob: vi.fn() };
    await dispatchIntent({ type: 'research', _modSurface: { publicId: 'research',
      registryId: 'tuiSlashCommands:0055', kind: 'intent', value: parsed } },
    '/research npm parser --count 1 --engine alpha', cb as never);
    await cb.runAsJob.mock.calls[0][2](new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(dispatch.mock.calls[0][0]).toBe('alpha');
    expect(effects.append).toHaveBeenCalledWith(cb.ctx.chatSession, expect.objectContaining({ role: 'engine', content: 'Claim [1].' }));
    expect(effects.add).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ citationsVerified: 1, citationsTotal: 1 }) }));
  } finally { vi.unstubAllGlobals(); }
});

it('retains a grounded Research answer in the interactive session through generated routing', async () => {
  const original = { id: 'original', messages: [] };
  const cb = { dispatch: vi.fn(), runAsJob: vi.fn(), ctx: { config: {},
    registry: { resolveId: (id: string) => id, activeIds: () => ['alpha'] },
    activeEngines: () => ['alpha'], chatSession: original, setActiveAbort: vi.fn() } };
  const answer = 'The package exports a parser [1].';
  effects.command.mockResolvedValue({ exitCode: 0, result: {
    ok: true, question: 'npm parser', intent: 'package', engineId: 'alpha', answer,
    sources: [{ title: 'Package', url: 'https://www.npmjs.com/package/parser', snippet: 'Parser', fetched: true }],
    citations: { total: 1, verified: 1, blocked: 0, rejected: 0, invalidNumbers: [], results: [] },
  } });
  await dispatchIntent({ type: 'research', _modSurface: { publicId: 'research',
    registryId: 'tuiSlashCommands:0055', kind: 'intent', value: { question: 'npm parser', engine: 'alpha', count: 1,
      engines: 'alpha', timeout: '42', label: 'research-fixture' } } },
  '/research npm parser --engine alpha --count 1', cb as never);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  await cb.runAsJob.mock.calls[0][2](new AbortController().signal);
  expect(effects.command).toHaveBeenCalledOnce();
  // The command schema uses text options; the slash parser supplies a number.
  expect(effects.command.mock.calls[0][0]).toMatchObject({ engine: 'alpha', count: '1',
    engines: 'alpha', timeout: '42', label: 'research-fixture' });
  expect(effects.append).toHaveBeenCalledWith(original, expect.objectContaining({
    role: 'engine', engineId: 'alpha', content: answer,
  }));
  expect(effects.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'research', winner: 'alpha' }));
  expect(effects.record).toHaveBeenCalledWith(expect.objectContaining({ mode: 'research', success: true }));
});

it('records a fresh failure note and rejects the job when research cannot ground its answer', async () => {
  const original = { id: 'original', messages: [] };
  const cb = { dispatch: vi.fn(), runAsJob: vi.fn(), ctx: { config: {},
    activeEngines: () => ['alpha'], chatSession: original, setActiveAbort: vi.fn() } };
  effects.command.mockResolvedValue({ exitCode: 1, stdout: '{"ok":false}', result: {
    ok: false, question: 'npm parser', intent: 'package', engineId: 'alpha', answer: 'Unsupported claim [2].',
    sources: [{ title: 'Package', url: 'https://www.npmjs.com/package/parser', snippet: 'Parser', fetched: true }],
    citations: { total: 1, verified: 0, blocked: 0, rejected: 1, invalidNumbers: [2], results: [] },
    note: 'Citation verification failed',
  } });
  await dispatchIntent({ type: 'research', _modSurface: { publicId: 'research',
    registryId: 'tuiSlashCommands:0055', kind: 'intent', value: { question: 'npm parser' } } },
  '/research npm parser', cb as never);
  expect(cb.runAsJob).toHaveBeenCalledOnce();
  await expect(cb.runAsJob.mock.calls[0][2](new AbortController().signal)).rejects.toThrow('Citation verification failed');
  expect(effects.append).toHaveBeenCalledWith(original, expect.objectContaining({
    role: 'engine', content: expect.stringContaining('Research found no grounded answer.'),
  }));
  expect(effects.add).not.toHaveBeenCalled();
  expect(effects.track).not.toHaveBeenCalled();
  expect(effects.record).not.toHaveBeenCalled();
});
