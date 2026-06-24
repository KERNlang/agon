import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChromeOrigins } from '../../packages/cli/src/generated/signals/chrome-bridge.js';

// resolveChromeOrigins reads $AGON_HOME/serve/*.json for an existing serve's allowedOrigins
// when config has no chromeExtensionOrigin. Drive it with a temp AGON_HOME + cwd.

describe('resolveChromeOrigins', () => {
  let home: string;
  let cwd: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.AGON_HOME;
    home = mkdtempSync(join(tmpdir(), 'agon-chrome-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'agon-chrome-cwd-'));
    process.env.AGON_HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reuses an existing serve connection file’s allowedOrigins', () => {
    const serveDir = join(home, 'serve');
    mkdirSync(serveDir, { recursive: true });
    writeFileSync(join(serveDir, 'serve-1.json'), JSON.stringify({
      url: 'http://127.0.0.1:8787', token: 't', sessionId: 'serve-1',
      allowedOrigins: ['chrome-extension://abcdef'],
    }));
    expect(resolveChromeOrigins(cwd)).toEqual(['chrome-extension://abcdef']);
  });

  it('returns [] when no serve files and no config origin', () => {
    expect(resolveChromeOrigins(cwd)).toEqual([]);
  });

  it('ignores a serve file with an empty allowedOrigins array', () => {
    const serveDir = join(home, 'serve');
    mkdirSync(serveDir, { recursive: true });
    writeFileSync(join(serveDir, 'serve-2.json'), JSON.stringify({
      url: 'http://127.0.0.1:9999', token: 't', sessionId: 'serve-2', allowedOrigins: [],
    }));
    expect(resolveChromeOrigins(cwd)).toEqual([]);
  });
});
