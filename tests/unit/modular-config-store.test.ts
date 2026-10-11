import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as kernel from '../../packages/mod-kernel/src/index.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

vi.mock('@kernlang/agon-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-kernel')>();
  return { ...actual, createScopedConfigStore: vi.fn(actual.createScopedConfigStore) };
});

let home = '';
afterEach(() => { if (home) cleanupTestAgonHome(home); home = ''; vi.restoreAllMocks(); });

function fixture() {
  home = setupTestAgonHome('kernel-config-store');
  let selectedHome = home;
  const merge = vi.fn((global: object, local: object, privateLocal: object) => ({
    label: 'default', nested: { values: ['original'] }, ...global, ...local, ...privateLocal,
  }));
  const withLock = vi.fn((_path: string, action: () => void) => action());
  const store = kernel.createScopedConfigStore({
    globalPath: () => join(selectedHome, 'config.json'),
    localName: '.agon.json', privateLocalName: '.agon.local.json', merge, withLock,
  });
  return { store, merge, withLock, selectHome: (path: string) => { selectedHome = path; } };
}

describe('Kernel configuration storage', () => {
  it('retains scope precedence and clone isolation on cache misses and hits', () => {
    const { store, merge } = fixture();
    const project = join(home, 'project');
    mkdirSync(project);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ label: 'global' }));
    writeFileSync(join(project, '.agon.json'), JSON.stringify({ label: 'project' }));
    writeFileSync(join(project, '.agon.local.json'), JSON.stringify({ label: 'private' }));
    const first = store.load(project);
    expect(first.label).toBe('private');
    first.nested.values.push('poison');
    const second = store.load(project);
    expect(second.nested.values).toEqual(['original']);
    second.nested.values.push('also poison');
    expect(store.load(project).nested.values).toEqual(['original']);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(store.load().label).toBe('global');
  });

  it('resolves the current home for each call without sharing cache slots', () => {
    const { store, selectHome } = fixture();
    const other = join(home, 'other');
    mkdirSync(other);
    writeFileSync(join(home, 'config.json'), '{"label":"first"}');
    writeFileSync(join(other, 'config.json'), '{"label":"second"}');
    const sameTime = new Date(1700000000000);
    for (const root of [home, other]) utimesSync(join(root, 'config.json'), sameTime, sameTime);
    expect(store.load().label).toBe('first');
    selectHome(other);
    expect(store.load().label).toBe('second');
    selectHome(home);
    expect(store.load().label).toBe('first');
  });

  it('reads inside the lock, preserves other keys and invalidates after a write', () => {
    const { store, withLock } = fixture();
    const path = join(home, 'config.json');
    store.load();
    store.load(join(home, 'project'));
    expect(store.cache.size).toBe(2);
    withLock.mockImplementation((lockPath, action) => {
      expect(lockPath).toBe(path + '.lock');
      writeFileSync(path, '{"other":"concurrent"}');
      action();
    });
    store.set('label', 'saved');
    expect(store.cache.size).toBe(0);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ other: 'concurrent', label: 'saved' });
    expect(store.load().label).toBe('saved');
  });

  it('explicit invalidation rereads changed bytes with the same mtime', () => {
    const { store } = fixture();
    const path = join(home, 'config.json');
    const sameTime = new Date(1700000000000);
    writeFileSync(path, '{"label":"first"}');
    utimesSync(path, sameTime, sameTime);
    expect(store.load().label).toBe('first');
    writeFileSync(path, '{"label":"second"}');
    utimesSync(path, sameTime, sameTime);
    expect(store.load().label).toBe('first');
    store.invalidate();
    expect(store.load().label).toBe('second');
  });

  it.each(['.agon.json', '.agon.local.json'])('rereads when %s changes its mtime', (name) => {
    const { store, merge } = fixture();
    const project = join(home, 'project');
    mkdirSync(project);
    const path = join(project, name);
    writeFileSync(path, '{"label":"first"}');
    const before = new Date(1700000000000);
    utimesSync(path, before, before);
    expect(store.load(project).label).toBe('first');
    writeFileSync(path, '{"label":"second"}');
    const after = new Date(1700000001000);
    utimesSync(path, after, after);
    expect(store.load(project).label).toBe('second');
    expect(merge).toHaveBeenCalledTimes(2);
  });

  it('propagates lock failures without writing or clearing the cache', () => {
    const { store, withLock, merge } = fixture();
    store.load();
    withLock.mockImplementation(() => { throw new Error('lock unavailable'); });
    expect(() => store.set('label', 'unsafe')).toThrow('lock unavailable');
    expect(store.load().label).toBe('default');
    expect(merge).toHaveBeenCalledTimes(1);
    expect(existsSync(join(home, 'config.json'))).toBe(false);
  });

  it('warns for malformed JSON but not an absent file', () => {
    const { store } = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(store.load().label).toBe('default');
    expect(warn).not.toHaveBeenCalled();
    writeFileSync(join(home, 'config.json'), '{broken');
    store.invalidate();
    expect(store.load().label).toBe('default');
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('failed to parse config'));
  });

  it('propagates write failures and retains the existing file and cache', () => {
    const { store, merge } = fixture();
    const path = join(home, 'config.json');
    writeFileSync(path, '{"label":"prior"}');
    store.load();
    mkdirSync(path + '.tmp');
    expect(() => store.set('label', 'replacement')).toThrow();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ label: 'prior' });
    expect(store.load().label).toBe('prior');
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it('keeps Core readers and writers on the same Kernel-owned cache', async () => {
    home = setupTestAgonHome('kernel-config-core-binding');
    const publicKernel = await import('@kernlang/agon-kernel');
    const core = await import('../../packages/core/src/signals/config.js');
    expect(publicKernel.createScopedConfigStore).toHaveBeenCalledTimes(1);
    const store = vi.mocked(publicKernel.createScopedConfigStore).mock.results[0]!.value;
    expect(core._configMemoCache).toBe(store.cache);
    core.configSet('debug', true);
    expect(core.loadConfig().debug).toBe(true);
    expect(store.cache.size).toBe(1);
    core.invalidateConfigCache();
    expect(store.cache.size).toBe(0);
  });
});
