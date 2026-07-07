import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Throwaway AGON_HOME before anything resolves a path (agonPath resolves at call time).
process.env.AGON_HOME = mkdtempSync(join(tmpdir(), 'agon-ext-cmd-test-'));

import {
  browserNativeHostDir,
  resolveInstallBrowsers,
  validExtensionId,
  hostWrapperScript,
  resolveHostOrigins,
  parseNativeFrames,
  runExtInstall,
  AGON_EXTENSION_ID,
} from '../../packages/cli/src/generated/commands/ext.js';

// A second well-formed id (32 chars a–p) standing in for a custom/unpacked install.
const CUSTOM_ID = 'abcdefghijklmnopabcdefghijklmnop';

// Encode an object as one 4-byte-LE-length-prefixed native-messaging frame.
function frame(obj: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json]);
}

describe('agon ext — install-target helpers', () => {
  it('browserNativeHostDir: known browsers map under Application Support; unknown → undefined', () => {
    expect(browserNativeHostDir('/Users/x', 'chrome')).toBe('/Users/x/Library/Application Support/Google/Chrome/NativeMessagingHosts');
    expect(browserNativeHostDir('/Users/x', 'brave')).toContain('BraveSoftware/Brave-Browser');
    expect(browserNativeHostDir('/Users/x', 'firefox')).toBeUndefined();
  });

  it('resolveInstallBrowsers: default chrome; "all" → three; comma list; empty → chrome', () => {
    expect(resolveInstallBrowsers(undefined)).toEqual(['chrome']);
    expect(resolveInstallBrowsers('all')).toEqual(['chrome', 'chromium', 'brave']);
    expect(resolveInstallBrowsers('chrome, brave')).toEqual(['chrome', 'brave']);
    expect(resolveInstallBrowsers('  ,  ')).toEqual(['chrome']);
  });
});

describe('agon ext — extension-id validation (shell + manifest safety)', () => {
  it('accepts a real 32-char a–p id (incl. the published default)', () => {
    expect(validExtensionId(AGON_EXTENSION_ID)).toBe(true);
    expect(validExtensionId(CUSTOM_ID)).toBe(true);
  });

  it('rejects malformed / injection-shaped ids', () => {
    expect(validExtensionId('')).toBe(false);
    expect(validExtensionId('short')).toBe(false);
    expect(validExtensionId(AGON_EXTENSION_ID + 'q')).toBe(false); // q is outside a–p, and too long
    expect(validExtensionId('abcdefghijklmnopabcdefghijklmno"')).toBe(false); // shell-quote break attempt
    expect(validExtensionId('"; rm -rf / ;"')).toBe(false);
  });
});

describe('agon ext — host wrapper bakes the installed origin(s) (C1)', () => {
  it('hostWrapperScript embeds --origin chrome-extension://<id> and keeps "$@" (single id)', () => {
    const w = hostWrapperScript('/abs/node', '/abs/cli.js', [CUSTOM_ID]);
    expect(w).toContain(`ext native-host --origin "chrome-extension://${CUSTOM_ID}"`);
    expect(w.trimEnd().endsWith('"$@"')).toBe(true);
    expect(w.startsWith('#!/bin/sh')).toBe(true);
  });

  it('hostWrapperScript comma-joins multiple ids (dev + a second/store id)', () => {
    const w = hostWrapperScript('/abs/node', '/abs/cli.js', [AGON_EXTENSION_ID, CUSTOM_ID]);
    expect(w).toContain(`ext native-host --origin "chrome-extension://${AGON_EXTENSION_ID},chrome-extension://${CUSTOM_ID}"`);
  });
});

describe('agon ext — native-host origin resolution (C1, the token boundary)', () => {
  it('honors the baked --origin so a custom/unpacked id is allowed', () => {
    const argv = ['node', 'cli.js', 'ext', 'native-host', '--origin', `chrome-extension://${CUSTOM_ID}`, `chrome-extension://${CUSTOM_ID}/`];
    expect(resolveHostOrigins(argv)).toEqual([`chrome-extension://${CUSTOM_ID}`]);
  });

  it('splits a comma-joined baked --origin into every configured id', () => {
    const argv = ['node', 'cli.js', 'ext', 'native-host', '--origin', `chrome-extension://${AGON_EXTENSION_ID},chrome-extension://${CUSTOM_ID}`];
    expect(resolveHostOrigins(argv)).toEqual([`chrome-extension://${AGON_EXTENSION_ID}`, `chrome-extension://${CUSTOM_ID}`]);
  });

  it('falls back to the default published id when --origin is absent or junk', () => {
    expect(resolveHostOrigins(['node', 'cli.js', 'ext', 'native-host'])).toEqual([`chrome-extension://${AGON_EXTENSION_ID}`]);
    expect(resolveHostOrigins(['node', 'cli.js', 'ext', 'native-host', '--origin', 'https://evil.example'])).toEqual([`chrome-extension://${AGON_EXTENSION_ID}`]);
    expect(resolveHostOrigins(['node', 'cli.js', 'ext', 'native-host', '--origin'])).toEqual([`chrome-extension://${AGON_EXTENSION_ID}`]);
  });

  it('drops a malformed entry from a comma list but keeps the well-formed ones', () => {
    const argv = ['node', 'cli.js', 'ext', 'native-host', '--origin', `chrome-extension://${CUSTOM_ID},not-an-origin`];
    expect(resolveHostOrigins(argv)).toEqual([`chrome-extension://${CUSTOM_ID}`]);
  });

  it('ignores Chrome\'s own appended caller-origin arg (reads only our baked flag)', () => {
    // Chrome appends the caller origin (with trailing slash) AFTER the wrapper args.
    const argv = ['node', 'cli.js', 'ext', 'native-host', '--origin', `chrome-extension://${AGON_EXTENSION_ID}`, `chrome-extension://${CUSTOM_ID}/`, '--parent-window=42'];
    expect(resolveHostOrigins(argv)).toEqual([`chrome-extension://${AGON_EXTENSION_ID}`]);
  });
});

describe('agon ext — native-messaging frame parser (C2: no poison-buffer wedge)', () => {
  it('decodes complete frames and keeps a partial trailing frame as rest', () => {
    const a = frame({ type: 'ping' });
    const b = frame({ type: 'connect' });
    // a + b + the first 2 bytes of a third (incomplete) frame.
    const buf = Buffer.concat([a, b, Buffer.from([0x05, 0x00])]);
    const out = parseNativeFrames(buf);
    expect(out.overflow).toBe(false);
    expect(out.frames.map((f) => JSON.parse(f).type)).toEqual(['ping', 'connect']);
    expect(out.rest.length).toBe(2); // the partial header is retained for the next chunk
  });

  it('flags an oversized length-prefix as overflow (unrecoverable) instead of looping', () => {
    const bad = Buffer.alloc(4);
    bad.writeUInt32LE(1024 * 1024 + 1, 0); // one byte past the 1 MiB cap
    const out = parseNativeFrames(Buffer.concat([bad, Buffer.from('whatever')]));
    expect(out.overflow).toBe(true);
    expect(out.frames).toEqual([]);
  });

  it('still returns good frames that arrived BEFORE the oversized one', () => {
    const good = frame({ type: 'ping' });
    const bad = Buffer.alloc(4);
    bad.writeUInt32LE(2_000_000, 0);
    const out = parseNativeFrames(Buffer.concat([good, bad]));
    expect(out.overflow).toBe(true);
    expect(out.frames.map((f) => JSON.parse(f).type)).toEqual(['ping']);
  });

  it('a sub-header buffer (<4 bytes) is all rest, no frames, no overflow', () => {
    const out = parseNativeFrames(Buffer.from([0x01, 0x02]));
    expect(out).toMatchObject({ frames: [], overflow: false });
    expect(out.rest.length).toBe(2);
  });

  it('reassembles a frame whose length-prefix and payload arrive in separate chunks', () => {
    // The core streaming case: the host concats each chunk onto `rest` and re-parses.
    const full = frame({ type: 'connect' });
    const chunk1 = full.subarray(0, 3); // partial 4-byte header
    const chunk2 = full.subarray(3); // the rest of the header + payload
    const p1 = parseNativeFrames(chunk1);
    expect(p1.frames).toEqual([]);
    expect(p1.overflow).toBe(false);
    expect(p1.rest.length).toBe(3);
    const p2 = parseNativeFrames(Buffer.concat([p1.rest, chunk2]));
    expect(p2.frames.map((f) => JSON.parse(f).type)).toEqual(['connect']);
    expect(p2.rest.length).toBe(0);
  });
});

describe('agon ext — runExtInstall (darwin only; CI on linux skips the FS write)', () => {
  it.skipIf(process.platform !== 'darwin')('rejects a malformed --id with exit 2 and no files', () => {
    const home = mkdtempSync(join(tmpdir(), 'agon-ext-badid-'));
    const prevHome = process.env.HOME;
    const prevExit = process.exitCode;
    process.env.HOME = home;
    try {
      runExtInstall('not-a-valid-id', 'chrome');
      expect(process.exitCode).toBe(2);
      const dir = browserNativeHostDir(home, 'chrome')!;
      expect(existsSync(join(dir, 'io.kern.agon.json'))).toBe(false);
    } finally {
      process.exitCode = prevExit;
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    }
  });

  it.skipIf(process.platform !== 'darwin')('writes an executable wrapper (with baked origin) + a manifest pinned to the custom id', () => {
    const home = mkdtempSync(join(tmpdir(), 'agon-ext-install-'));
    const prevHome = process.env.HOME;
    const prevExit = process.exitCode;
    process.env.HOME = home;
    try {
      runExtInstall(CUSTOM_ID, 'chrome');
      const manifestPath = join(browserNativeHostDir(home, 'chrome')!, 'io.kern.agon.json');
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.allowed_origins).toEqual([`chrome-extension://${CUSTOM_ID}/`]);
      expect(manifest.type).toBe('stdio');
      // The wrapper the manifest points at is executable and bakes the same id.
      const wrapper = readFileSync(manifest.path, 'utf-8');
      expect(wrapper).toContain(`--origin "chrome-extension://${CUSTOM_ID}"`);
      expect(statSync(manifest.path).mode & 0o111).not.toBe(0); // has an execute bit
    } finally {
      process.exitCode = prevExit;
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    }
  });

  it.skipIf(process.platform !== 'darwin')('unions AGON_EXTENSION_IDS with the installed id, dedupes, and skips a malformed entry', () => {
    const home = mkdtempSync(join(tmpdir(), 'agon-ext-multi-install-'));
    const SECOND_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba'; // stands in for a published Chrome-Web-Store id
    const prevHome = process.env.HOME;
    const prevExit = process.exitCode;
    const prevEnv = process.env.AGON_EXTENSION_IDS;
    process.env.HOME = home;
    // SECOND_ID once, CUSTOM_ID repeated (dedupe against --id), and one malformed entry (skipped, not a crash).
    process.env.AGON_EXTENSION_IDS = `${SECOND_ID},${CUSTOM_ID},not-a-valid-entry`;
    try {
      runExtInstall(CUSTOM_ID, 'chrome');
      expect(process.exitCode).not.toBe(2);
      const manifestPath = join(browserNativeHostDir(home, 'chrome')!, 'io.kern.agon.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.allowed_origins).toEqual([`chrome-extension://${CUSTOM_ID}/`, `chrome-extension://${SECOND_ID}/`]);
      const wrapper = readFileSync(manifest.path, 'utf-8');
      expect(wrapper).toContain(`--origin "chrome-extension://${CUSTOM_ID},chrome-extension://${SECOND_ID}"`);
    } finally {
      process.exitCode = prevExit;
      if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
      if (prevEnv === undefined) delete process.env.AGON_EXTENSION_IDS; else process.env.AGON_EXTENSION_IDS = prevEnv;
    }
  });
});
