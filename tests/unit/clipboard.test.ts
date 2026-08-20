import { describe, it, expect, vi, afterEach } from 'vitest';

const execSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execSync: execSyncMock }));

import { _linuxHelperCache, copyToClipboard } from '../../packages/core/src/blocks/clipboard.js';

// The Linux helper cache MUST start un-probed. Shipping it pre-probed makes
// probeLinuxHelper() return the (null) cached command forever, so `agon`
// silently never copies anything on Linux — the probe is the only thing that
// discovers wl-copy/xclip/xsel.
//
// Order matters in this file: the first test observes the module-load state,
// so nothing above it may touch the cache.

const savedPlatform = process.platform;
const savedEnv = { TMUX: process.env.TMUX, SSH_CLIENT: process.env.SSH_CLIENT, SSH_TTY: process.env.SSH_TTY };

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

afterEach(() => {
  setPlatform(savedPlatform);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  execSyncMock.mockReset();
});

describe('clipboard linux helper cache', () => {
  it('starts un-probed with no cached command', () => {
    expect(_linuxHelperCache).toEqual({ cmd: null, probed: false });
  });

  it('probes for a helper on the first Linux copy and caches the winner', () => {
    setPlatform('linux');
    delete process.env.TMUX;
    delete process.env.SSH_CLIENT;
    delete process.env.SSH_TTY;
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'which wl-copy') throw new Error('not found');
      if (cmd === 'which xclip') return '';
      return '';
    });

    copyToClipboard('hello');

    const commands = execSyncMock.mock.calls.map((c) => c[0]);
    expect(commands).toContain('which wl-copy');
    expect(commands).toContain('which xclip');
    expect(commands).toContain('xclip -selection clipboard');
    expect(_linuxHelperCache).toEqual({ cmd: 'xclip -selection clipboard', probed: true });
    stdoutSpy.mockRestore();
  });

  it('reuses the cached helper on later copies instead of re-probing', () => {
    setPlatform('linux');
    delete process.env.TMUX;
    delete process.env.SSH_CLIENT;
    delete process.env.SSH_TTY;
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    execSyncMock.mockImplementation(() => '');

    copyToClipboard('again');

    const commands = execSyncMock.mock.calls.map((c) => c[0]);
    expect(commands).toEqual(['xclip -selection clipboard']);
    stdoutSpy.mockRestore();
  });
});
