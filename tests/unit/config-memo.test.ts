import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

// Fix 3: loadConfig() previously did up to 3 readFileSync+JSON.parse+merge on
// EVERY call (46 call sites, zero caching). It's now memoized in-process,
// keyed by the resolved config paths + each file's mtime (missing file =
// mtime 0) — same mtimes serves from cache (skipping the readFileSync calls
// entirely), a touched file forces a fresh read+merge, and
// invalidateConfigCache() clears the memo outright (belt-and-suspenders for
// a write landing within the same mtime tick as a following read).
//
// Contract (external review, fix 2): every call returns a FRESH object — a
// structuredClone of the cached merge, never the cached instance itself.
// Pre-memo, callers got a fresh object per call and some of the 46 call
// sites mutate the result (permissions arrays, engineModels, hooks, …);
// handing out the cached reference would let one caller's mutation poison
// the process-global cache for every later caller.
//
// `readFileSync` is wrapped (not just spied) because vitest can't spy
// directly on a frozen ESM module namespace ("Cannot redefine property");
// `vi.mock` with a passthrough factory sidesteps that while still letting
// real file reads happen underneath.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

let home = '';

afterEach(() => {
  vi.mocked(readFileSync).mockClear();
  cleanupTestAgonHome(home);
});

describe('loadConfig() memoization', () => {
  it('serves from cache (no re-read) when nothing changed — as a fresh, equal object', async () => {
    home = setupTestAgonHome('config-memo-same');
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ commitCoAuthor: 'v1' }));

    const { loadConfig } = await import('../../packages/core/src/config.js');
    const first = loadConfig();
    expect(first.commitCoAuthor).toBe('v1');

    vi.mocked(readFileSync).mockClear();
    const second = loadConfig();

    expect(second).toEqual(first); // same content — served from cache…
    expect(second).not.toBe(first); // …but a fresh clone, never the cached instance
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('a caller mutating the returned config cannot poison the cache for later callers', async () => {
    home = setupTestAgonHome('config-memo-mutation');
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ permissions: { allow: ['Read(a)'] } }));

    const { loadConfig } = await import('../../packages/core/src/config.js');
    const first = loadConfig();
    expect(first.permissions.allow).toEqual(['Read(a)']);

    // Mutate the returned object the way real call sites do (push into a
    // nested array, overwrite a record) — none of it may leak into the cache.
    first.permissions.allow.push('Bash(rm -rf /)');
    (first as { engineModels: Record<string, string> }).engineModels.claude = 'poisoned';
    (first as { commitCoAuthor: string }).commitCoAuthor = 'poisoned';

    const second = loadConfig(); // cache hit — same mtimes
    expect(second.permissions.allow).toEqual(['Read(a)']);
    expect((second as { engineModels: Record<string, string> }).engineModels.claude).toBeUndefined();
    expect(second.commitCoAuthor).not.toBe('poisoned');
  });

  it('returns a fresh result once the global config file is touched (mtime changes)', async () => {
    home = setupTestAgonHome('config-memo-touched');
    const path = agonHomePath('config.json');
    writeFileSync(path, JSON.stringify({ commitCoAuthor: 'v1' }));

    const { loadConfig } = await import('../../packages/core/src/config.js');
    const first = loadConfig();
    expect(first.commitCoAuthor).toBe('v1');

    // Rewrite with different content AND force the mtime forward so this
    // assertion doesn't depend on filesystem mtime resolution being finer
    // than the time it takes this test to run two statements.
    writeFileSync(path, JSON.stringify({ commitCoAuthor: 'v2' }));
    const bumped = new Date(Date.now() + 5000);
    utimesSync(path, bumped, bumped);

    vi.mocked(readFileSync).mockClear();
    const second = loadConfig();
    expect(second.commitCoAuthor).toBe('v2');
    expect(second).not.toBe(first);
    expect(readFileSync).toHaveBeenCalled();
  });

  it('treats a missing config file as mtime 0 and still caches correctly', async () => {
    home = setupTestAgonHome('config-memo-missing');
    // No config.json written at all.
    const { loadConfig } = await import('../../packages/core/src/config.js');
    const first = loadConfig();
    expect(first.commitCoAuthor).not.toBe('v1');

    vi.mocked(readFileSync).mockClear();
    const second = loadConfig();
    expect(second).toEqual(first);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('keys the cache per-cwd: a project .agon.json changing invalidates only that cwd', async () => {
    home = setupTestAgonHome('config-memo-cwd');
    const { loadConfig } = await import('../../packages/core/src/config.js');

    const projectDir = join(home, 'project');
    mkdirSync(projectDir, { recursive: true });
    const localPath = join(projectDir, '.agon.json');
    writeFileSync(localPath, JSON.stringify({ commitCoAuthor: 'project-v1' }));

    const globalOnly = loadConfig();
    const projectFirst = loadConfig(projectDir);
    expect(projectFirst.commitCoAuthor).toBe('project-v1');
    expect(globalOnly.commitCoAuthor).not.toBe('project-v1');

    // Re-reading the global (no cwd) config must still be cache-stable and
    // unaffected by the project-scoped read above.
    vi.mocked(readFileSync).mockClear();
    const globalAgain = loadConfig();
    expect(globalAgain).toEqual(globalOnly);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('invalidateConfigCache() forces a fresh read even when mtime hasn\'t changed', async () => {
    home = setupTestAgonHome('config-memo-invalidate');
    const path = agonHomePath('config.json');
    writeFileSync(path, JSON.stringify({ commitCoAuthor: 'v1' }));

    const { loadConfig, invalidateConfigCache } = await import('../../packages/core/src/config.js');
    const first = loadConfig();
    expect(first.commitCoAuthor).toBe('v1');

    // Overwrite WITHOUT bumping mtime (same-tick write hazard) — normally
    // this would still hit the memo, which is exactly what
    // invalidateConfigCache() exists to override.
    writeFileSync(path, JSON.stringify({ commitCoAuthor: 'v2' }));
    invalidateConfigCache();

    const second = loadConfig();
    expect(second.commitCoAuthor).toBe('v2');
  });

  it('configSet() calls invalidateConfigCache() internally, so a subsequent loadConfig() sees the write', async () => {
    home = setupTestAgonHome('config-memo-configset');
    const { loadConfig, configSet } = await import('../../packages/core/src/config.js');

    const first = loadConfig();
    expect(first.commitCoAuthor).not.toBe('via-configset');

    configSet('commitCoAuthor', 'via-configset');

    const second = loadConfig();
    expect(second.commitCoAuthor).toBe('via-configset');
  });
});
