import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startChatSession } from '@kernlang/agon-core';
import { handleRecoveredDelegation, routeWithCesar, runCesarBrainFallback } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { markSessionCleanupFailed, sessionCleanupFailed } from '../../packages/cli/src/cesar/session-health.js';

const { brain, backend, writeConfig } = vi.hoisted(() => ({ brain: vi.fn(), backend: vi.fn(), writeConfig: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(), configSet: writeConfig,
}));
vi.mock('../../packages/cli/src/handlers/cesar-brain.js', async original => ({
  ...await original<object>(), handleCesarBrain: brain,
}));
vi.mock('../../packages/cli/src/cesar/session.js', async original => ({
  ...await original<object>(), resolveCesarBackend: backend, buildCesarSystemPrompt: () => 'fixture system prompt',
}));
vi.mock('../../packages/cli/src/cesar/routing.js', async original => ({
  ...await original<object>(), deriveRoutingHints: () => ({}),
}));
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  writeConfig.mockReset();
  brain.mockReset().mockResolvedValue({ responded: true, delegated: false });
  backend.mockReset().mockReturnValue({ backend: 'cli', engine: { id: 'fixture' } });
});

it.each(['2', '3'])('rejects acting-Cesar approval %s after cleanup failure', async choice => {
  backend.mockReturnValue({ backend: 'api', engine: { id: 'fixture' } });
  const session = { close: vi.fn() } as any;
  const adapter = { dispatch: vi.fn().mockResolvedValue({ stdout: 'alternate answer' }) };
  const dispatch = vi.fn();
  const ctx = { config: { cesarEngine: 'fixture', cesarActingFallback: 'ask' }, cesarSession: session,
    adapter, registry: { get: () => ({ id: 'alternate' }) }, activeEngines: () => ['alternate'],
    chatSession: startChatSession() } as any;
  const pending = runCesarBrainFallback('prompt', { ctx, dispatch } as any, null, true);
  const question = dispatch.mock.calls.map(([event]) => event).find(event => event.type === 'question');
  expect(question).toBeDefined();
  ctx.cesarSession = null;
  markSessionCleanupFailed(session);
  question.resolve(choice);
  await pending;
  expect(writeConfig).not.toHaveBeenCalled();
  expect(adapter.dispatch).not.toHaveBeenCalled();
  expect(ctx.chatSession.messages).toEqual([]);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
    message: expect.stringContaining('Session cleanup previously failed') }));
});

it.each(['before dispatch', 'response', 'empty', 'rejection', 'healthy'])(
  'guards acting-Cesar asynchronous boundary: %s', async outcome => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    backend.mockReturnValue({ backend: 'api', engine: { id: 'fixture' } });
    const session = { close: vi.fn() } as any;
    let finish!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    const adapter = { dispatch: vi.fn(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; })) };
    const dispatch = vi.fn();
    const ctx = { config: { cesarEngine: 'fixture', cesarActingFallback: 'ask' }, cesarSession: session,
      adapter, registry: { get: () => ({ id: 'alternate' }) }, activeEngines: () => ['alternate'],
      chatSession: startChatSession() } as any;
    const pending = runCesarBrainFallback('prompt', { ctx, dispatch } as any, null, true);
    const question = dispatch.mock.calls.map(([event]) => event).find(event => event.type === 'question');
    expect(question).toBeDefined();
    question.resolve('2');
    if (outcome === 'before dispatch') {
      queueMicrotask(() => markSessionCleanupFailed(session));
      // Resolve an unexpected dispatch as well, so a regression cannot hang the test.
      adapter.dispatch.mockResolvedValue({ stdout: 'unexpected answer' });
    } else {
      await vi.waitFor(() => expect(adapter.dispatch).toHaveBeenCalledOnce());
      if (outcome !== 'healthy') markSessionCleanupFailed(session);
      if (outcome === 'rejection') reject(new Error('fixture adapter failure'));
      else finish({ stdout: outcome === 'empty' ? '' : 'alternate answer' });
    }
    await pending;
    if (outcome === 'healthy') {
      expect(ctx.chatSession.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'engine', content: '[acting-cesar] alternate answer' }),
      ]));
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    } else {
      if (outcome === 'before dispatch') expect(adapter.dispatch).not.toHaveBeenCalled();
      expect(ctx.chatSession.messages).toEqual([]);
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block' }));
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
        message: expect.stringContaining('Session cleanup previously failed') }));
    }
  });

it.each(['close', 'detach', 'previous failure'])('recovery refuses replacement work after %s', async phase => {
  const session = { close: vi.fn() } as any;
  const detach = vi.fn();
  const fail = () => { throw new Error('fixture cleanup failure'); };
  if (phase === 'close') session.close.mockImplementation(fail);
  if (phase === 'detach') detach.mockImplementation(fail);
  if (phase === 'previous failure') markSessionCleanupFailed(session);
  const dispatch = vi.fn();
  const adapter = { dispatch: vi.fn() };
  const cb = { dispatch, ctx: { config: { cesarEngine: 'fixture' }, cesarSession: session,
    setCesarSession: detach, adapter, activeEngines: () => [], chatSession: { messages: [] } } } as any;
  await expect(runCesarBrainFallback('prompt', cb, null, false)).resolves.toBe(false);
  expect(brain).not.toHaveBeenCalled();
  expect(adapter.dispatch).not.toHaveBeenCalled();
  expect(sessionCleanupFailed(session)).toBe(true);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
    message: expect.stringContaining('Session cleanup previously failed') }));
});

it('still retries after successful cleanup', async () => {
  const close = vi.fn();
  const detach = vi.fn();
  const cb = { dispatch: vi.fn(), ctx: { config: {}, cesarSession: { close }, setCesarSession: detach } } as any;
  await expect(runCesarBrainFallback('prompt', cb, null, false)).resolves.toBe(false);
  expect(close).toHaveBeenCalledOnce();
  expect(detach).toHaveBeenCalledWith(null);
  expect(brain).toHaveBeenCalledOnce();
});

it.each(['cli', 'api'])('stops the %s ladder when cleanup fails while its retry is pending', async kind => {
  backend.mockReturnValue({ backend: kind, engine: { id: 'fixture' } });
  const session = { close: vi.fn() } as any;
  let finish!: (value: unknown) => void;
  brain.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const dispatch = vi.fn();
  const adapter = { dispatch: vi.fn() };
  const ctx = { config: {}, cesarSession: session, setCesarSession: vi.fn(), adapter,
    activeEngines: () => [], chatSession: { messages: [] } } as any;
  ctx.setCesarSession.mockImplementation((value: unknown) => { ctx.cesarSession = value; });
  const pending = runCesarBrainFallback('prompt', { ctx, dispatch } as any, null, false);
  expect(brain).toHaveBeenCalledOnce();
  markSessionCleanupFailed(session);
  finish({ responded: false, delegated: false });
  await expect(pending).resolves.toBe(false);
  expect(adapter.dispatch).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
    message: expect.stringContaining('Session cleanup previously failed') }));
});

it.each(['resolved original', 'rejected original', 'resolved current', 'rejected current'])(
  'stops initial-brain recovery after cleanup failure: %s', async scenario => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = { close: vi.fn() } as any;
    const replacement = { close: vi.fn() } as any;
    let finish!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    brain.mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    const delegation = { action: 'fixture-unused', timestamp: 0 };
    const ctx = { config: {}, cesarSession: original, setCesarSession: vi.fn(),
      cesar: { pendingDelegation: delegation }, activeEngines: () => [], chatSession: { messages: [] } } as any;
    const dispatch = vi.fn();
    const askQuestion = vi.fn().mockResolvedValue('cancel');
    const pending = routeWithCesar('prompt', [], { ctx, dispatch, setPendingImages: vi.fn(), askQuestion } as any);
    expect(brain).toHaveBeenCalledOnce();
    ctx.cesarSession = replacement;
    markSessionCleanupFailed(scenario.endsWith('original') ? original : replacement);
    if (scenario.startsWith('rejected')) reject(new Error('fixture turn failed'));
    else finish({ responded: false, delegated: false });
    await expect(pending).resolves.toBe(false);
    expect(ctx.cesar.pendingDelegation).toBe(delegation);
    expect(askQuestion).not.toHaveBeenCalled();
    expect(brain).toHaveBeenCalledOnce();
    expect(backend).not.toHaveBeenCalled();
    expect(replacement.close).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
      message: expect.stringContaining('Session cleanup previously failed') }));
  });

it('does not launch recovered delegation when cleanup fails during approval', async () => {
  const session = { close: vi.fn() } as any;
  let approve!: (value: string) => void;
  const askQuestion = vi.fn(() => new Promise<string>(resolve => { approve = resolve; }));
  const runAsJob = vi.fn();
  const dispatch = vi.fn();
  const ctx = { config: {}, cesarSession: session, chatSession: { messages: [] } } as any;
  const pending = handleRecoveredDelegation({ action: 'campfire', task: 'fixture', createdAt: Date.now() },
    'prompt', { ctx, dispatch, askQuestion, runAsJob } as any);
  expect(askQuestion).toHaveBeenCalledOnce();
  markSessionCleanupFailed(session);
  ctx.cesarSession = null;
  approve('y');
  await expect(pending).resolves.toBe(false);
  expect(runAsJob).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
    message: expect.stringContaining('Session cleanup previously failed') }));
});

it('still launches an approved recovered delegation for a healthy session', async () => {
  const runAsJob = vi.fn();
  const cb = { dispatch: vi.fn(), askQuestion: vi.fn().mockResolvedValue('y'), runAsJob,
    ctx: { config: {}, cesarSession: { close: vi.fn() }, chatSession: { messages: [] } } } as any;
  await expect(handleRecoveredDelegation({ action: 'campfire', createdAt: Date.now() }, 'prompt', cb)).resolves.toBe(true);
  expect(runAsJob).toHaveBeenCalledExactlyOnceWith('campfire', 'prompt', expect.any(Function));
});

it.each(['failed', 'healthy'])('checks cleanup after one-shot delegation approval: %s', async state => {
  brain.mockResolvedValue({ responded: false, delegated: false });
  const session = { close: vi.fn() } as any;
  let approve!: (value: string) => void;
  const askQuestion = vi.fn(() => new Promise<string>(resolve => { approve = resolve; }));
  const adapter = { dispatch: vi.fn().mockResolvedValue({ stdout: '[SUGGEST:campfire] Discuss this.' }) };
  const dispatch = vi.fn();
  const runAsJob = vi.fn();
  const ctx = { config: {}, cesarSession: session, setCesarSession: vi.fn(), adapter,
    activeEngines: () => [], chatSession: startChatSession() } as any;
  ctx.setCesarSession.mockImplementation((value: unknown) => { ctx.cesarSession = value; });
  const pending = runCesarBrainFallback('prompt', { ctx, dispatch, askQuestion, runAsJob } as any, null, false);
  await vi.waitFor(() => expect(askQuestion).toHaveBeenCalledOnce());
  if (state === 'failed') markSessionCleanupFailed(session);
  approve('y');
  await expect(pending).resolves.toBe(state === 'healthy');
  if (state === 'healthy') {
    expect(runAsJob).toHaveBeenCalledExactlyOnceWith('campfire', 'prompt', expect.any(Function));
  } else {
    expect(runAsJob).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
      message: expect.stringContaining('Session cleanup previously failed') }));
  }
});

it.each(['empty', 'response', 'rejection', 'healthy empty'])('checks cleanup state after one-shot %s', async outcome => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  brain.mockResolvedValue({ responded: false, delegated: false });
  const session = { close: vi.fn() } as any;
  let finish!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const adapter = { dispatch: vi.fn(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; })) };
  const activeEngines = vi.fn(() => []);
  const dispatch = vi.fn();
  const ctx = { config: {}, cesarSession: session, setCesarSession: vi.fn(), adapter,
    activeEngines, chatSession: { messages: [] } } as any;
  ctx.setCesarSession.mockImplementation((value: unknown) => { ctx.cesarSession = value; });
  const pending = runCesarBrainFallback('prompt', { ctx, dispatch } as any, null, false);
  await vi.waitFor(() => expect(adapter.dispatch).toHaveBeenCalledOnce());
  if (outcome !== 'healthy empty') markSessionCleanupFailed(session);
  if (outcome === 'rejection') reject(new Error('fixture dispatch failed'));
  else finish({ stdout: outcome === 'response' ? 'fixture answer' : '' });
  await expect(pending).resolves.toBe(false);
  if (outcome === 'healthy empty') {
    expect(activeEngines).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Session cleanup previously failed') }));
    return;
  }
  expect(activeEngines).not.toHaveBeenCalled();
  expect(ctx.chatSession.messages).toEqual([]);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning',
    message: expect.stringContaining('Session cleanup previously failed') }));
});
