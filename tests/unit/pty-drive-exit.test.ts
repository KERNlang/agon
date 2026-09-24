import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

function drive(source: string, steps: unknown[]) {
  return spawnSync('python3', [resolve('scripts/perf/pty-drive.py'), '80', '24', '--',
    'python3', '-c', source], {
    encoding: 'utf8', timeout: 5000,
    input: steps.map(step => JSON.stringify(step)).join('\n') + '\n',
  });
}

describe('PTY graceful-exit qualification', () => {
  it('does not continue past a missing readiness file', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'pty-handshake-'));
    try {
      const result = drive('import time; time.sleep(60)', [
        { waitForFile: resolve(scratch, 'ready'), timeout: 100 }, { exit: true },
      ]);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(124);
      expect(result.stderr).toContain('Readiness file timeout');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('waits for readiness before sending input', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'pty-handshake-'));
    const ready = resolve(scratch, 'ready');
    try {
      // Flush early terminal input before announcing readiness. A driver that
      // ignores the handshake loses the input and cannot observe a clean exit.
      const result = drive(`import time,termios; time.sleep(.1); termios.tcflush(0, termios.TCIFLUSH); open(${JSON.stringify(ready)}, 'w').close(); assert input() == 'continue'`, [
        { waitForFile: ready, timeout: 1000 }, { send: 'continue\n' }, { waitForExit: 1000 },
      ]);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  it('observes a normal child exit without sending cleanup signals', () => {
    const result = drive('raise SystemExit(0)', [{ waitForExit: 1000 }]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"forced": false');
  });

  it('rejects a child crash', () => {
    const result = drive('raise SystemExit(7)', [{ waitForExit: 1000 }]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(7);
  });

  it('rejects signal termination rather than treating it as normal shutdown', () => {
    const result = drive('import os,signal; os.kill(os.getpid(), signal.SIGTERM)', [{ waitForExit: 1000 }]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(143);
    expect(result.stdout).toContain('"exitCode": -15');
  });

  it('rejects a timeout even if cleanup SIGINT would exit successfully', () => {
    const result = drive('import signal,time,sys; signal.signal(signal.SIGINT, lambda *_: sys.exit(0)); time.sleep(60)',
      [{ sleep: 100 }, { waitForExit: 100 }]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(124);
    expect(result.stdout).toContain('"forced": true');
  });
});
