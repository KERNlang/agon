import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { configSet, executeToolCall, getProjectFileStateCache, invalidateConfigCache, takeSnapshot } from '@kernlang/agon-core';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const host = vi.hoisted(() => ({ cwd: '' }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(),
  resolveWorkingDir: () => host.cwd,
}));

import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { closeUndoSession, consumeUndoNotice, markUserTurnBoundary, noteTurnToolEvent } from '../../packages/cli/src/cesar/turn-undo.js';
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
import { detectIntent } from '../../packages/cli/src/signals/intent.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';

let home = '';
let cwd = '';
let outside = '';

const toolContext = () => ({ cwd, readFileState: (getProjectFileStateCache(cwd) as any).cache, permissionMode: 'auto', source: 'orchestrator' }) as any;
const run = async (name: string, input: Record<string, unknown>, registry = createCesarToolRegistry('undo-test')) =>
  (await executeToolCall({ id: name, name, input }, toolContext(), registry, async () => true)).result;
const write = async (file: string, content: string, registry = createCesarToolRegistry('undo-test')) => {
  if (existsSync(join(cwd, file))) await run('Read', { file_path: file }, registry);
  const result = await run('Write', { file_path: file, content }, registry);
  expect(result.ok, result.error).toBe(true);
  return result;
};
const undo = async () => {
  const dispatch = vi.fn();
  const runAsJob = vi.fn();
  await dispatchIntent(detectIntent('/undo'), '/undo', { ctx: {}, dispatch, runAsJob, lastUndoToken: null, setLastUndoToken: () => {} } as unknown as DispatchCallbacks);
  expect(runAsJob).not.toHaveBeenCalled();
  return dispatch.mock.calls.map(([event]) => String(event.message)).join('\n');
};
const read = (file: string) => readFileSync(join(cwd, file), 'utf8');

beforeAll(() => initializeProcessSurfaceAuthority('/tmp/agon-cesar-turn-undo-authority'));
afterAll(() => disposeProcessSurfaceAuthority());
beforeEach(() => {
  home = setupTestAgonHome('cesar-turn-undo');
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agon-undo-ws-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'agon-undo-outside-')));
  host.cwd = cwd;
  invalidateConfigCache();
});
afterEach(() => {
  closeUndoSession();
  cleanupTestAgonHome(home);
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  invalidateConfigCache();
});

describe('turn undo never destroys later work', () => {
  it('later edit is not overwritten and other files still revert', async () => {
    writeFileSync(join(cwd, 'mine.txt'), 'original\n');
    writeFileSync(join(cwd, 'other.txt'), 'original\n');
    writeFileSync(join(cwd, 'gone.txt'), 'original\n');
    markUserTurnBoundary();
    await write('mine.txt', 'cesar\n');
    await write('other.txt', 'cesar\n');
    await write('gone.txt', 'cesar\n');
    writeFileSync(join(cwd, 'mine.txt'), 'my later edit\n');
    rmSync(join(cwd, 'gone.txt'));

    const report = await undo();

    expect(read('mine.txt')).toBe('my later edit\n');
    expect(read('other.txt')).toBe('original\n');
    expect(existsSync(join(cwd, 'gone.txt'))).toBe(false);
    expect(report).toMatch(/refused mine\.txt: changed since/);
    expect(report).toMatch(/refused gone\.txt: deleted since/);
    expect(report).toMatch(/restored other\.txt/);
  });

  it('created file edited since is not deleted; an unchanged one is removed', async () => {
    markUserTurnBoundary();
    await write('kept.txt', 'cesar\n');
    await write('deep/new/removed.txt', 'cesar\n');
    writeFileSync(join(cwd, 'kept.txt'), 'edited after\n');

    const report = await undo();

    expect(read('kept.txt')).toBe('edited after\n');
    expect(existsSync(join(cwd, 'deep/new/removed.txt'))).toBe(false);
    expect(report).toMatch(/refused kept\.txt/);
    expect(report).toMatch(/removed deep\/new\/removed\.txt/);
  });

  it('symlink swap does not write outside the target', async () => {
    const victim = join(outside, 'victim.txt');
    mkdirSync(join(cwd, 'sub'));
    writeFileSync(join(cwd, 'swapped.txt'), 'original\n');
    writeFileSync(join(cwd, 'sub/inner.txt'), 'original\n');
    markUserTurnBoundary();
    await write('swapped.txt', 'cesar\n');
    await write('sub/inner.txt', 'cesar\n');

    writeFileSync(victim, 'cesar\n');
    rmSync(join(cwd, 'swapped.txt'));
    symlinkSync(victim, join(cwd, 'swapped.txt'));
    mkdirSync(join(outside, 'sub'));
    writeFileSync(join(outside, 'sub/inner.txt'), 'cesar\n');
    renameSync(join(cwd, 'sub'), join(cwd, 'sub-moved'));
    symlinkSync(join(outside, 'sub'), join(cwd, 'sub'));

    const report = await undo();

    expect(readFileSync(victim, 'utf8')).toBe('cesar\n');
    expect(readFileSync(join(outside, 'sub/inner.txt'), 'utf8')).toBe('cesar\n');
    expect(report).toMatch(/refused swapped\.txt: path now resolves/);
    expect(report).toMatch(/refused sub\/inner\.txt: path now resolves/);
  });

  it('an edit through a symlink reverts the original target and forgets both read states', async () => {
    writeFileSync(join(cwd, 'target.txt'), 'original\n');
    symlinkSync(join(cwd, 'target.txt'), join(cwd, 'alias.txt'));
    markUserTurnBoundary();
    await write('alias.txt', 'through alias\n');
    await write('target.txt', 'direct\n');

    await undo();

    expect(read('target.txt')).toBe('original\n');
    const cache = getProjectFileStateCache(cwd);
    expect(cache.has(join(cwd, 'alias.txt'))).toBe(false);
    expect(cache.has(join(cwd, 'target.txt'))).toBe(false);
  });
});

describe('turn undo treats one user turn as a unit', () => {
  it('turn with continuations reverts as one, to the first pre-state, with exact bytes', async () => {
    const original = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    writeFileSync(join(cwd, 'latin1.txt'), original);
    markUserTurnBoundary();
    await write('latin1.txt', 'first send\n');
    await write('latin1.txt', 'continuation\n', createCesarToolRegistry('undo-test'));
    await write('created.txt', 'continuation\n', createCesarToolRegistry('undo-test'));

    await undo();

    expect(readFileSync(join(cwd, 'latin1.txt')).equals(original)).toBe(true);
    expect(existsSync(join(cwd, 'created.txt'))).toBe(false);
    expect(await undo()).toMatch(/Nothing to undo/);
  });

  it('repeated undo walks back within the cap and then says the stack is empty', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'v0\n');
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');
    markUserTurnBoundary();
    await write('a.txt', 'v2\n');

    expect(await undo()).toMatch(/1 earlier turn can still be undone/);
    expect(read('a.txt')).toBe('v1\n');
    await undo();
    expect(read('a.txt')).toBe('v0\n');
    expect(await undo()).toMatch(/Nothing to undo: the undo stack is empty/);

    configSet('undoMaxTurns', 1);
    invalidateConfigCache();
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');
    markUserTurnBoundary();
    await write('a.txt', 'v2\n');
    await undo();
    expect(read('a.txt')).toBe('v1\n');
    expect(await undo()).toMatch(/1 older turn fell out/);
    expect(read('a.txt')).toBe('v1\n');
  });

  it('a failed edit leaves nothing on the stack, so undo does not skip past the real last turn', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'v0\n');
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');
    markUserTurnBoundary();
    await run('Read', { file_path: 'a.txt' });
    const failed = await run('Edit', { file_path: 'a.txt', old_string: 'absent text', new_string: 'x' });
    expect(failed.ok).toBe(false);

    await undo();

    expect(read('a.txt')).toBe('v0\n');
  });
});

describe('turn undo is honest about what it did not revert', () => {
  it('Bash-touched turn reports the gap and never claims a full revert', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'v0\n');
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');
    await run('Bash', { command: 'echo shell > via-redirect.txt' });
    await run('Bash', { command: 'ls' });

    const report = await undo();

    expect(read('a.txt')).toBe('v0\n');
    expect(existsSync(join(cwd, 'via-redirect.txt'))).toBe(true);
    expect(report).toMatch(/NOT reverted: 1 shell command .*via-redirect/);
    expect(report).not.toMatch(/\bls\b/);
    expect(report).toMatch(/^Undo of last turn/);
  });

  it('a Bash-only turn reverts nothing and says so', async () => {
    markUserTurnBoundary();
    await run('Bash', { command: 'touch made-by-shell.txt' });

    const report = await undo();

    expect(existsSync(join(cwd, 'made-by-shell.txt'))).toBe(true);
    expect(report).toMatch(/restored 0 files/);
    expect(report).toMatch(/NOT reverted/);
  });

  it('an edit the engine ran with its own tools is reported, not silently skipped', async () => {
    markUserTurnBoundary();
    noteTurnToolEvent('Edit', 'native', undefined, { file_path: 'engine.txt' }, cwd);
    await write('tracked.txt', 'cesar\n');
    noteTurnToolEvent('Write', 'done', undefined, { file_path: 'tracked.txt' }, cwd);

    const report = await undo();

    expect(report).toMatch(/edits the engine ran with its own tools: engine\.txt/);
    expect(report).not.toMatch(/own tools:.*tracked\.txt/);
  });

  it('oversized and binary files are reported as not undoable, at edit time and at undo time', async () => {
    configSet('undoMaxFileBytes', 64);
    invalidateConfigCache();
    const big = 'x'.repeat(200);
    writeFileSync(join(cwd, 'big.txt'), big);
    writeFileSync(join(cwd, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]));
    const seedRead = (file: string) => getProjectFileStateCache(cwd).set(join(cwd, file), { content: '', timestamp: Date.now() + 60_000, offset: undefined, limit: undefined, isPartialView: false } as any);
    markUserTurnBoundary();
    seedRead('big.txt');
    seedRead('blob.bin');
    const editResult = await run('Write', { file_path: 'big.txt', content: 'small now\n' });
    await run('Write', { file_path: 'blob.bin', content: 'text now\n' });
    expect(editResult.content).toMatch(/\/undo cannot revert this file/);

    const report = await undo();

    expect(read('big.txt')).toBe('small now\n');
    expect(read('blob.bin')).toBe('text now\n');
    expect(report).toMatch(/cannot undo big\.txt: 200 bytes is over undoMaxFileBytes/);
    expect(report).toMatch(/cannot undo blob\.bin: binary file/);
  });

  it('a file over the total storage cap is reported as not undoable', async () => {
    configSet('undoMaxTotalBytes', 8);
    invalidateConfigCache();
    writeFileSync(join(cwd, 'a.txt'), 'longer than the cap\n');
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');

    expect(await undo()).toMatch(/cannot undo a\.txt: undoMaxTotalBytes/);
    expect(read('a.txt')).toBe('v1\n');
  });
});

describe('turn undo keeps the model and the read state consistent', () => {
  it('stale read state is cleared and the model is told once, without file contents', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'secret-original\n');
    markUserTurnBoundary();
    await write('a.txt', 'secret-cesar\n');
    expect(getProjectFileStateCache(cwd).has(join(cwd, 'a.txt'))).toBe(true);

    await undo();

    expect(getProjectFileStateCache(cwd).has(join(cwd, 'a.txt'))).toBe(false);
    const prompt = consumeUndoNotice('next question');
    expect(prompt).toMatch(/UNDO NOTICE.*"a\.txt".*Do not reapply/s);
    expect(prompt).toMatch(/next question$/);
    expect(prompt).not.toMatch(/secret-/);
    expect(consumeUndoNotice('later')).toBe('later');
  });
});

describe('turn undo snapshot storage', () => {
  const sessionDirs = () => readdirSync(join(home, 'cesar-undo'));

  it('new session cannot undo the previous session', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'v0\n');
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');

    closeUndoSession();

    expect(await undo()).toMatch(/Nothing to undo/);
    expect(read('a.txt')).toBe('v1\n');
    expect(sessionDirs()).toEqual([]);
  });

  it('snapshots are owner-only, outside the repo, and contain no path of the repo', async () => {
    writeFileSync(join(cwd, '.env'), 'TOKEN=abc\n', { mode: 0o644 });
    markUserTurnBoundary();
    await write('.env', 'TOKEN=def\n');

    const dir = join(home, 'cesar-undo', sessionDirs()[0]);
    expect(statSync(join(home, 'cesar-undo')).mode & 0o777).toBe(0o700);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const blobs = readdirSync(dir);
    expect(blobs).toHaveLength(1);
    expect(statSync(join(dir, blobs[0])).mode & 0o777).toBe(0o600);
    expect(dir.startsWith(cwd)).toBe(false);

    await undo();
    expect(read('.env')).toBe('TOKEN=abc\n');
    expect(statSync(join(cwd, '.env')).mode & 0o777).toBe(0o644);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('corrupted snapshot is refused rather than written over the file', async () => {
    writeFileSync(join(cwd, 'a.txt'), 'v0\n');
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');
    const dir = join(home, 'cesar-undo', sessionDirs()[0]);
    writeFileSync(join(dir, readdirSync(dir)[0]), 'tampered\n');

    expect(await undo()).toMatch(/refused a\.txt: snapshot failed verification/);
    expect(read('a.txt')).toBe('v1\n');
  });

  it('stale session directories are removed by age and a fresh one is kept', async () => {
    mkdirSync(join(home, 'cesar-undo/stale'), { recursive: true });
    mkdirSync(join(home, 'cesar-undo/fresh'));
    const old = new Date(Date.now() - 1000 * 3_600_000);
    utimesSync(join(home, 'cesar-undo/stale'), old, old);
    writeFileSync(join(cwd, 'a.txt'), 'v0\n');
    markUserTurnBoundary();
    await write('a.txt', 'v1\n');

    expect(sessionDirs()).not.toContain('stale');
    expect(sessionDirs()).toContain('fresh');
  });

  it('per-edit checkpoints holding file contents are not readable by other users', () => {
    writeFileSync(join(cwd, '.env'), 'TOKEN=abc\n');
    const entry = takeSnapshot('Edit: .env', cwd, ['.env']);
    expect(statSync(join(home, 'snapshots', `${entry.id}.json`)).mode & 0o077).toBe(0);
  });
});
