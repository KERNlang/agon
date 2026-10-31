import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { append, flush, resetEventLogState } from '@kernlang/agon-support-persistence';

it('the built attach command replays and exits on SIGINT with stdin still open', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agon-attach-detach-'));
  try {
    const previousHome = process.env.AGON_HOME;
    process.env.AGON_HOME = home;
    try {
      append('detach-fixture', { type: 'text', content: 'ATTACH_REPLAY_OK' });
      flush('detach-fixture');
    } finally {
      resetEventLogState();
      if (previousHome === undefined) delete process.env.AGON_HOME;
      else process.env.AGON_HOME = previousHome;
    }
    const child = spawn(process.execPath, [
      fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url)),
      'attach', '--self', 'detach-fixture',
    ], { env: { ...process.env, AGON_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let signalled = false;
    let timedOut = false;
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5_000);
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      if (!signalled && stdout.includes('following live')) {
        signalled = true;
        child.kill('SIGINT');
      }
    });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    try {
      const result = await closed;
      expect(timedOut, JSON.stringify({ stdout, stderr, result })).toBe(false);
      expect(signalled).toBe(true);
      expect(stdout).toContain('ATTACH_REPLAY_OK');
      expect(stdout).toContain('detached');
      expect(result).toEqual({ code: 0, signal: null });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdin.destroy();
      await closed.catch(() => {});
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 10_000);
