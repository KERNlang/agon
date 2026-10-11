import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

// Read each source once per call. Content hashes reuse the parsed merge even
// when timestamps change. Changed bytes invalidate it even at the same mtime.
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
  it('reuses the parsed merge after checking current bytes and returns a fresh object', async () => {
    home = setupTestAgonHome('config-memo-same');
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ commitCoAuthor: 'v1' }));

    const { loadConfig, _configMemoCache } = await import('../../packages/core/src/signals/config.js');
    const first = loadConfig();
    const entries = [..._configMemoCache.values()];
    expect(first.commitCoAuthor).toBe('v1');

    vi.mocked(readFileSync).mockClear();
    const second = loadConfig();

    expect(second).toEqual(first); // same content — served from cache…
    expect(second).not.toBe(first); // …but a fresh clone, never the cached instance
    expect(vi.mocked(readFileSync).mock.calls).toEqual([[agonHomePath('config.json')], [agonHomePath('modular-host/current-generation.json')]]);
    expect([..._configMemoCache.values()].every((entry, index) => entry === entries[index])).toBe(true);
  });

  it('a caller mutating the returned config cannot poison the cache for later callers', async () => {
    home = setupTestAgonHome('config-memo-mutation');
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ permissions: { allow: ['Read(a)'] } }));

    const { loadConfig } = await import('../../packages/core/src/signals/config.js');
    const first = loadConfig();
    expect(first.permissions.allow).toEqual(['Read(a)']);

    // Mutate the returned object the way real call sites do (push into a
    // nested array, overwrite a record) — none of it may leak into the cache.
    first.permissions.allow.push('Bash(rm -rf /)');
    (first as { engineModels: Record<string, string> }).engineModels.claude = 'poisoned';
    (first as { commitCoAuthor: string }).commitCoAuthor = 'poisoned';

    const second = loadConfig(); // Cache hit: same contents.
    expect(second.permissions.allow).toEqual(['Read(a)']);
    expect((second as { engineModels: Record<string, string> }).engineModels.claude).toBeUndefined();
    expect(second.commitCoAuthor).not.toBe('poisoned');
  });

  it('returns a fresh result once the global config file is touched (mtime changes)', async () => {
    home = setupTestAgonHome('config-memo-touched');
    const path = agonHomePath('config.json');
    writeFileSync(path, JSON.stringify({ commitCoAuthor: 'v1' }));

    const { loadConfig } = await import('../../packages/core/src/signals/config.js');
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

  it('checks that a missing config file is still absent and caches its defaults', async () => {
    home = setupTestAgonHome('config-memo-missing');
    // No config.json written at all.
    const { loadConfig } = await import('../../packages/core/src/signals/config.js');
    const first = loadConfig();
    expect(first.commitCoAuthor).not.toBe('v1');

    vi.mocked(readFileSync).mockClear();
    const second = loadConfig();
    expect(second).toEqual(first);
    expect(vi.mocked(readFileSync).mock.calls).toEqual([[agonHomePath('config.json')], [agonHomePath('modular-host/current-generation.json')]]);
  });

  it('keys the cache per-cwd: a project .agon.json changing invalidates only that cwd', async () => {
    home = setupTestAgonHome('config-memo-cwd');
    const { loadConfig } = await import('../../packages/core/src/signals/config.js');

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
    expect(vi.mocked(readFileSync).mock.calls).toEqual([[agonHomePath('config.json')], [agonHomePath('modular-host/current-generation.json')]]);
  });

  it('invalidateConfigCache() forces a fresh read even when mtime hasn\'t changed', async () => {
    home = setupTestAgonHome('config-memo-invalidate');
    const path = agonHomePath('config.json');
    writeFileSync(path, JSON.stringify({ commitCoAuthor: 'v1' }));

    const { loadConfig, invalidateConfigCache } = await import('../../packages/core/src/signals/config.js');
    const first = loadConfig();
    expect(first.commitCoAuthor).toBe('v1');

    // Explicit invalidation remains supported alongside content checks.
    writeFileSync(path, JSON.stringify({ commitCoAuthor: 'v2' }));
    invalidateConfigCache();

    const second = loadConfig();
    expect(second.commitCoAuthor).toBe('v2');
  });

  it('configSet() calls invalidateConfigCache() internally, so a subsequent loadConfig() sees the write', async () => {
    home = setupTestAgonHome('config-memo-configset');
    const { loadConfig, configSet } = await import('../../packages/core/src/signals/config.js');

    const first = loadConfig();
    expect(first.commitCoAuthor).not.toBe('via-configset');

    configSet('commitCoAuthor', 'via-configset');

    const second = loadConfig();
    expect(second.commitCoAuthor).toBe('via-configset');
  });

  it('normalizes invalid UI motion config to the reduced-motion default', async () => {
    home = setupTestAgonHome('config-memo-ui-motion');
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ uiMotion: 'jitter', terminalMode: 'unknown' }));

    const { loadConfig } = await import('../../packages/core/src/signals/config.js');
    expect(loadConfig().uiMotion).toBe('reduced');
    expect(loadConfig().terminalMode).toBe('auto');
  });
});
