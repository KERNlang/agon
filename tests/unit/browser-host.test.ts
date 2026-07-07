import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Throwaway AGON_HOME before anything resolves a path (agonPath resolves at call time).
process.env.AGON_HOME = mkdtempSync(join(tmpdir(), 'agon-browser-host-test-'));

import {
  HOST_NAME,
  PROTOCOL,
  MAX_FRAME_BYTES,
  encodeFrame,
  decodeFrames,
  isExtensionOrigin,
  validatePair,
  nativeHostDir,
  manifestPath,
  buildHostManifest,
  parseConnRecord,
  originCovered,
  findReusableServe,
  runPair,
} from '../../packages/cli/src/generated/bridge/browser-host.js';
import type { PairDeps, ServeConnRecord } from '../../packages/cli/src/generated/bridge/browser-host.js';

import {
  resolveInstallBrowsers,
  resolveLauncherPath,
  resolveCliEntry,
  isPidAlive,
  runBrowserHostInstall,
  serveSpawnPath,
  buildHostWrapperScript,
  readInstallState,
  listOwnedServes,
  browserHostStatePath,
} from '../../packages/cli/src/generated/commands/browser-host.js';

const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop';
const VALID_ORIGIN = `chrome-extension://${VALID_ID}`;

// ── Frame codec ────────────────────────────────────────────────────────────────

describe('browser-host — native-messaging frame codec', () => {
  it('encodeFrame prefixes a 4-byte LE length and round-trips through decodeFrames', () => {
    const buf = encodeFrame({ ok: true, protocol: PROTOCOL });
    expect(buf.readUInt32LE(0)).toBe(buf.length - 4);
    const out = decodeFrames(buf);
    expect(out.overflow).toBe(false);
    expect(out.rest.length).toBe(0);
    expect(JSON.parse(out.frames[0])).toEqual({ ok: true, protocol: 1 });
  });

  it('decodes multiple frames and keeps a partial trailing frame as rest', () => {
    const a = encodeFrame({ cmd: 'pair' });
    const b = encodeFrame({ cmd: 'ping' });
    const buf = Buffer.concat([a, b, Buffer.from([0x05, 0x00])]); // 2 whole + a 2-byte partial header
    const out = decodeFrames(buf);
    expect(out.overflow).toBe(false);
    expect(out.frames.map((f) => JSON.parse(f).cmd)).toEqual(['pair', 'ping']);
    expect(out.rest.length).toBe(2);
  });

  it('reassembles a frame whose header and payload arrive in separate chunks', () => {
    const full = encodeFrame({ cmd: 'pair', origin: VALID_ORIGIN, protocol: 1 });
    const chunk1 = full.subarray(0, 3); // partial 4-byte header
    const chunk2 = full.subarray(3);
    const p1 = decodeFrames(chunk1);
    expect(p1.frames).toEqual([]);
    expect(p1.rest.length).toBe(3);
    const p2 = decodeFrames(Buffer.concat([p1.rest, chunk2]));
    expect(p2.frames.map((f) => JSON.parse(f).cmd)).toEqual(['pair']);
    expect(p2.rest.length).toBe(0);
  });

  it('a sub-header buffer (<4 bytes) is all rest, no frames, no overflow', () => {
    const out = decodeFrames(Buffer.from([0x01, 0x02]));
    expect(out).toMatchObject({ frames: [], overflow: false });
    expect(out.rest.length).toBe(2);
  });

  it('flags an oversized length-prefix as overflow (unrecoverable) and still returns earlier frames', () => {
    const good = encodeFrame({ cmd: 'pair' });
    const bad = Buffer.alloc(4);
    bad.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
    const out = decodeFrames(Buffer.concat([good, bad, Buffer.from('junk')]));
    expect(out.overflow).toBe(true);
    expect(out.frames.map((f) => JSON.parse(f).cmd)).toEqual(['pair']);
  });

  it('encodeFrame rejects an oversize payload', () => {
    const huge = { blob: 'x'.repeat(MAX_FRAME_BYTES + 100) };
    expect(() => encodeFrame(huge)).toThrow(/too large/);
  });
});

// ── Schema + origin validation ──────────────────────────────────────────────────

describe('browser-host — pair schema + origin validation', () => {
  it('isExtensionOrigin: accepts a 32-char a–p origin, rejects malformed / trailing slash', () => {
    expect(isExtensionOrigin(VALID_ORIGIN)).toBe(true);
    expect(isExtensionOrigin(`${VALID_ORIGIN}/`)).toBe(false); // trailing slash is the manifest form, not the pair form
    expect(isExtensionOrigin('chrome-extension://short')).toBe(false);
    expect(isExtensionOrigin('https://evil.example')).toBe(false);
    expect(isExtensionOrigin(`chrome-extension://${VALID_ID}z`)).toBe(false); // z outside a–p + too long
  });

  it('validatePair: a well-formed pair to the installed origin is ok', () => {
    const v = validatePair({ cmd: 'pair', origin: VALID_ORIGIN, protocol: 1 }, [VALID_ORIGIN]);
    expect(v).toEqual({ ok: true, origin: VALID_ORIGIN });
  });

  it('validatePair: wrong protocol → error before anything else', () => {
    expect(validatePair({ cmd: 'pair', origin: VALID_ORIGIN, protocol: 2 }, [VALID_ORIGIN])).toMatchObject({ ok: false });
    expect(validatePair({ cmd: 'pair', origin: VALID_ORIGIN }, [VALID_ORIGIN]).error).toMatch(/protocol/);
  });

  it('validatePair: unknown cmd → {ok:false, error:"unknown cmd"}', () => {
    expect(validatePair({ cmd: 'nuke', origin: VALID_ORIGIN, protocol: 1 }, [VALID_ORIGIN])).toEqual({ ok: false, error: 'unknown cmd' });
  });

  it('validatePair: malformed origin field → invalid origin', () => {
    expect(validatePair({ cmd: 'pair', origin: 'https://x', protocol: 1 }, [VALID_ORIGIN]).error).toMatch(/invalid origin/);
    expect(validatePair({ cmd: 'pair', protocol: 1 }, [VALID_ORIGIN]).error).toMatch(/invalid origin/);
  });

  it('validatePair: a valid origin that is NOT in the installed allowlist → origin not permitted', () => {
    const other = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
    expect(validatePair({ cmd: 'pair', origin: other, protocol: 1 }, [VALID_ORIGIN]).error).toMatch(/not permitted/);
  });

  it('validatePair: a non-object frame → malformed request', () => {
    expect(validatePair(null, [VALID_ORIGIN]).error).toMatch(/malformed/);
    expect(validatePair('pair', [VALID_ORIGIN]).error).toMatch(/malformed/);
  });

  it('validatePair: a MULTI-origin allowlist accepts a pair from any member (dev id + a second/store id)', () => {
    const secondOrigin = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
    const allowlist = [VALID_ORIGIN, secondOrigin];
    expect(validatePair({ cmd: 'pair', origin: VALID_ORIGIN, protocol: 1 }, allowlist)).toEqual({ ok: true, origin: VALID_ORIGIN });
    expect(validatePair({ cmd: 'pair', origin: secondOrigin, protocol: 1 }, allowlist)).toEqual({ ok: true, origin: secondOrigin });
    const thirdOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(validatePair({ cmd: 'pair', origin: thirdOrigin, protocol: 1 }, allowlist).error).toMatch(/not permitted/);
  });
});

// ── Manifest path + content per platform ─────────────────────────────────────────

describe('browser-host — manifest path + content per platform', () => {
  it('nativeHostDir: macOS Chrome + Chromium under Application Support', () => {
    expect(nativeHostDir('darwin', '/Users/x', 'chrome')).toBe('/Users/x/Library/Application Support/Google/Chrome/NativeMessagingHosts');
    expect(nativeHostDir('darwin', '/Users/x', 'chromium')).toBe('/Users/x/Library/Application Support/Chromium/NativeMessagingHosts');
  });

  it('nativeHostDir: Linux google-chrome + chromium under ~/.config', () => {
    expect(nativeHostDir('linux', '/home/x', 'chrome')).toBe('/home/x/.config/google-chrome/NativeMessagingHosts');
    expect(nativeHostDir('linux', '/home/x', 'chromium')).toBe('/home/x/.config/chromium/NativeMessagingHosts');
  });

  it('nativeHostDir: unsupported platform/browser → undefined (Windows handled via registry, documented)', () => {
    expect(nativeHostDir('win32', 'C:/Users/x', 'chrome')).toBeUndefined();
    expect(nativeHostDir('darwin', '/Users/x', 'firefox')).toBeUndefined();
    expect(nativeHostDir('linux', '/home/x', 'brave')).toBeUndefined();
  });

  it('manifestPath: <dir>/com.kernlang.agon.json', () => {
    expect(manifestPath('/some/dir')).toBe('/some/dir/com.kernlang.agon.json');
    expect(HOST_NAME).toBe('com.kernlang.agon');
  });

  it('buildHostManifest: exact wire shape, exactly one allowed_origins with a trailing slash (single-id install)', () => {
    const m = buildHostManifest('/abs/dist/browser-host.js', [VALID_ORIGIN]);
    expect(m.name).toBe('com.kernlang.agon');
    expect(m.type).toBe('stdio');
    expect(m.path).toBe('/abs/dist/browser-host.js');
    expect(m.allowed_origins).toEqual([`${VALID_ORIGIN}/`]);
    expect(m.allowed_origins).toHaveLength(1);
    expect(typeof m.description).toBe('string');
  });

  it('buildHostManifest: collapses a stray trailing slash rather than doubling it', () => {
    const m = buildHostManifest('/x', [`${VALID_ORIGIN}/`]);
    expect(m.allowed_origins).toEqual([`${VALID_ORIGIN}/`]);
  });

  it('buildHostManifest: multiple origins (dev id + a second/store id) each get a trailing slash', () => {
    const secondOrigin = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
    const m = buildHostManifest('/x', [VALID_ORIGIN, secondOrigin]);
    expect(m.allowed_origins).toEqual([`${VALID_ORIGIN}/`, `${secondOrigin}/`]);
  });
});

// ── Connection-record parsing + stale detection ──────────────────────────────────

describe('browser-host — connection-file parsing + stale/reuse logic', () => {
  const rec = (over: Partial<Record<string, unknown>> = {}): string =>
    JSON.stringify({ url: 'http://127.0.0.1:8787', token: 'tok', sessionId: 'serve-1', pid: 4242, allowedOrigins: [VALID_ORIGIN], ...over });

  it('parseConnRecord: a valid file parses to the needed fields', () => {
    expect(parseConnRecord(rec())).toEqual({ url: 'http://127.0.0.1:8787', token: 'tok', sessionId: 'serve-1', pid: 4242, allowedOrigins: [VALID_ORIGIN] });
  });

  it('parseConnRecord: null on invalid JSON, missing pid (legacy), or bad types — never throws', () => {
    expect(parseConnRecord('not json')).toBeNull();
    expect(parseConnRecord(rec({ pid: undefined }))).toBeNull(); // legacy pid-less file
    expect(parseConnRecord(rec({ pid: 0 }))).toBeNull();
    expect(parseConnRecord(rec({ url: 42 }))).toBeNull();
    expect(parseConnRecord(rec({ allowedOrigins: 'nope' }))).toBeNull();
  });

  it('originCovered: exact membership', () => {
    expect(originCovered([VALID_ORIGIN], VALID_ORIGIN)).toBe(true);
    expect(originCovered([], VALID_ORIGIN)).toBe(false);
    expect(originCovered(['https://other'], VALID_ORIGIN)).toBe(false);
  });

  it('findReusableServe: picks a live, origin-covering record; skips dead + non-covering', () => {
    const records = [
      parseConnRecord(rec({ pid: 111, sessionId: 'dead' }))!, // dead pid
      parseConnRecord(rec({ pid: 222, allowedOrigins: ['https://x'] }))!, // wrong origin
      parseConnRecord(rec({ pid: 333, sessionId: 'live', url: 'http://127.0.0.1:9000' }))!, // live + covering
    ];
    const alive = (pid: number) => pid === 333;
    const found = findReusableServe(records, VALID_ORIGIN, alive);
    expect(found?.sessionId).toBe('live');
  });

  it('findReusableServe: a serve whose pid is dead (stale file) is never reused', () => {
    const records = [parseConnRecord(rec({ pid: 555 }))!];
    expect(findReusableServe(records, VALID_ORIGIN, () => false)).toBeNull();
  });
});

// ── The pair state machine (deps faked) ──────────────────────────────────────────

function baseDeps(over: Partial<PairDeps> = {}): PairDeps {
  return {
    installedOrigins: [VALID_ORIGIN],
    acquireLock: () => () => {},
    listServeRecords: () => [],
    isAlive: () => true,
    spawnServe: () => 9999,
    waitForServe: async () => ({ url: 'http://127.0.0.1:5000', token: 'fresh', sessionId: 'serve-new', pid: 9999, allowedOrigins: [VALID_ORIGIN] }),
    recordOwner: () => {},
    ...over,
  };
}

const pairMsg = { cmd: 'pair', origin: VALID_ORIGIN, protocol: 1 };

describe('browser-host — pair state machine (reuse vs spawn vs error)', () => {
  it('REUSE: a live origin-covering serve → started:false with its url+token, no spawn', async () => {
    let spawned = false;
    const deps = baseDeps({
      listServeRecords: () => [{ url: 'http://127.0.0.1:8787', token: 'reused', sessionId: 'serve-old', pid: 42, allowedOrigins: [VALID_ORIGIN] }],
      isAlive: () => true,
      spawnServe: () => { spawned = true; return 1; },
    });
    const resp = await runPair(pairMsg, deps);
    expect(resp).toEqual({ ok: true, url: 'http://127.0.0.1:8787', token: 'reused', started: false, protocol: 1 });
    expect(spawned).toBe(false);
  });

  it('SPAWN: no reusable serve → spawn, wait, record owner, started:true', async () => {
    const owned: ServeConnRecord[] = [];
    const spawnedOrigins: string[] = [];
    const deps = baseDeps({
      listServeRecords: () => [],
      spawnServe: (o) => { spawnedOrigins.push(o); return 9999; },
      recordOwner: (r) => owned.push(r),
    });
    const resp = await runPair(pairMsg, deps);
    expect(resp).toMatchObject({ ok: true, token: 'fresh', started: true, protocol: 1 });
    expect(spawnedOrigins).toEqual([VALID_ORIGIN]); // fixed spawn command, our origin only
    expect(owned).toHaveLength(1);
    expect(owned[0].pid).toBe(9999);
  });

  it('SPAWN: a MULTI-origin install (dev id + a second/store id) accepts + spawns for the second id', async () => {
    const secondOrigin = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
    const spawnedOrigins: string[] = [];
    const deps = baseDeps({
      installedOrigins: [VALID_ORIGIN, secondOrigin],
      listServeRecords: () => [],
      spawnServe: (o) => { spawnedOrigins.push(o); return 9999; },
      waitForServe: async () => ({ url: 'http://127.0.0.1:5001', token: 'fresh2', sessionId: 'serve-new2', pid: 9999, allowedOrigins: [secondOrigin] }),
    });
    const resp = await runPair({ cmd: 'pair', origin: secondOrigin, protocol: 1 }, deps);
    expect(resp).toMatchObject({ ok: true, token: 'fresh2', started: true, protocol: 1 });
    expect(spawnedOrigins).toEqual([secondOrigin]); // spawned with the ONE origin that actually paired, not the whole allowlist
  });

  it('ERROR: invalid origin never touches the lock or spawns', async () => {
    let lockTaken = false;
    let spawned = false;
    const deps = baseDeps({
      acquireLock: () => { lockTaken = true; return () => {}; },
      spawnServe: () => { spawned = true; return 1; },
    });
    const resp = await runPair({ cmd: 'pair', origin: 'https://evil.example', protocol: 1 }, deps);
    expect(resp.ok).toBe(false);
    expect(lockTaken).toBe(false);
    expect(spawned).toBe(false);
  });

  it('ERROR: unknown cmd → {ok:false, error:"unknown cmd"}', async () => {
    const resp = await runPair({ cmd: 'exec', origin: VALID_ORIGIN, protocol: 1 }, baseDeps());
    expect(resp).toEqual({ ok: false, error: 'unknown cmd', protocol: 1 });
  });

  it('ERROR: lock busy → {ok:false} and no spawn', async () => {
    let spawned = false;
    const deps = baseDeps({ acquireLock: () => null, spawnServe: () => { spawned = true; return 1; } });
    const resp = await runPair(pairMsg, deps);
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/in progress/);
    expect(spawned).toBe(false);
  });

  it('ERROR: serve never becomes ready → {ok:false}, lock released', async () => {
    let released = false;
    const deps = baseDeps({
      waitForServe: async () => null,
      acquireLock: () => () => { released = true; },
    });
    const resp = await runPair(pairMsg, deps);
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/did not become ready/);
    expect(released).toBe(true);
  });

  it('ERROR: a failed spawn (pid <= 0) fails fast without polling waitForServe', async () => {
    let waited = false;
    const deps = baseDeps({
      listServeRecords: () => [],
      spawnServe: () => -1,
      waitForServe: async () => { waited = true; return null; },
    });
    const resp = await runPair(pairMsg, deps);
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/failed to spawn/);
    expect(waited).toBe(false); // never entered the 15s poll
  });

  it('CONCURRENCY: the re-scan under the lock reuses a serve a racer just spawned (no double-spawn)', async () => {
    // First call sees nothing and spawns; a second call, after the first wrote its
    // connection file, must reuse it. Simulate by flipping listServeRecords after spawn.
    let records: ServeConnRecord[] = [];
    let spawnCount = 0;
    const deps = baseDeps({
      listServeRecords: () => records,
      spawnServe: () => { spawnCount++; return 7000; },
      waitForServe: async () => {
        const r = { url: 'http://127.0.0.1:7000', token: 't', sessionId: 'serve-race', pid: 7000, allowedOrigins: [VALID_ORIGIN] };
        records = [r]; // now visible to the next caller
        return r;
      },
    });
    const first = await runPair(pairMsg, deps);
    const second = await runPair(pairMsg, deps);
    expect(first.started).toBe(true);
    expect(second.started).toBe(false); // reused, not re-spawned
    expect(spawnCount).toBe(1);
  });
});

// ── Command helpers ──────────────────────────────────────────────────────────────

describe('browser-host — command helpers', () => {
  it('resolveInstallBrowsers: default chrome; comma list; empty → chrome', () => {
    expect(resolveInstallBrowsers(undefined)).toEqual(['chrome']);
    expect(resolveInstallBrowsers('chrome,chromium')).toEqual(['chrome', 'chromium']);
    expect(resolveInstallBrowsers('  ,  ')).toEqual(['chrome']);
  });

  it('resolveLauncherPath: sibling browser-host.js next to the CLI entry', () => {
    expect(resolveLauncherPath('/opt/agon/dist/index.js')).toBe('/opt/agon/dist/browser-host.js');
  });

  it('resolveCliEntry: sibling index.js next to the launcher (never spawns itself)', () => {
    expect(resolveCliEntry('/opt/agon/dist/browser-host.js')).toBe('/opt/agon/dist/index.js');
  });

  it('isPidAlive: this process is alive; an absurd pid is not', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2 ** 30)).toBe(false);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
  });

  it("serveSpawnPath: install-time PATH wins over the host's stripped PATH and gains node + user bin dirs", () => {
    const out = serveSpawnPath(
      '/Users/u/.nvm/versions/node/v22/bin:/usr/bin:/bin',
      '/usr/bin:/bin:/usr/sbin:/sbin',
      '/Users/u/.nvm/versions/node/v22/bin/node',
      '/Users/u',
    );
    const parts = out.split(':');
    // Base order preserved: the install-time PATH leads.
    expect(parts[0]).toBe('/Users/u/.nvm/versions/node/v22/bin');
    // node's own bin dir was already present — not duplicated.
    expect(parts.filter((p) => p === '/Users/u/.nvm/versions/node/v22/bin')).toHaveLength(1);
    expect(parts).toContain('/Users/u/.local/bin');
    expect(parts).toContain('/opt/homebrew/bin');
    expect(parts).toContain('/usr/local/bin');
    // Chrome's stripped PATH was ignored entirely (its extra sbin dirs don't leak in).
    expect(parts).not.toContain('/usr/sbin');
  });

  it("serveSpawnPath: no install-time PATH recorded → falls back to the current PATH, still appends node's bin dir", () => {
    const out = serveSpawnPath('', '/usr/bin:/bin', '/opt/node/bin/node', '/Users/u');
    const parts = out.split(':');
    expect(parts[0]).toBe('/usr/bin');
    expect(parts).toContain('/opt/node/bin');
    expect(parts).toContain('/Users/u/.local/bin');
  });

  it('serveSpawnPath: dedup ignores trailing slashes (a /usr/local/bin/ base entry blocks the appended /usr/local/bin)', () => {
    const out = serveSpawnPath('/usr/local/bin/:/usr/bin', '', '/opt/node/bin/node', '/Users/u');
    const parts = out.split(':');
    expect(parts.filter((p) => p.replace(/\/+$/, '') === '/usr/local/bin')).toHaveLength(1);
  });

  it('buildHostWrapperScript: single-quotes paths so $, backticks, spaces, and quotes never expand at exec time', () => {
    const nasty = "/Users/o'brien/Application Support/$HOME/`whoami`/node";
    const script = buildHostWrapperScript(nasty, '/opt/agon dist/browser-host.js');
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    // Embedded single quote escaped via the '\'' idiom; everything else inert inside single quotes.
    expect(script).toContain(`exec '/Users/o'\\''brien/Application Support/$HOME/\`whoami\`/node' '/opt/agon dist/browser-host.js' "$@"`);
  });
});

describe('browser-host — runBrowserHostInstall (writes manifest + state)', () => {
  it('rejects a malformed --origin with exit 2 and writes nothing', () => {
    const home = mkdtempSync(join(tmpdir(), 'agon-bh-badorigin-'));
    const prevExit = process.exitCode;
    try {
      runBrowserHostInstall('not-an-origin', 'chrome');
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = prevExit;
    }
    expect(existsSync(join(home, 'anything'))).toBe(false);
  });

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
    'writes a com.kernlang.agon manifest pinned to the origin + records install state',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'agon-bh-install-'));
      const agonHome = mkdtempSync(join(tmpdir(), 'agon-bh-home-'));
      // Fake a dist launcher so the existence check passes and argv[1] resolves to a real CLI entry.
      const dist = join(agonHome, 'dist');
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'index.js'), '// cli');
      writeFileSync(join(dist, 'browser-host.js'), '// launcher');

      const prevHome = process.env.HOME;
      const prevAgonHome = process.env.AGON_HOME;
      const prevArgv1 = process.argv[1];
      const prevExit = process.exitCode;
      const prevPath = process.env.PATH;
      process.env.HOME = home;
      process.env.AGON_HOME = agonHome;
      process.argv[1] = join(dist, 'index.js');
      // Sentinel PATH so the state assertion exercises the real capture, not a tautology.
      process.env.PATH = `/tmp/fake-login-path:${prevPath ?? ''}`;
      try {
        runBrowserHostInstall(VALID_ORIGIN, 'chrome');
        const dir = nativeHostDir(process.platform, home, 'chrome')!;
        const mp = manifestPath(dir);
        expect(existsSync(mp)).toBe(true);
        const manifest = JSON.parse(readFileSync(mp, 'utf-8'));
        expect(manifest.name).toBe('com.kernlang.agon');
        expect(manifest.type).toBe('stdio');
        expect(manifest.allowed_origins).toEqual([`${VALID_ORIGIN}/`]);
        // The manifest points at the sh wrapper, not the launcher: Chrome execs hosts with a
        // stripped PATH where `#!/usr/bin/env node` can't find an nvm node. The wrapper execs
        // the install-time node by absolute path on the realpath'd launcher.
        expect(manifest.path).toBe(join(agonHome, 'browser-host', 'host-wrapper.sh'));
        const wrapper = readFileSync(manifest.path, 'utf-8');
        expect(wrapper).toContain(`exec '${process.execPath}' '${join(realpathSync(dist), 'browser-host.js')}' "$@"`);
        expect(statSync(manifest.path).mode & 0o111).not.toBe(0);
        // Install state records the origin(s) + manifest list.
        const state = JSON.parse(readFileSync(join(agonHome, 'browser-host', 'state.json'), 'utf-8'));
        expect(state.origins).toEqual([VALID_ORIGIN]);
        expect(state.manifests).toContain(mp);
        // cwd is recorded so an auto-spawned serve runs in the project dir, not Chrome's cwd.
        expect(state.cwd).toBe(process.cwd());
        // PATH is recorded so an auto-spawned serve resolves CLI engine binaries the
        // way the user's login shell does, not with Chrome's stripped launchd PATH.
        expect(state.path).toBe(`/tmp/fake-login-path:${prevPath ?? ''}`);
        // The launcher was chmod'd executable so Chrome can exec it.
        expect(statSync(join(dist, 'browser-host.js')).mode & 0o111).not.toBe(0);
      } finally {
        process.exitCode = prevExit;
        process.argv[1] = prevArgv1;
        if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
        if (prevAgonHome === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = prevAgonHome;
        if (prevPath === undefined) delete process.env.PATH; else process.env.PATH = prevPath;
      }
    },
  );

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
    'unions AGON_EXTENSION_IDS with --origin, dedupes, and skips a malformed entry',
    () => {
      const home = mkdtempSync(join(tmpdir(), 'agon-bh-multi-install-'));
      const agonHome = mkdtempSync(join(tmpdir(), 'agon-bh-multi-home-'));
      const dist = join(agonHome, 'dist');
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'index.js'), '// cli');
      writeFileSync(join(dist, 'browser-host.js'), '// launcher');

      const SECOND_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba'; // stands in for a published Chrome-Web-Store id
      const prevHome = process.env.HOME;
      const prevAgonHome = process.env.AGON_HOME;
      const prevArgv1 = process.argv[1];
      const prevExit = process.exitCode;
      const prevEnv = process.env.AGON_EXTENSION_IDS;
      process.env.HOME = home;
      process.env.AGON_HOME = agonHome;
      process.argv[1] = join(dist, 'index.js');
      // VALID_ID repeated (dedupe against --origin) + one malformed entry (skipped, not a crash).
      process.env.AGON_EXTENSION_IDS = `${SECOND_ID},${VALID_ID},not-a-valid-entry`;
      try {
        runBrowserHostInstall(VALID_ORIGIN, 'chrome');
        expect(process.exitCode).not.toBe(2);
        const dir = nativeHostDir(process.platform, home, 'chrome')!;
        const mp = manifestPath(dir);
        const manifest = JSON.parse(readFileSync(mp, 'utf-8'));
        expect(manifest.allowed_origins).toEqual([`${VALID_ORIGIN}/`, `chrome-extension://${SECOND_ID}/`]);
        const state = JSON.parse(readFileSync(join(agonHome, 'browser-host', 'state.json'), 'utf-8'));
        expect(state.origins).toEqual([VALID_ORIGIN, `chrome-extension://${SECOND_ID}`]);
      } finally {
        process.exitCode = prevExit;
        process.argv[1] = prevArgv1;
        if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
        if (prevAgonHome === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = prevAgonHome;
        if (prevEnv === undefined) delete process.env.AGON_EXTENSION_IDS; else process.env.AGON_EXTENSION_IDS = prevEnv;
      }
    },
  );
});

// ── Legacy single-`origin` state files (pre-multi-ID rollout path) ─────────────
// Every user who installed before the multi-ID change has `{ origin: "..." }` (singular) in
// state.json and owned-<pid>.json — these MUST keep reading as a one-element `origins` array,
// or the rollout uninstalls everyone. Each test writes into an isolated AGON_HOME and restores.

describe('browser-host — legacy single-origin state compatibility', () => {
  function withTempAgonHome<T>(fn: (home: string) => T): T {
    const prev = process.env.AGON_HOME;
    const home = mkdtempSync(join(tmpdir(), 'agon-legacy-state-'));
    process.env.AGON_HOME = home;
    try { return fn(home); }
    finally { if (prev === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = prev; }
  }

  it('readInstallState wraps a legacy `origin` (singular) into a one-element origins array', () => {
    withTempAgonHome(() => {
      mkdirSync(join(browserHostStatePath(), '..'), { recursive: true });
      writeFileSync(browserHostStatePath(), JSON.stringify({
        origin: VALID_ORIGIN, // pre-multi-ID field name
        launcherPath: '/opt/agon/dist/browser-host.js',
        cwd: '/Users/someone/project',
        path: '/usr/local/bin:/usr/bin',
        manifests: ['/tmp/host.json'],
      }));
      const state = readInstallState();
      expect(state).not.toBeNull();
      expect(state!.origins).toEqual([VALID_ORIGIN]);
      expect(state!.launcherPath).toBe('/opt/agon/dist/browser-host.js');
    });
  });

  it('readInstallState prefers a modern `origins` array and still returns null when both are absent', () => {
    withTempAgonHome(() => {
      mkdirSync(join(browserHostStatePath(), '..'), { recursive: true });
      const second = `chrome-extension://${'p'.repeat(32)}`;
      writeFileSync(browserHostStatePath(), JSON.stringify({ origins: [VALID_ORIGIN, second], launcherPath: '', cwd: '', path: '', manifests: [] }));
      expect(readInstallState()!.origins).toEqual([VALID_ORIGIN, second]);
      writeFileSync(browserHostStatePath(), JSON.stringify({ launcherPath: '/x', cwd: '', path: '', manifests: [] })); // neither field
      expect(readInstallState()).toBeNull();
    });
  });

  it('listOwnedServes wraps a legacy `origin` (singular) owner file into origins[]', () => {
    withTempAgonHome(() => {
      const dir = join(browserHostStatePath(), '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'owned-12345.json'), JSON.stringify({
        pid: 12345,
        origin: VALID_ORIGIN, // pre-multi-ID field name
        sessionId: 's-1',
        url: 'http://127.0.0.1:8787',
      }));
      const owned = listOwnedServes();
      expect(owned).toHaveLength(1);
      expect(owned[0].origins).toEqual([VALID_ORIGIN]);
      expect(owned[0].pid).toBe(12345);
    });
  });
});
