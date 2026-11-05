import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { configSet, executeToolCall, getProjectFileStateCache, invalidateConfigCache, listSnapshots, takeSnapshot } from '@kernlang/agon-core';
import type { ToolHandler } from '@kernlang/agon-core';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const host = vi.hoisted(() => ({ cwd: '' }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(),
  resolveWorkingDir: () => host.cwd,
}));

import { bashMayMutate } from '../../packages/cli/src/cesar/bash-read-only.js';
import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { closeUndoSession, markUserTurnBoundary, noteTurnToolEvent, undoLastTurn, withTurnUndo } from '../../packages/cli/src/cesar/turn-undo.js';
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
import { detectIntent } from '../../packages/cli/src/signals/intent.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';

let home = '';
let cwd = '';

const toolContext = () => ({ cwd, readFileState: (getProjectFileStateCache(cwd) as any).cache, permissionMode: 'auto', source: 'orchestrator' }) as any;
const run = async (name: string, input: Record<string, unknown>, registry = createCesarToolRegistry('undo-safety')) =>
  (await executeToolCall({ id: name, name, input }, toolContext(), registry, async () => true)).result;
const write = async (file: string, content: string) => {
  const registry = createCesarToolRegistry('undo-safety');
  if (existsSync(join(cwd, file))) await run('Read', { file_path: file }, registry);
  const result = await run('Write', { file_path: file, content }, registry);
  expect(result.ok, result.error).toBe(true);
};
const callbacks = (overrides: Record<string, unknown> = {}) => {
  const dispatch = vi.fn();
  const runAsJob = vi.fn();
  const cb = { ctx: {}, dispatch, runAsJob, lastUndoToken: null, setLastUndoToken: vi.fn(), askQuestion: async () => 'n', ...overrides } as unknown as DispatchCallbacks;
  return { cb, dispatch, runAsJob, messages: () => dispatch.mock.calls.map(([event]) => String(event.message)).join('\n') };
};
const read = (file: string) => readFileSync(join(cwd, file), 'utf8');
const failingHandler = (effect: () => void): ToolHandler => ({
  definition: { name: 'Write' },
  execute: async () => { effect(); return { ok: false, error: 'boom', content: '' }; },
}) as unknown as ToolHandler;

beforeAll(() => initializeProcessSurfaceAuthority('/tmp/agon-cesar-turn-undo-safety-authority'));
afterAll(() => disposeProcessSurfaceAuthority());
beforeEach(() => {
  home = setupTestAgonHome('turn-undo-safety');
  invalidateConfigCache();
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'turn-undo-safety-')));
  host.cwd = cwd;
});
afterEach(() => {
  closeUndoSession();
  cleanupTestAgonHome(home);
  rmSync(cwd, { recursive: true, force: true });
});

describe('snapshot storage', () => {
  it('existing world-readable snapshot storage holding file contents is locked down', () => {
    const dir = join(home, 'snapshots');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    writeFileSync(join(dir, 'old.json'), '{}');
    chmodSync(join(dir, 'old.json'), 0o644);
    writeFileSync(join(cwd, 'a'), 'secret');
    takeSnapshot('label', cwd, ['a']);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'old.json')).mode & 0o777).toBe(0o600);
  });

  it('snapshot storage swapped for a symlink never receives file contents', () => {
    const elsewhere = join(cwd, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(home, 'snapshots'));
    writeFileSync(join(cwd, 'a'), 'secret');
    expect(() => takeSnapshot('label', cwd, ['a'])).toThrow(/not a directory owned/);
    expect(listSnapshots()).toEqual([]);
  });
});

describe('metadata drift', () => {
  it('a later chmod on an edited file refuses undo instead of reapplying old permissions', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    chmodSync(join(cwd, 'a'), 0o644);
    markUserTurnBoundary();
    await write('a', 'v1');
    chmodSync(join(cwd, 'a'), 0o600);
    const report = undoLastTurn(cwd);
    expect(report.refused[0]?.reason).toMatch(/permissions or owner changed/);
    expect(read('a')).toBe('v1');
    expect(statSync(join(cwd, 'a')).mode & 0o777).toBe(0o600);
  });

  it('a later chmod on a created file refuses deletion', async () => {
    markUserTurnBoundary();
    await write('c', 'v1');
    chmodSync(join(cwd, 'c'), 0o600);
    expect(undoLastTurn(cwd).refused[0]?.reason).toMatch(/permissions or owner changed/);
    expect(existsSync(join(cwd, 'c'))).toBe(true);
  });

  const otherGroup = process.getgroups?.().find((gid) => gid !== process.getgid?.());
  it.skipIf(otherGroup === undefined)('a later chgrp on an edited file refuses undo', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    markUserTurnBoundary();
    await write('a', 'v1');
    chownSync(join(cwd, 'a'), process.getuid!(), otherGroup!);
    expect(undoLastTurn(cwd).refused[0]?.reason).toMatch(/permissions or owner changed/);
    expect(read('a')).toBe('v1');
  });

  it('undo restores the file permissions it recorded before the turn', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    chmodSync(join(cwd, 'a'), 0o640);
    markUserTurnBoundary();
    await write('a', 'v1');
    undoLastTurn(cwd);
    expect(read('a')).toBe('v0');
    expect(statSync(join(cwd, 'a')).mode & 0o777).toBe(0o640);
  });
});

describe('shell command classification', () => {
  it.each([
    'rm x', 'cp a b', 'mv a b', 'mkdir d', 'truncate -s0 a', "sed -i '' s/a/b/ f", 'perl -i -pe s/a/b/ f', 'npm test', 'FOO=1 cat a', '/bin/rm x', 'tee x', 'awk 1 f',
    'git diff --output=x', 'git branch -D main', 'git branch new', 'git -c core.pager=evil status', 'git stash', 'git commit -m x',
    'rg --pre ./evil x', 'fd -x rm', 'find . -delete', 'find . -exec rm {} ;', 'sort -o a b',
    'cat a; rm b', 'cat a && rm b', 'cat a || rm b', 'cat a | tee b', 'cat a & rm b', 'echo hi\nrm x', 'echo hi > x', 'echo hi >> x', 'cat < a',
    'echo $(rm x)', 'echo `rm x`', 'echo "$(rm x)"', 'cat <(rm x)', 'echo $X', 'echo "unterminated', 'ls 2>/dev/nullx',
  ])('unproven command %j counts as a possible file change', (command) => {
    expect(bashMayMutate(command)).toBe(true);
  });

  it.each([
    'ls -la', 'cat a b', 'git status', 'git log --oneline -5', 'git diff HEAD', 'git branch', 'git branch --show-current', 'rg "a|b" src', "grep 'x > y' f",
    'ls 2>/dev/null', 'cat a 2>&1 | head -5', 'find . -name "*.ts"', 'sed -n 1,20p f', 'cd src && ls', 'echo "a;b"', '',
  ])('proven read-only command %j raises no warning', (command) => {
    expect(bashMayMutate(command)).toBe(false);
  });

  it('a long shell command is not retained in full in the undo report', async () => {
    markUserTurnBoundary();
    noteTurnToolEvent('Bash', 'running', undefined, { command: `npm run x -- ${'y'.repeat(5000)}` }, cwd, 'long');
    expect(undoLastTurn(cwd).bashCommands[0].length).toBeLessThanOrEqual(200);
  });
});

describe('tool event lifecycle', () => {
  it('an engine write that errors after running leaves no false warning or undoable turn', () => {
    markUserTurnBoundary();
    noteTurnToolEvent('Edit', 'running', undefined, { file_path: 'x' }, cwd, 'id1');
    noteTurnToolEvent('Edit', 'error', undefined, undefined, cwd, 'id1');
    expect(undoLastTurn(cwd).status).toBe('empty');
  });

  it('a second successful write to the same path keeps its warning when the first errors', () => {
    markUserTurnBoundary();
    noteTurnToolEvent('Edit', 'running', undefined, { file_path: 'x' }, cwd, 'id1');
    noteTurnToolEvent('Edit', 'done', undefined, { file_path: 'x' }, cwd, 'id2');
    noteTurnToolEvent('Edit', 'error', undefined, undefined, cwd, 'id1');
    expect(undoLastTurn(cwd).untrackedWrites).toEqual(['x']);
  });

  it('a shell command that fails stays reported because it may have changed files first', () => {
    markUserTurnBoundary();
    noteTurnToolEvent('Bash', 'running', undefined, { command: 'rm x && false' }, cwd, 'id1');
    noteTurnToolEvent('Bash', 'error', undefined, undefined, cwd, 'id1');
    expect(undoLastTurn(cwd).bashCommands).toEqual(['rm x && false']);
  });

  it('a shell command the user rejected never ran, so it is not reported', () => {
    markUserTurnBoundary();
    noteTurnToolEvent('Bash', 'running', undefined, { command: 'rm x' }, cwd, 'id1');
    noteTurnToolEvent('Bash', 'rejected', undefined, undefined, cwd, 'id1');
    expect(undoLastTurn(cwd).status).toBe('empty');
  });
});

describe('failed edits', () => {
  it('a failed edit that left the file alone does not create an undoable turn', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    markUserTurnBoundary();
    noteTurnToolEvent('Write', 'running', undefined, { file_path: 'a' }, cwd);
    await withTurnUndo(failingHandler(() => {})).execute({ file_path: 'a' }, toolContext());
    expect(undoLastTurn(cwd).status).toBe('empty');
  });

  it('a failed edit that did change the file is reported and restored', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    markUserTurnBoundary();
    await withTurnUndo(failingHandler(() => writeFileSync(join(cwd, 'a'), 'partial'))).execute({ file_path: 'a' }, toolContext());
    const report = undoLastTurn(cwd);
    expect(report.failedButChanged).toEqual(['a']);
    expect(read('a')).toBe('v0');
  });

  it('a blob from a failed first edit does not evict a valid older turn', async () => {
    configSet('undoMaxTotalBytes', 2500);
    invalidateConfigCache();
    writeFileSync(join(cwd, 'old'), 'o'.repeat(1000));
    markUserTurnBoundary();
    await write('old', 'old-edited');
    writeFileSync(join(cwd, 'doomed'), 'd'.repeat(1000));
    markUserTurnBoundary();
    await withTurnUndo(failingHandler(() => {})).execute({ file_path: 'doomed' }, toolContext());
    writeFileSync(join(cwd, 'next'), 'n'.repeat(1000));
    markUserTurnBoundary();
    await write('next', 'next-edited');
    undoLastTurn(cwd);
    undoLastTurn(cwd);
    expect(read('old')).toBe('o'.repeat(1000));
  });
});

describe('/undo branches', () => {
  const undoDir = () => join(home, 'undo');
  const plantPatch = (token: string, mtime: Date) => {
    mkdirSync(undoDir(), { recursive: true });
    const path = join(undoDir(), `${token}.patch`);
    writeFileSync(path, 'not a patch\n');
    utimesSync(path, mtime, mtime);
  };

  it('a patch older than the last turn does not take precedence and overwrite the turn', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    plantPatch('older', new Date(Date.now() - 60_000));
    markUserTurnBoundary();
    await write('a', 'v1');
    const { cb, messages } = callbacks({ lastUndoToken: 'older' });
    await dispatchIntent(detectIntent('/undo'), '/undo', cb);
    expect(read('a')).toBe('v0');
    expect(messages()).toContain('Undo of last turn');
  });

  it('a stale patch token whose file is gone does not make the turn stack unreachable', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    markUserTurnBoundary();
    await write('a', 'v1');
    const setLastUndoToken = vi.fn();
    const { cb, messages } = callbacks({ lastUndoToken: 'gone', setLastUndoToken });
    await dispatchIntent(detectIntent('/undo'), '/undo', cb);
    expect(read('a')).toBe('v0');
    expect(setLastUndoToken).toHaveBeenCalledWith(null);
    expect(messages()).toContain('Undo of last turn');
  });

  it('declining a named checkpoint leaves later edits untouched', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    const snapshot = takeSnapshot('label', cwd, ['a']);
    writeFileSync(join(cwd, 'a'), 'user edit');
    const { cb, messages } = callbacks({ askQuestion: async () => 'n' });
    await dispatchIntent(detectIntent(`/undo ${snapshot.id}`), `/undo ${snapshot.id}`, cb);
    expect(read('a')).toBe('user edit');
    expect(messages()).toContain('not reverted');
  });

  it('a running job blocks /undo so it cannot race the writes of that job', async () => {
    writeFileSync(join(cwd, 'a'), 'v0');
    markUserTurnBoundary();
    await write('a', 'v1');
    const { cb, messages } = callbacks({ jobManager: { running: () => [{ id: '1' }] } });
    await dispatchIntent(detectIntent('/undo'), '/undo', cb);
    expect(read('a')).toBe('v1');
    expect(messages()).toContain('still running');
  });

  it.each([['undo', 'intentVariants:0064'], ['commit', 'intentVariants:0017']])('mod-routed /%s stays out of the job path where it would fail for lack of approval', async (publicId, registryId) => {
    const { cb, runAsJob } = callbacks();
    const eventBus = { emit: vi.fn(async () => {}) };
    await dispatchIntent({ type: publicId, _modSurface: { publicId, registryId, kind: 'intent', value: {} } }, `/${publicId}`, { ...cb, eventBus } as unknown as DispatchCallbacks);
    expect(runAsJob).not.toHaveBeenCalled();
    expect(eventBus.emit.mock.calls.filter(([name]: any) => name === 'post:dispatch')).toHaveLength(1);
  });
});
