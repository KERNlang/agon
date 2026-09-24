import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleRecoveredDelegation, routeWithCesar, runCesarBrainFallback } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { markSessionCleanupFailed, sessionCleanupFailed } from '../../packages/cli/src/cesar/session-health.js';

const { brain, backend } = vi.hoisted(() => ({ brain: vi.fn(), backend: vi.fn() }));
vi.mock('../../packages/cli/src/handlers/cesar-brain.js', async original => ({
  ...await original<object>(), handleCesarBrain: brain,
}));
vi.mock('../../packages/cli/src/cesar/session.js', async original => ({
  ...await original<object>(), resolveCesarBackend: backend,
}));
vi.mock('../../packages/cli/src/cesar/routing.js', async original => ({
  ...await original<object>(), deriveRoutingHints: () => ({}),
}));
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  brain.mockReset().mockResolvedValue({ responded: true, delegated: false });
  backend.mockReset().mockReturnValue({ backend: 'cli', engine: { id: 'fixture' } });
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
