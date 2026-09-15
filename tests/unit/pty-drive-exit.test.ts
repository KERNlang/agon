import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function drive(source: string, steps: unknown[]) {
  return spawnSync('python3', [resolve('scripts/perf/pty-drive.py'), '80', '24', '--',
    'python3', '-c', source], {
    encoding: 'utf8', timeout: 5000,
    input: steps.map(step => JSON.stringify(step)).join('\n') + '\n',
  });
}

describe('PTY graceful-exit qualification', () => {
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
