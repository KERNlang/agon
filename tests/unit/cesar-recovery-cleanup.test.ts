import { beforeEach, expect, it, vi } from 'vitest';
import { runCesarBrainFallback } from '../../packages/cli/src/signals/dispatch/cesar-router.js';
import { markSessionCleanupFailed, sessionCleanupFailed } from '../../packages/cli/src/cesar/session-health.js';

const { brain, backend } = vi.hoisted(() => ({ brain: vi.fn(), backend: vi.fn() }));
vi.mock('../../packages/cli/src/handlers/cesar-brain.js', async original => ({
  ...await original<object>(), handleCesarBrain: brain,
}));
vi.mock('../../packages/cli/src/cesar/session.js', async original => ({
  ...await original<object>(), resolveCesarBackend: backend,
}));
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
