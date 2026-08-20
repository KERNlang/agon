import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execSync: execSyncMock }));

import { _linuxHelperCache, copyToClipboard } from '../../packages/core/src/blocks/clipboard.js';

// Snapshot the cache AS IT WAS AT MODULE LOAD, before any test can touch it.
// This is the assertion that matters: the Linux helper cache must ship
// un-probed. Shipping it pre-probed makes probeLinuxHelper() return the
// (null) cached command forever, so `agon` silently never copies anything on
// Linux — the probe is the only thing that discovers wl-copy/xclip/xsel.
const CACHE_AT_MODULE_LOAD = { ..._linuxHelperCache };

const savedPlatform = process.platform;
const savedEnv = { TMUX: process.env.TMUX, SSH_CLIENT: process.env.SSH_CLIENT, SSH_TTY: process.env.SSH_TTY };

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

/** Every behavioural test seeds the cache explicitly — no test depends on another. */
function seedCache(cmd: string | null, probed: boolean): void {
  _linuxHelperCache.cmd = cmd;
  _linuxHelperCache.probed = probed;
}

function linuxNative(): void {
  setPlatform('linux');
  delete process.env.TMUX;
  delete process.env.SSH_CLIENT;
  delete process.env.SSH_TTY;
}

let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  execSyncMock.mockReset();
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  setPlatform(savedPlatform);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  seedCache(null, false);
});

describe('clipboard linux helper cache', () => {
  it('ships un-probed with no cached command', () => {
    expect(CACHE_AT_MODULE_LOAD).toEqual({ cmd: null, probed: false });
  });

  it('probes for a helper on the first Linux copy and caches the winner', () => {
    seedCache(null, false);
    linuxNative();
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'which wl-copy') throw new Error('not found');
      return '';
    });

    copyToClipboard('hello');

    const commands = execSyncMock.mock.calls.map((c) => c[0]);
    expect(commands).toEqual(['which wl-copy', 'which xclip', 'xclip -selection clipboard']);
    expect(_linuxHelperCache).toEqual({ cmd: 'xclip -selection clipboard', probed: true });
  });

  it('reuses an already-probed helper instead of re-probing', () => {
    seedCache('wl-copy', true);
    linuxNative();
    execSyncMock.mockImplementation(() => '');

    copyToClipboard('again');

    expect(execSyncMock.mock.calls.map((c) => c[0])).toEqual(['wl-copy']);
    expect(_linuxHelperCache).toEqual({ cmd: 'wl-copy', probed: true });
  });

  it('no-ops silently when the probe already found no helper', () => {
    seedCache(null, true);
    linuxNative();
    execSyncMock.mockImplementation(() => { throw new Error('should not be called'); });

    expect(() => copyToClipboard('nowhere')).not.toThrow();
    expect(execSyncMock).not.toHaveBeenCalled();
    // OSC 52 is still attempted as the terminal-side fallback.
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('records a failed probe so later copies do not re-probe', () => {
    seedCache(null, false);
    linuxNative();
    execSyncMock.mockImplementation(() => { throw new Error('not found'); });

    copyToClipboard('no helper anywhere');

    expect(execSyncMock.mock.calls.map((c) => c[0])).toEqual(['which wl-copy', 'which xclip', 'which xsel']);
    expect(_linuxHelperCache).toEqual({ cmd: null, probed: true });
  });
});
