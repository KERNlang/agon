import { expect, it, vi } from 'vitest';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
const effects = vi.hoisted(() => ({ undo: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(),
  undoPatch: () => { throw new Error('Legacy core undo binding must not run'); },
  resolveWorkingDir: () => '/fixture',
}));
vi.mock('@kernlang/agon-support-worktree', async original => ({
  ...await original<Record<string, unknown>>(), undoPatch: effects.undo,
}));
import { persistencePath } from '@kernlang/agon-support-persistence';
import { dispatchMetaIntent } from '../../packages/cli/src/signals/dispatch/intent-meta.js';

it('clears the used token and reports cleanup failure without offering another undo', async () => {
  effects.undo.mockReturnValue({ ok: true, warning: 'Record cleanup failed; do not reuse this token.' });
  const dispatch = vi.fn();
  const setLastUndoToken = vi.fn();
  const cb = { ctx: {}, dispatch, setLastUndoToken, lastUndoToken: 'fixture' } as unknown as DispatchCallbacks;
  await dispatchMetaIntent({ type: 'undo' }, '/undo', cb);
  expect(effects.undo).toHaveBeenCalledWith('/fixture', 'fixture', persistencePath('undo'));
  expect(setLastUndoToken).toHaveBeenCalledWith(null);
  expect(dispatch).toHaveBeenCalledWith({ type: 'success', message: 'Patch reverted successfully.' });
  expect(dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Record cleanup failed; do not reuse this token.' });
});

it('retains the token when the physical undo fails', async () => {
  effects.undo.mockReset().mockReturnValue({ ok: false, error: 'Workspace changed' });
  const dispatch = vi.fn();
  const setLastUndoToken = vi.fn();
  const cb = { ctx: {}, dispatch, setLastUndoToken, lastUndoToken: 'fixture' } as unknown as DispatchCallbacks;
  await dispatchMetaIntent({ type: 'undo' }, '/undo', cb);
  expect(effects.undo).toHaveBeenCalledExactlyOnceWith('/fixture', 'fixture', persistencePath('undo'));
  expect(setLastUndoToken).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith({ type: 'error', message: expect.stringContaining('Workspace changed') });
  expect(dispatch.mock.calls.some(([event]) => event.type === 'success')).toBe(false);
});
