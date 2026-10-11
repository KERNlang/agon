import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as kernel from '../../packages/mod-kernel/src/index.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';

vi.mock('@kernlang/agon-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-kernel')>();
  return { ...actual, createScopedConfigStore: vi.fn(actual.createScopedConfigStore) };
});

let home = '';
afterEach(() => { vi.unstubAllEnvs(); if (home) cleanupTestAgonHome(home); home = ''; vi.restoreAllMocks(); });

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
  it('follows changed home and host roots after Core has been imported', async () => {
    home = setupTestAgonHome('config-fence-dynamic-home');
    const firstHost = join(home, 'first-host');
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', firstHost);
    const core = await import('../../packages/core/src/signals/config.js');
    core.configSet('debug', false);
    expect(existsSync(join(firstHost, 'locks'))).toBe(true);
    for (const file of ['current-generation.json', 'desired-state.json', 'installed-index.json']) {
      expect(existsSync(join(firstHost, file))).toBe(false);
    }
    const nextHome = join(home, 'second-home'); mkdirSync(nextHome);
    const nextHost = join(nextHome, 'second-host');
    const oldOwner = await WriterFence.acquire(join(firstHost, 'locks', 'writer.json'), 'old-host');
    vi.stubEnv('AGON_HOME', nextHome);
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', nextHost);
    try {
      core.configSet('debug', true);
      expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).debug).toBe(false);
      expect(JSON.parse(readFileSync(join(nextHome, 'config.json'), 'utf8')).debug).toBe(true);
      expect(existsSync(join(nextHost, 'locks'))).toBe(true);
    } finally { await oldOwner.release(); }
  });

  it.each([false, true])('coordinates actual synchronous Core writes with the host fence (custom root=%s)', async custom => {
    home = setupTestAgonHome('config-publication-fence');
    const hostRoot = join(home, custom ? 'custom-host' : 'modular-host');
    if (custom) vi.stubEnv('AGON_MODULAR_HOST_ROOT', hostRoot);
    const path = join(home, 'config.json');
    const bytes = '{"debug":false,"unknown":"keep"}\n';
    writeFileSync(path, bytes);
    const owner = await WriterFence.acquire(join(hostRoot, 'locks', 'writer.json'), 'fixture.host');
    const core = await import('../../packages/core/src/signals/config.js');
    try {
      expect(() => core.configSet('debug', true)).toThrowError(expect.objectContaining({ code: 'MOD_HOST_BUSY' }));
      expect(readFileSync(path, 'utf8')).toBe(bytes);
    } finally { await owner.release(); }
    expect(core.configSet('debug', true)).toBeUndefined();
    expect(core.loadConfig().debug).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')).unknown).toBe('keep');
    expect(existsSync(join(hostRoot, 'locks', 'writer.json'))).toBe(false);
  });

  it('maps all nine aliases only to their assigned owners', async () => {
    home = setupTestAgonHome('settings-all-aliases');
    const fields = [
      ['autoReviewAfterForge', 'agon.forge', false], ['forgeFitnessTimeout', 'agon.forge', 17],
      ['autoReviewAfterImpl', 'agon.review', false], ['goalReviewEngines', 'agon.review', ['fixture-engine']],
      ['cesarAgenticContinuationLimit', 'agon.agent', 7], ['cesarMutateReflex', 'agon.mutate', false],
      ['forgeEnableSynthesis', 'agon.synthesis', true], ['forgeSynthesisTimeout', 'agon.synthesis', 19],
      ['skillSynthesisThreshold', 'agon.synthesis', 5],
    ] as const;
    const input = { ...Object.fromEntries(fields.map(([key, _owner, value]) => [key, value])),
      mods: { 'agon.forge': { goalReviewEngines: ['wrong-owner'] } } };
    writeFileSync(join(home, 'config.json'), JSON.stringify(input));
    const core = await import('../../packages/core/src/signals/config.js');
    const config = core.loadConfig();
    for (const [key, owner, value] of fields) {
      expect(config[key]).toEqual(value);
      expect(kernel.selectModSettings(config, owner)[key]).toEqual(value);
    }
    expect(config.goalReviewEngines).toEqual(['fixture-engine']);
  });

  it('preserves a malformed inactive namespace during an unrelated write', async () => {
    home = setupTestAgonHome('settings-unrelated-write');
    const path = join(home, 'config.json');
    writeFileSync(path, JSON.stringify({ mods: { 'agon.forge': 'future-format' }, forgeFitnessTimeout: 7 }));
    const core = await import('../../packages/core/src/signals/config.js');
    core.configSet('debug', true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ mods: { 'agon.forge': 'future-format' }, forgeFitnessTimeout: 7, debug: true });
  });
  it.each([null, [], false])('does not revive aliases discarded by namespace replacement: %j', async (replacement) => {
    home = setupTestAgonHome('settings-alias-replacement');
    const project = join(home, 'project'); mkdirSync(project);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ mods: { 'agon.forge': { forgeFitnessTimeout: 10 } } }));
    writeFileSync(join(project, '.agon.json'), JSON.stringify({ mods: { 'agon.forge': replacement } }));
    writeFileSync(join(project, '.agon.local.json'), JSON.stringify({ mods: { 'agon.forge': { autoReviewAfterForge: false } } }));
    const core = await import('../../packages/core/src/signals/config.js');
    const config = core.loadConfig(project);
    expect(kernel.selectModSettings(config, 'agon.forge')).toEqual({ autoReviewAfterForge: false });
    expect(config.forgeFitnessTimeout).toBe(120);
    expect(config.autoReviewAfterForge).toBe(false);
  });
  it.each([
    [false, false, false], [false, false, true], [false, true, false], [false, true, true],
    [true, false, false], [true, false, true], [true, true, false], [true, true, true],
  ])('keeps scope precedence across namespace spellings %j/%j/%j', async (...namespaced) => {
    home = setupTestAgonHome('settings-alias-precedence');
    const project = join(home, 'project'); mkdirSync(project);
    const paths = [join(home, 'config.json'), join(project, '.agon.json'), join(project, '.agon.local.json')];
    const layers = namespaced.map((useNamespace, index) => useNamespace
      ? { mods: { 'agon.forge': { forgeFitnessTimeout: index + 1 } } }
      : { forgeFitnessTimeout: index + 1 });
    paths.forEach((path, index) => writeFileSync(path, JSON.stringify(layers[index])));
    const core = await import('../../packages/core/src/signals/config.js');
    const result = core.loadConfig(project);
    expect(result.forgeFitnessTimeout).toBe(3);
    expect(kernel.selectModSettings(result, 'agon.forge').forgeFitnessTimeout).toBe(3);
    expect(core.loadConfig().forgeFitnessTimeout).toBe(1);
    paths.forEach((path, index) => expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(layers[index]));
  });

  it('prefers an explicit namespace within its scope and preserves false, zero and unknown values', async () => {
    home = setupTestAgonHome('settings-alias-explicit');
    const input = { forgeFitnessTimeout: 123, autoReviewAfterForge: true, goalReviewEngines: ['legacy'],
      mods: { 'agon.forge': { forgeFitnessTimeout: 0, autoReviewAfterForge: false, future: 'keep' },
        'agon.review': { goalReviewEngines: [] }, 'absent.mod': { untouched: true } } };
    const path = join(home, 'config.json'); writeFileSync(path, JSON.stringify(input));
    const core = await import('../../packages/core/src/signals/config.js');
    const result = core.loadConfig();
    expect(result.forgeFitnessTimeout).toBe(0);
    expect(result.autoReviewAfterForge).toBe(false);
    expect(result.goalReviewEngines).toEqual([]);
    expect(kernel.selectModSettings(result, 'agon.forge')).toEqual(input.mods['agon.forge']);
    expect(kernel.selectModSettings(result, 'absent.mod')).toEqual({ untouched: true });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(input);
  });

  it('updates the legacy alias and its namespace together without discarding other owners', async () => {
    home = setupTestAgonHome('settings-alias-write');
    const path = join(home, 'config.json');
    writeFileSync(path, JSON.stringify({ forgeFitnessTimeout: 1, debug: true,
      mods: { 'agon.forge': { forgeFitnessTimeout: 2, future: 'keep' }, 'absent.mod': 'retain' } }));
    const core = await import('../../packages/core/src/signals/config.js');
    core.loadConfig();
    core.configSet('forgeFitnessTimeout', 0);
    expect(core.loadConfig().forgeFitnessTimeout).toBe(0);
    expect(kernel.selectModSettings(core.loadConfig(), 'agon.forge')).toEqual({ forgeFitnessTimeout: 0, future: 'keep' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ forgeFitnessTimeout: 0, debug: true,
      mods: { 'agon.forge': { forgeFitnessTimeout: 0, future: 'keep' }, 'absent.mod': 'retain' } });
  });

  it.each([null, [], 'future-format'])('refuses to overwrite a malformed owner namespace: %j', async (value) => {
    home = setupTestAgonHome('settings-alias-invalid');
    const path = join(home, 'config.json');
    const bytes = JSON.stringify({ mods: { 'agon.forge': value } }); writeFileSync(path, bytes);
    const core = await import('../../packages/core/src/signals/config.js');
    expect(() => core.configSet('forgeFitnessTimeout', 5)).toThrow(/namespace/);
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });

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
    vi.resetModules();
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

  it('runs owner write policy on fresh locked state and preserves data if policy refuses', () => {
    home = setupTestAgonHome('settings-write-policy');
    const path = join(home, 'config.json');
    let locked = false;
    let rejected = false;
    const policy = vi.fn((existing: Readonly<Partial<{ label: string }>>, key: 'label', value: string | undefined) => {
      expect(locked).toBe(true);
      if (rejected) throw new Error('owner refused');
      expect(existing).toEqual({ concurrent: 'retained' });
      return { ...existing, [key]: value };
    });
    const store = kernel.createScopedConfigStore({ globalPath: () => path, localName: '.agon.json', privateLocalName: '.agon.local.json',
      merge: (global: Partial<{ label: string }>) => ({ label: 'default', ...global }), prepareWrite: policy,
      withLock: (_path, action) => {
        if (!rejected) writeFileSync(path, '{"concurrent":"retained"}');
        locked = true;
        try { action(); } finally { locked = false; }
      },
    });
    store.set('label', 'saved');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ concurrent: 'retained', label: 'saved' });
    expect(store.load().label).toBe('saved');
    const bytes = readFileSync(path, 'utf8');
    const cacheSize = store.cache.size;
    rejected = true;
    expect(() => store.set('label', 'discard')).toThrow('owner refused');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
    expect(store.cache.size).toBe(cacheSize);
    expect(policy).toHaveBeenCalledTimes(2);
  });

  it('merges mod namespaces and owner fields across all three config layers', async () => {
    home = setupTestAgonHome('mod-settings-layers');
    const project = join(home, 'project');
    mkdirSync(project);
    const core = await import('../../packages/core/src/signals/config.js');
    const layers = [
      { debug: false, mods: { 'example.one': { first: 1, shared: 'global', nested: { original: true } }, 'example.two': { retained: true } } },
      { debug: true, mods: { 'example.one': { second: 2, shared: 'project', nested: { replacement: true } } } },
      { debug: false, mods: { 'example.one': { shared: 'private' }, 'example.unknown': { retained: 'unknown' } } },
    ];
    const paths = [join(home, 'config.json'), join(project, '.agon.json'), join(project, '.agon.local.json')];
    paths.forEach((path, index) => writeFileSync(path, JSON.stringify(layers[index])));
    core.invalidateConfigCache();
    const loaded = core.loadConfig(project);
    expect(loaded.debug).toBe(false);
    expect(kernel.selectModSettings(loaded, 'example.one')).toEqual({ first: 1, second: 2, shared: 'private', nested: { replacement: true } });
    expect(kernel.selectModSettings(loaded, 'example.two')).toEqual({ retained: true });
    expect(kernel.selectModSettings(loaded, 'example.unknown')).toEqual({ retained: 'unknown' });
    expect(kernel.selectModSettings(core.loadConfig(), 'example.one')).toEqual(layers[0].mods['example.one']);
    paths.forEach((path, index) => expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(layers[index]));
  });

  it('retains unknown values without applying them and rejects malformed namespace maps', () => {
    expect(kernel.mergeModSettingsLayers({}, {})).toBeUndefined();
    expect(kernel.mergeModSettingsLayers({ mods: {} }, {})).toEqual({});
    const merged = kernel.mergeModSettingsLayers({ mods: { unknown: 'future format', selected: { value: false } } }, { mods: { selected: { count: 0 } } });
    expect(merged).toEqual({ unknown: 'future format', selected: { value: false, count: 0 } });
    expect(kernel.selectModSettings({ mods: merged }, 'selected')).toEqual({ value: false, count: 0 });
    expect(() => kernel.selectModSettings({ mods: merged }, 'unknown')).toThrow(/namespace/);
    for (const mods of [null, [], 'invalid']) expect(() => kernel.mergeModSettingsLayers({ mods })).toThrow(/namespaces/);
    const inherited = Object.create({ mods: { unowned: { value: true } } });
    expect(kernel.mergeModSettingsLayers(inherited)).toBeUndefined();
  });
});
