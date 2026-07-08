import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import type { EngineDefinition } from '../../packages/core/src/generated/models/types.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

// Fix 2: EngineRegistry.findBinary used to shell out to `execFileSync('which', …)`
// per engine (~10 subprocess spawns, 5s timeout each) on first roster
// resolution. It's now an in-process PATH scan (statSync/accessSync, no
// child process) backed by a small on-disk cache at
// ~/.agon/cache/binaries.json keyed by a hash of PATH + the binary name.
// These tests exercise the public EngineRegistry.findBinary surface only —
// no internals are exported or mocked — plus direct reads of the cache file
// (via AGON_HOME sandboxing) to assert the cache's own behavior.

const tempDirs: string[] = [];
const savedPath = process.env.PATH;

function makeBinaryEngine(id: string, overrides: Partial<EngineDefinition> = {}): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    binary: id,
    searchPaths: [],
    isLocal: false,
    tier: 'user',
    timeout: 30,
    exec: { args: [] },
    ...overrides,
  } as EngineDefinition;
}

function makeFakeExecutable(dir: string, name: string): string {
  const p = join(dir, name);
  writeFileSync(p, '#!/bin/sh\necho hi\n');
  chmodSync(p, 0o755);
  return p;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
});

describe('EngineRegistry.findBinary — in-process PATH scan', () => {
  it('hit: resolves a bare binary name found on PATH', () => {
    const home = setupTestAgonHome('binpath-hit');
    try {
      const binDir = mkdtempSync(join(tmpdir(), 'agon-binpath-hit-'));
      tempDirs.push(binDir);
      const exe = makeFakeExecutable(binDir, 'agon-fixture-tool');
      process.env.PATH = binDir;

      const registry = new EngineRegistry();
      registry.register(makeBinaryEngine('fixture-tool-engine', { binary: 'agon-fixture-tool' }));

      expect(registry.findBinary(registry.get('fixture-tool-engine'))).toBe(exe);
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('miss: returns null when the binary is on neither PATH nor searchPaths', () => {
    const home = setupTestAgonHome('binpath-miss');
    try {
      const emptyDir = mkdtempSync(join(tmpdir(), 'agon-binpath-miss-'));
      tempDirs.push(emptyDir);
      process.env.PATH = emptyDir;

      const registry = new EngineRegistry();
      registry.register(makeBinaryEngine('nowhere-engine', { binary: 'agon-fixture-tool-does-not-exist' }));

      expect(registry.findBinary(registry.get('nowhere-engine'))).toBeNull();
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('absolute path: engine.binary containing a path separator resolves directly, bypassing PATH', () => {
    const home = setupTestAgonHome('binpath-absolute');
    try {
      const binDir = mkdtempSync(join(tmpdir(), 'agon-binpath-abs-'));
      tempDirs.push(binDir);
      const exe = makeFakeExecutable(binDir, 'direct-tool');
      // PATH deliberately does NOT contain binDir — absolute resolution
      // must not depend on PATH at all.
      process.env.PATH = mkdtempSync(join(tmpdir(), 'agon-binpath-abs-unrelated-'));
      tempDirs.push(process.env.PATH);

      const registry = new EngineRegistry();
      registry.register(makeBinaryEngine('absolute-engine', { binary: exe }));

      expect(registry.findBinary(registry.get('absolute-engine'))).toBe(exe);
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('skips non-executable files on PATH (matches `which` semantics)', () => {
    const home = setupTestAgonHome('binpath-not-exec');
    try {
      const binDir = mkdtempSync(join(tmpdir(), 'agon-binpath-notexec-'));
      tempDirs.push(binDir);
      const p = join(binDir, 'agon-not-executable');
      writeFileSync(p, 'not a script');
      chmodSync(p, 0o644); // no execute bit
      process.env.PATH = binDir;

      const registry = new EngineRegistry();
      registry.register(makeBinaryEngine('not-exec-engine', { binary: 'agon-not-executable' }));

      expect(registry.findBinary(registry.get('not-exec-engine'))).toBeNull();
    } finally {
      cleanupTestAgonHome(home);
    }
  });
});

describe('EngineRegistry.findBinary — ~/.agon/cache/binaries.json disk cache', () => {
  it('writes a resolved binary into the disk cache, keyed by a PATH hash', () => {
    const home = setupTestAgonHome('bincache-write');
    try {
      const binDir = mkdtempSync(join(tmpdir(), 'agon-bincache-write-'));
      tempDirs.push(binDir);
      const exe = makeFakeExecutable(binDir, 'cached-tool');
      process.env.PATH = binDir;

      const registry = new EngineRegistry();
      registry.register(makeBinaryEngine('cached-engine', { binary: 'cached-tool' }));
      expect(registry.findBinary(registry.get('cached-engine'))).toBe(exe);

      const cacheRaw = readFileSync(agonHomePath('cache', 'binaries.json'), 'utf-8');
      const cache = JSON.parse(cacheRaw);
      expect(typeof cache.pathHash).toBe('string');
      expect(cache.entries['cached-tool'].path).toBe(exe);
      expect(typeof cache.entries['cached-tool'].mtimeMs).toBe('number');
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('a fresh EngineRegistry instance reuses the disk cache instead of missing (same PATH)', () => {
    const home = setupTestAgonHome('bincache-hit');
    try {
      const binDir = mkdtempSync(join(tmpdir(), 'agon-bincache-hit-'));
      tempDirs.push(binDir);
      const exe = makeFakeExecutable(binDir, 'reused-tool');
      process.env.PATH = binDir;

      const registryA = new EngineRegistry();
      registryA.register(makeBinaryEngine('reused-engine', { binary: 'reused-tool' }));
      expect(registryA.findBinary(registryA.get('reused-engine'))).toBe(exe);

      // New instance -> empty in-process binaryCache -> must fall back to the
      // on-disk cache (or a fresh scan) and land on the same answer.
      const registryB = new EngineRegistry();
      registryB.register(makeBinaryEngine('reused-engine', { binary: 'reused-tool' }));
      expect(registryB.findBinary(registryB.get('reused-engine'))).toBe(exe);
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('invalidates on PATH change: a different PATH resolves to a different binary rather than a stale cached path', () => {
    const home = setupTestAgonHome('bincache-path-change');
    try {
      const dirA = mkdtempSync(join(tmpdir(), 'agon-bincache-a-'));
      const dirB = mkdtempSync(join(tmpdir(), 'agon-bincache-b-'));
      tempDirs.push(dirA, dirB);
      const exeA = makeFakeExecutable(dirA, 'switchable-tool');
      const exeB = makeFakeExecutable(dirB, 'switchable-tool');
      expect(exeA).not.toBe(exeB);

      process.env.PATH = dirA;
      const registry1 = new EngineRegistry();
      registry1.register(makeBinaryEngine('switch-engine', { binary: 'switchable-tool' }));
      expect(registry1.findBinary(registry1.get('switch-engine'))).toBe(exeA);

      // Change PATH and use a fresh registry instance (bypassing the
      // in-process binaryCache) — the disk cache is keyed by a PATH hash, so
      // this must resolve exeB, not the stale exeA.
      process.env.PATH = dirB;
      const registry2 = new EngineRegistry();
      registry2.register(makeBinaryEngine('switch-engine', { binary: 'switchable-tool' }));
      expect(registry2.findBinary(registry2.get('switch-engine'))).toBe(exeB);
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('a corrupt cache file falls back to a fresh scan instead of throwing', () => {
    const home = setupTestAgonHome('bincache-corrupt');
    try {
      const binDir = mkdtempSync(join(tmpdir(), 'agon-bincache-corrupt-'));
      tempDirs.push(binDir);
      const exe = makeFakeExecutable(binDir, 'corrupt-cache-tool');
      process.env.PATH = binDir;

      mkdirSync(agonHomePath('cache'), { recursive: true });
      writeFileSync(agonHomePath('cache', 'binaries.json'), '{ not valid json');

      const registry = new EngineRegistry();
      registry.register(makeBinaryEngine('corrupt-cache-engine', { binary: 'corrupt-cache-tool' }));

      expect(registry.findBinary(registry.get('corrupt-cache-engine'))).toBe(exe);
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('a stale cache entry pointing at a deleted file is detected and rescanned rather than returned', () => {
    const home = setupTestAgonHome('bincache-stale-entry');
    try {
      const binDir = mkdtempSync(join(tmpdir(), 'agon-bincache-stale-'));
      tempDirs.push(binDir);
      const exe = makeFakeExecutable(binDir, 'stale-entry-tool');
      process.env.PATH = binDir;

      // Prime the cache with a bogus entry under whatever pathHash the
      // registry will actually compute — simplest way to get a matching hash
      // without exporting the internal hasher is to let a real resolution
      // write it first, then corrupt just the path field afterward.
      const registry1 = new EngineRegistry();
      registry1.register(makeBinaryEngine('stale-entry-engine', { binary: 'stale-entry-tool' }));
      expect(registry1.findBinary(registry1.get('stale-entry-engine'))).toBe(exe);

      const cacheFile = agonHomePath('cache', 'binaries.json');
      const cache = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      cache.entries['stale-entry-tool'].path = join(binDir, 'this-file-was-deleted');
      cache.entries['stale-entry-tool'].mtimeMs = 123456789;
      writeFileSync(cacheFile, JSON.stringify(cache));

      const registry2 = new EngineRegistry();
      registry2.register(makeBinaryEngine('stale-entry-engine', { binary: 'stale-entry-tool' }));
      expect(registry2.findBinary(registry2.get('stale-entry-engine'))).toBe(exe);
    } finally {
      cleanupTestAgonHome(home);
    }
  });
});
