import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { spawnStream, spawnWithTimeout } from '../../packages/support-engine-runtime/src/process.js';

it.each([
  { streaming: false, trigger: 'abort' },
  { streaming: false, trigger: 'timeout' },
  { streaming: true, trigger: 'abort' },
  { streaming: true, trigger: 'timeout' },
])('terminates resistant descendants after leader exit (streaming=$streaming, $trigger)', async ({ streaming, trigger }) => {
    const scratch = mkdtempSync(join(tmpdir(), 'agon-descendant-'));
    const ready = join(scratch, 'ready');
    const controller = new AbortController();
    let leader: number | undefined;
    const descendant = `const fs = require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(${JSON.stringify(ready + '.tmp')}, String(process.pid)); fs.renameSync(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)}); setTimeout(() => process.exit(0), 10000);`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore'}); process.on('SIGTERM', () => process.exit(0)); setTimeout(() => process.exit(0), 10000);`;
    const options = { command: process.execPath, args: ['-e', parent], cwd: scratch,
      timeout: trigger === 'timeout' ? 1500 : 12000, signal: controller.signal, onSpawn: (pid: number) => { leader = pid; } };
    const run = streaming ? (async () => {
      const stream = spawnStream(options);
      while (true) {
        const next = await stream.next();
        if (next.done) return next.value;
      }
    })() : spawnWithTimeout(options);
    try {
      for (let attempt = 0; !existsSync(ready) && attempt < 200; attempt++) await delay(10);
      expect(existsSync(ready)).toBe(true);
      const pid = Number(readFileSync(ready, 'utf8'));
      expect(Number.isSafeInteger(pid) && pid > 0, `Fixture PID must be positive: ${pid}`).toBe(true);
      if (trigger === 'abort') controller.abort();
      const result = await run;
      await delay(1100);
      let gone = false;
      try { process.kill(pid, 0); } catch (error) { gone = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      const diagnostic = gone ? '' : spawnSync('ps', ['-o', 'pid,ppid,pgid,stat,command', '-p', String(pid)], { encoding: 'utf8' });
      expect(gone, JSON.stringify({ targetPid: pid, diagnostic })).toBe(true);
      expect(result.exitCode).toBe(trigger === 'abort' ? 130 : 124);
      expect(result.timedOut).toBe(trigger === 'timeout');
    } finally {
      controller.abort();
      if (leader) { try { process.kill(-leader, 'SIGKILL'); } catch { /* already reaped */ } }
      await run;
      rmSync(scratch, { recursive: true, force: true });
    }
});
