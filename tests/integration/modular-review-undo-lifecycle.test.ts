import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const host = vi.hoisted(() => ({ cwd: '' }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(),
  resolveWorkingDir: () => host.cwd,
}));
import { handleReviewAction } from '../../packages/cli/src/blocks/review.js';
import { dispatchMetaIntent } from '../../packages/cli/src/signals/dispatch/intent-meta.js';

// Real Git and persistence; only the selected workspace is injected.
it('applies through Review, retains a failed Undo, then consumes a successful Undo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agon-review-undo-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  host.cwd = root;
  vi.stubEnv('AGON_HOME', join(root, 'state'));
  try {
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(root, 'item.txt'), 'before\n');
    git('add', 'item.txt');
    git('commit', '-qm', 'fixture');
    const index = readFileSync(join(root, '.git/index'));
    writeFileSync(join(root, 'item.txt'), 'after\n');
    const patchContent = git('diff', '--binary');
    writeFileSync(join(root, 'item.txt'), 'before\n');
    const dispatch = vi.fn();
    let token = handleReviewAction({ type: 'apply' }, { winnerId: 'fixture', patchPath: 'unused', patchContent }, dispatch);
    expect(token).toBeTruthy();
    expect(readFileSync(join(root, 'item.txt'), 'utf8')).toBe('after\n');
    const records = join(root, 'state/undo');
    expect(readdirSync(records)).toHaveLength(1);
    const callbacks = () => ({ ctx: {}, dispatch, lastUndoToken: token,
      setLastUndoToken: (next: string | null) => { token = next; },
    } as unknown as DispatchCallbacks);
    writeFileSync(join(root, 'item.txt'), 'operator edit\n');
    await dispatchMetaIntent({ type: 'undo' }, '/undo', callbacks());
    expect(token).toBeTruthy();
    expect(readFileSync(join(root, 'item.txt'), 'utf8')).toBe('operator edit\n');
    expect(readdirSync(records)).toHaveLength(1);
    expect(dispatch.mock.calls.some(([event]) => event.type === 'error')).toBe(true);
    writeFileSync(join(root, 'item.txt'), 'after\n');
    await dispatchMetaIntent({ type: 'undo' }, '/undo', callbacks());
    expect(token).toBeNull();
    expect(readFileSync(join(root, 'item.txt'), 'utf8')).toBe('before\n');
    expect(readdirSync(records)).toEqual([]);
    expect(readFileSync(join(root, '.git/index'))).toEqual(index);
    dispatch.mockClear();
    await dispatchMetaIntent({ type: 'undo' }, '/undo', callbacks());
    expect(dispatch).toHaveBeenCalledWith({ type: 'warning', message: expect.stringContaining('Nothing to undo') });
    expect(readFileSync(join(root, 'item.txt'), 'utf8')).toBe('before\n');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
