// Cleanup failure can land while the brain awaits its context-budget gate or
// session acquisition (telemetry handoff, auto-compaction, recovery). The
// router's outer guard cannot retract an adapter launch the brain already made,
// so the brain itself must re-check the entry and current sessions at each of
// those boundaries and refuse replacement work.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startChatSession } from '@kernlang/agon-core';
import { handleCesarBrain } from '../../packages/cli/src/cesar/brain.js';
import { markSessionCleanupFailed, sessionCleanupFailed } from '../../packages/cli/src/cesar/session-health.js';

const { budget, ensure, backend } = vi.hoisted(() => ({ budget: vi.fn(), ensure: vi.fn(), backend: vi.fn() }));
vi.mock('../../packages/cli/src/cesar/context-budget.js', async original => {
  const real = await original<typeof import('../../packages/cli/src/cesar/context-budget.js')>();
  return { ...real, enforceContextBudget: budget };
});
vi.mock('../../packages/cli/src/cesar/session.js', async original => {
  const real = await original<typeof import('../../packages/cli/src/cesar/session.js')>();
  return { ...real, ensureCesarSession: ensure, resolveCesarBackend: backend, buildCesarSystemPrompt: () => 'fixture system prompt' };
});

const CLEANUP_WARNING = expect.objectContaining({ type: 'warning', message: expect.stringContaining('Session cleanup previously failed') });

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function createFixtureSession(engineId = 'fixture') {
  return {
    alive: true,
    engineId,
    close: vi.fn(),
    send: vi.fn(async function* () { yield { type: 'done', content: 'end_turn' }; }),
  } as any;
}

function createFixtureContext(session: unknown) {
  const ctx: any = {
    config: { cesarEngine: 'fixture', cesarToolTimeline: false },
    chatSession: startChatSession(),
    cesarSession: session,
    adapter: { dispatch: vi.fn().mockResolvedValue({ stdout: 'fixture fallback answer', stderr: '' }) },
    registry: { get: vi.fn(() => ({ id: 'fixture' })) },
    activeEngines: () => ['fixture'],
    setActiveAbort: vi.fn(),
  };
  ctx.setCesarSession = vi.fn((value: unknown) => { ctx.cesarSession = value; });
  return ctx;
}

function expectRefusedTurn(ctx: any, dispatch: ReturnType<typeof vi.fn>, outcome: any) {
  expect(outcome).toMatchObject({ terminalState: 'failed', decisionReason: 'session-cleanup-failed', delegated: false, responded: false });
  expect(ctx.adapter.dispatch).not.toHaveBeenCalled();
  expect(dispatch.mock.calls.filter(([event]) => event?.type === 'warning' && String(event.message).includes('Session cleanup previously failed'))).toHaveLength(1);
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'spinner-update' }));
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'spinner-stop' });
  expect(ctx.cesar.busy).toBe(false);
  expect(ctx.cesar.abortSignal).toBeNull();
  expect(ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  expect(ctx.chatSession.messages).toEqual([]);
}

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  budget.mockReset().mockResolvedValue({ proceed: true, compacted: false });
  ensure.mockReset().mockRejectedValue(new Error('fixture acquisition must not run'));
  backend.mockReset().mockReturnValue({ backend: 'cli', engine: { id: 'fixture' } });
});

describe('budget-gate boundary', () => {
  it.each(['resolved', 'rejected'])('refuses when the attached session fails during the gate (%s)', async outcome => {
    const original = createFixtureSession();
    const ctx = createFixtureContext(original);
    const gate = createDeferred<{ proceed: boolean; compacted: boolean }>();
    budget.mockReturnValue(gate.promise);
    ensure.mockImplementation(async () => { throw new Error('Session cleanup previously failed. Restart Agon before retrying; the previous provider session may not have stopped.'); });
    const dispatch = vi.fn();
    const pending = handleCesarBrain('prompt', dispatch, ctx);
    await vi.waitFor(() => expect(budget).toHaveBeenCalledOnce());
    markSessionCleanupFailed(original);
    if (outcome === 'rejected') gate.reject(new Error('fixture gate failure'));
    else gate.resolve({ proceed: true, compacted: false });
    expectRefusedTurn(ctx, dispatch, await pending);
    expect(original.send).not.toHaveBeenCalled();
  });

  it.each(['detached', 'replaced'])('refuses when the entry session fails after being %s', async change => {
    const original = createFixtureSession();
    const replacement = createFixtureSession();
    const ctx = createFixtureContext(original);
    const gate = createDeferred<{ proceed: boolean; compacted: boolean }>();
    budget.mockReturnValue(gate.promise);
    ensure.mockImplementation(async () => replacement);
    const dispatch = vi.fn();
    const pending = handleCesarBrain('prompt', dispatch, ctx);
    await vi.waitFor(() => expect(budget).toHaveBeenCalledOnce());
    ctx.cesarSession = change === 'replaced' ? replacement : null;
    markSessionCleanupFailed(original);
    gate.resolve({ proceed: true, compacted: false });
    expectRefusedTurn(ctx, dispatch, await pending);
    expect(ensure).not.toHaveBeenCalled();
    expect(replacement.send).not.toHaveBeenCalled();
  });
});

describe('session-acquisition boundary', () => {
  it.each([
    ['original', 'resolved'], ['original', 'rejected'],
    ['current', 'resolved'], ['current', 'rejected'],
  ])('refuses when the %s session fails while acquisition is pending (%s)', async (target, outcome) => {
    const original = createFixtureSession();
    const replacement = createFixtureSession();
    const ctx = createFixtureContext(original);
    const acquisition = createDeferred<unknown>();
    ensure.mockReturnValue(acquisition.promise);
    const dispatch = vi.fn();
    const pending = handleCesarBrain('prompt', dispatch, ctx);
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce());
    ctx.cesarSession = replacement;
    markSessionCleanupFailed(target === 'original' ? original : replacement);
    if (outcome === 'rejected') acquisition.reject(new Error('fixture acquisition failure'));
    else acquisition.resolve(replacement);
    expectRefusedTurn(ctx, dispatch, await pending);
    expect(original.send).not.toHaveBeenCalled();
    expect(replacement.send).not.toHaveBeenCalled();
  });

  it('refuses when acquisition fails to close a mismatched session', async () => {
    const real = await vi.importActual<typeof import('../../packages/cli/src/cesar/session.js')>('../../packages/cli/src/cesar/session.js');
    ensure.mockImplementation(real.ensureCesarSession);
    const original = createFixtureSession('previous-engine');
    original.close.mockImplementation(() => { throw new Error('fixture close failure'); });
    const ctx = createFixtureContext(original);
    const dispatch = vi.fn();
    expectRefusedTurn(ctx, dispatch, await handleCesarBrain('prompt', dispatch, ctx));
    expect(sessionCleanupFailed(original)).toBe(true);
    expect(ctx.cesarSession).toBe(original);
  });
});

describe('healthy fallback controls', () => {
  it.each(['cli', 'api'])('still dispatches the %s fallback after an ordinary acquisition failure', async kind => {
    backend.mockReturnValue({ backend: kind, engine: { id: 'fixture' } });
    ensure.mockRejectedValue(new Error('fixture backend unavailable'));
    const ctx = createFixtureContext(createFixtureSession());
    const dispatch = vi.fn();
    const outcome = await handleCesarBrain('prompt', dispatch, ctx);
    expect(outcome).toMatchObject({ terminalState: 'completed', responded: true, delegated: false });
    expect(ctx.adapter.dispatch).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalledWith(CLEANUP_WARNING);
    const sessionError = expect.objectContaining({ type: 'spinner-update', message: expect.stringContaining('Cesar session error') });
    if (kind === 'cli') expect(dispatch).toHaveBeenCalledWith(sessionError);
    else expect(dispatch).not.toHaveBeenCalledWith(sessionError);
    expect(ctx.chatSession.messages.map((message: any) => message.role)).toEqual(['user', 'engine']);
    expect(ctx.cesar.busy).toBe(false);
    expect(ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it('acquires a replacement after a healthy detachment during the gate', async () => {
    const original = createFixtureSession();
    const replacement = createFixtureSession();
    const ctx = createFixtureContext(original);
    const gate = createDeferred<{ proceed: boolean; compacted: boolean }>();
    budget.mockReturnValue(gate.promise);
    ensure.mockImplementation(async () => { ctx.cesarSession = replacement; return replacement; });
    const dispatch = vi.fn();
    const pending = handleCesarBrain('prompt', dispatch, ctx);
    await vi.waitFor(() => expect(budget).toHaveBeenCalledOnce());
    ctx.cesarSession = null;
    gate.resolve({ proceed: true, compacted: true });
    await pending;
    expect(ensure).toHaveBeenCalledOnce();
    expect(replacement.send).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(CLEANUP_WARNING);
    expect(ctx.cesar.busy).toBe(false);
  });
});

describe('in-flight adapter fallback', () => {
  it.each([
    ['original', 'response'], ['original', 'empty'], ['original', 'rejection'],
    ['current', 'response'], ['current', 'empty'], ['current', 'rejection'],
    ['healthy', 'response'], ['healthy', 'empty'], ['healthy', 'rejection'],
  ])('checks %s cleanup state after %s', async (target, result) => {
    const original = createFixtureSession();
    const replacement = createFixtureSession();
    const ctx = createFixtureContext(original);
    const fallback = createDeferred<{ stdout: string; stderr: string }>();
    ctx.adapter.dispatch.mockReturnValue(fallback.promise);
    const dispatch = vi.fn();
    const pending = handleCesarBrain('prompt', dispatch, ctx);
    await vi.waitFor(() => expect(ctx.adapter.dispatch).toHaveBeenCalledOnce());
    ctx.cesarSession = replacement;
    if (target !== 'healthy') markSessionCleanupFailed(target === 'original' ? original : replacement);
    if (result === 'rejection') fallback.reject(new Error('fixture fallback rejected'));
    else fallback.resolve({ stdout: result === 'response' ? 'late fixture answer' : '', stderr: '' });
    const outcome = await pending;
    if (target === 'healthy') {
      expect(outcome.responded).toBe(result === 'response');
      expect(dispatch).not.toHaveBeenCalledWith(CLEANUP_WARNING);
      expect(ctx.chatSession.messages.map((message: any) => message.role))
        .toEqual(result === 'response' ? ['user', 'engine'] : ['user']);
    } else {
      expect(outcome).toMatchObject({ terminalState: 'failed', decisionReason: 'session-cleanup-failed', responded: false, delegated: false });
      expect(ctx.chatSession.messages.map((message: any) => message.role)).toEqual(['user']);
      expect(dispatch).toHaveBeenCalledWith(CLEANUP_WARNING);
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block' }));
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    }
    expect(ctx.adapter.dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'spinner-stop' });
    expect(ctx.cesar.busy).toBe(false);
    expect(ctx.cesar.abortSignal).toBeNull();
    expect(ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  });
});

describe('initial persistent stream cleanup boundary', () => {
  it.each(['preview', 'text'].flatMap(prefix =>
    ['text', 'empty', 'rejection'].map(result => [prefix, result]),
  ))('finishes an existing %s pane after cleanup failure (%s)', async (prefix, result) => {
    const session = createFixtureSession();
    const ctx = createFixtureContext(session);
    const ready = createDeferred<void>();
    session.send.mockImplementation(async function* () {
      yield { type: prefix, content: 'This fixture text was visible before cleanup failed.\n' };
      await ready.promise;
      if (result === 'text') yield { type: 'text', content: 'Must not appear.' };
    });
    ensure.mockImplementation(async () => { ctx.cesar.hasNativeTools = true; return session; });
    const dispatch = vi.fn();
    const pending = handleCesarBrain('hello', dispatch, ctx);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: prefix === 'preview' ? 'streaming-preview' : 'streaming-chunk',
    })));
    markSessionCleanupFailed(session);
    if (result === 'rejection') ready.reject(new Error('fixture stream rejected'));
    else ready.resolve();
    expect(await pending).toMatchObject({ decisionReason: 'session-cleanup-failed', responded: false });
    expect(dispatch).toHaveBeenCalledWith({ type: 'streaming-end', engineId: 'fixture' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ chunk: 'Must not appear.' }));
    expect(ctx.chatSession.messages.filter((message: any) => message.role === 'engine')).toEqual([]);
    expect(session.send).toHaveBeenCalledOnce();
  });

  it.each(['original', 'current', 'acquired', 'healthy'].flatMap(target =>
    ['text', 'empty', 'rejection'].map(result => [target, result]),
  ))('checks %s cleanup after pending stream %s', async (target, result) => {
    const original = createFixtureSession();
    const acquired = createFixtureSession();
    const replacement = createFixtureSession();
    const ctx = createFixtureContext(original);
    const ready = createDeferred<void>();
    const closed = vi.fn();
    acquired.send.mockImplementation(async function* () {
      try {
        await ready.promise;
        if (result === 'text') yield { type: 'text', content: 'A fixture answer.' };
      } finally { closed(); }
    });
    ensure.mockResolvedValue(acquired);
    const dispatch = vi.fn();
    const pending = handleCesarBrain('hello', dispatch, ctx);
    await vi.waitFor(() => expect(acquired.send).toHaveBeenCalledOnce());
    ctx.cesarSession = replacement;
    if (target !== 'healthy') {
      const failedSession = target === 'original' ? original : target === 'current' ? replacement : acquired;
      markSessionCleanupFailed(failedSession);
    }
    if (result === 'rejection') ready.reject(new Error('fixture stream rejected'));
    else ready.resolve();
    const outcome = await pending;
    if (target === 'healthy') {
      expect(dispatch).not.toHaveBeenCalledWith(CLEANUP_WARNING);
      expect(outcome.responded).toBe(result === 'text');
    } else {
      expect(outcome).toMatchObject({ terminalState: 'failed', decisionReason: 'session-cleanup-failed', responded: false, delegated: false });
      expect(dispatch).toHaveBeenCalledWith(CLEANUP_WARNING);
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'streaming-chunk' }));
      expect(ctx.chatSession.messages.filter((message: any) => message.role === 'engine')).toEqual([]);
    }
    expect(closed).toHaveBeenCalledOnce();
    expect(acquired.send).toHaveBeenCalledOnce();
    expect(ctx.adapter.dispatch).not.toHaveBeenCalled();
    expect(ctx.cesar.busy).toBe(false);
    expect(ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  });
});

describe('interactive continuation cleanup boundary', () => {
  const questions = {
    ask: 'Pick a review scope. [ASK]{"question":"Which scope?","options":[{"label":"Local"},{"label":"Full"}]}[/ASK]',
    fork: 'A) Local review\nB) Full review\nWhich scope?',
    confirm: 'The review scope is ready. Shall I proceed?',
  };
  it.each((['ask', 'fork', 'confirm'] as const).flatMap(kind =>
    ['original', 'current', 'acquired', 'healthy'].flatMap(target =>
      ['text', 'empty', 'rejection'].map(result => [kind, target, result] as const),
    ),
  ))('checks %s running follow-up for %s cleanup (%s)', async (kind, target, result) => {
    const original = createFixtureSession();
    const acquired = createFixtureSession();
    const replacement = createFixtureSession();
    const ctx = createFixtureContext(original);
    const ready = createDeferred<void>();
    const closed = vi.fn();
    acquired.send.mockImplementationOnce(async function* () {
      yield { type: 'text', content: questions[kind] };
    }).mockImplementation(async function* () {
      try {
        await ready.promise;
        if (result === 'text') yield { type: 'text', content: 'Late follow-up answer.' };
      } finally { closed(); }
    });
    ensure.mockResolvedValue(acquired);
    const dispatch = vi.fn();
    const pending = handleCesarBrain('review this implementation', dispatch, ctx);
    // Observe errors immediately; a rejected provider must not create an
    // unhandled-rejection race while the fixture waits for its send boundary.
    const settled = pending.then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'question' })));
    dispatch.mock.calls.find(([event]) => event.type === 'question')![0].resolve(kind === 'ask' ? '1' : kind === 'fork' ? 'a' : 'y');
    await vi.waitFor(() => expect(acquired.send).toHaveBeenCalledTimes(2));
    const savedMessages = [...ctx.chatSession.messages];
    const eventCount = dispatch.mock.calls.length;
    ctx.cesarSession = replacement;
    if (target !== 'healthy') markSessionCleanupFailed(target === 'original' ? original : target === 'current' ? replacement : acquired);
    if (result === 'rejection') ready.reject(new Error('fixture follow-up rejected'));
    else ready.resolve();
    const outcome = await settled;
    if (target === 'healthy') {
      expect(dispatch).not.toHaveBeenCalledWith(CLEANUP_WARNING);
      if (result === 'rejection') expect(outcome).toMatchObject({ error: expect.objectContaining({ message: 'fixture follow-up rejected' }) });
      else if (result === 'text') {
        expect(outcome).toMatchObject({ value: { responded: true } });
        expect(ctx.chatSession.messages.at(-1)).toMatchObject({ role: 'engine', content: 'Late follow-up answer.' });
      } else expect(outcome).toMatchObject({ value: { decisionReason: 'interactive-follow-up-incomplete' } });
    } else {
      expect(outcome).toMatchObject({ value: { terminalState: 'failed', decisionReason: 'session-cleanup-failed', delegated: false } });
      expect(dispatch).toHaveBeenCalledWith(CLEANUP_WARNING);
      expect(ctx.chatSession.messages).toEqual(savedMessages);
      expect(dispatch.mock.calls.slice(eventCount).map(([event]) => event.type)).not.toContain('streaming-chunk');
    }
    expect(closed).toHaveBeenCalledOnce();
    expect(acquired.send).toHaveBeenCalledTimes(2);
    expect(ctx.adapter.dispatch).not.toHaveBeenCalled();
    expect(ctx.cesar.busy).toBe(false);
    expect(ctx.cesar.abortSignal).toBeNull();
    expect(ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  });
  it.each((['ask', 'fork', 'confirm'] as const).flatMap(kind =>
    ['original', 'current', 'acquired', 'healthy'].map(target => [kind, target] as const),
  ))('checks cleanup after %s approval (%s)', async (kind, target) => {
    const original = createFixtureSession();
    const acquired = createFixtureSession();
    const replacement = createFixtureSession();
    const ctx = createFixtureContext(original);
    acquired.send.mockImplementationOnce(async function* () {
      yield { type: 'text', content: questions[kind] };
      yield { type: 'done', content: 'end_turn' };
    }).mockImplementation(async function* () {
      yield { type: 'text', content: 'Fixture follow-up completed.' };
      yield { type: 'done', content: 'end_turn' };
    });
    ensure.mockResolvedValue(acquired);
    const dispatch = vi.fn();
    const pending = handleCesarBrain('review this implementation', dispatch, ctx);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'question' })));
    const question = dispatch.mock.calls.find(([event]) => event.type === 'question')![0];
    const savedMessages = [...ctx.chatSession.messages];
    ctx.cesarSession = replacement;
    if (target !== 'healthy') {
      markSessionCleanupFailed(target === 'original' ? original : target === 'current' ? replacement : acquired);
    }
    question.resolve(kind === 'ask' ? '1' : kind === 'fork' ? 'a' : 'y');
    const outcome = await pending;
    if (target === 'healthy') {
      expect(acquired.send).toHaveBeenCalledTimes(2);
      expect(outcome.responded).toBe(true);
      expect(dispatch).not.toHaveBeenCalledWith(CLEANUP_WARNING);
    } else {
      expect(acquired.send).toHaveBeenCalledOnce();
      expect(outcome).toMatchObject({ terminalState: 'failed', decisionReason: 'session-cleanup-failed', delegated: false });
      expect(dispatch).toHaveBeenCalledWith(CLEANUP_WARNING);
      expect(ctx.chatSession.messages).toEqual(savedMessages);
    }
    expect(ctx.adapter.dispatch).not.toHaveBeenCalled();
    expect(ctx.cesar.busy).toBe(false);
    expect(ctx.setActiveAbort).toHaveBeenLastCalledWith(null);
  });
});

describe('auto-compaction close', () => {
  const realBudget = async () => (await vi.importActual<typeof import('../../packages/cli/src/cesar/context-budget.js')>('../../packages/cli/src/cesar/context-budget.js')).enforceContextBudget;
  const tinyBudgetEngine = { id: 'fixture', sessionBudget: { contextWindow: 64 } };

  it('marks a session whose close fails and keeps it attached', async () => {
    const session = createFixtureSession();
    session.close.mockImplementation(() => { throw new Error('fixture close failure'); });
    const ctx = createFixtureContext(session);
    const gate = await realBudget();
    await expect(gate(ctx, session, tinyBudgetEngine, 'cli', vi.fn(), 'prompt')).rejects.toThrow('Session cleanup previously failed');
    expect(sessionCleanupFailed(session)).toBe(true);
    expect(ctx.setCesarSession).not.toHaveBeenCalled();
    expect(ctx.cesarSession).toBe(session);
  });

  it('still detaches a session whose close succeeds', async () => {
    const session = createFixtureSession();
    const ctx = createFixtureContext(session);
    const gate = await realBudget();
    await gate(ctx, session, tinyBudgetEngine, 'cli', vi.fn(), 'prompt');
    expect(session.close).toHaveBeenCalledOnce();
    expect(ctx.setCesarSession).toHaveBeenCalledWith(null);
    expect(sessionCleanupFailed(session)).toBe(false);
  });
});
