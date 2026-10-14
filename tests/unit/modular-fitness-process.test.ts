import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runFitnessCommand } from '../../packages/support-verification/src/fitness-command.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'agon-fitness-process-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it('does not execute a fitness command with an already aborted signal', async () => {
  const result = await runFitnessCommand('printf started > marker', root, 5, AbortSignal.abort());
  expect(existsSync(join(root, 'marker'))).toBe(false);
  expect(result.aborted).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(result.exitCode).not.toBe(0);
});

it('terminates descendants holding output pipes when fitness times out', async () => {
  // The trailing command keeps the shell separate from its Node child.
  const command = `${JSON.stringify(process.execPath)} -e 'setTimeout(() => {}, 4000)'; :`;
  const start = Date.now();
  const result = await runFitnessCommand(command, root, 1);
  expect(result.timedOut).toBe(true);
  expect(result.aborted).toBe(false);
  expect(result.exitCode).not.toBe(0);
  expect(Date.now() - start).toBeLessThan(3000);
}, 8000);

it('preserves independent output truncation without failing a successful command', async () => {
  const command = `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(1048577)); process.stderr.write("y".repeat(1048577))'`;
  const result = await runFitnessCommand(command, root, 5);
  expect(result.exitCode).toBe(0);
  expect(result.outputTruncated).toBe(true);
  expect(result.stdout).toBe('x'.repeat(1048576));
  expect(result.stderr).toBe('y'.repeat(1048576));
});

it('rejects spawn errors when the existing cwd is not a directory', async () => {
  const file = join(root, 'not-directory');
  writeFileSync(file, 'fixture');
  await expect(runFitnessCommand('true', file, 1)).rejects.toMatchObject({ code: 'ENOTDIR' });
});

it.each(['timeout', 'abort'] as const)('kills a SIGTERM-resistant descendant on %s', async reason => {
  const controller = new AbortController();
  const pidPath = join(root, 'child.pid');
  writeFileSync(join(root, 'child.cjs'), `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.writeFileSync('child.pid', String(process.pid));
    setTimeout(() => process.exit(0), 5000);
  `);
  const pending = runFitnessCommand(`${JSON.stringify(process.execPath)} child.cjs; :`,
    root, reason === 'timeout' ? 1 : 10, controller.signal);
  try {
    await expect.poll(() => existsSync(pidPath), { timeout: 3000 }).toBe(true);
    if (reason === 'abort') controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(reason === 'abort');
    expect(result.timedOut).toBe(reason === 'timeout');
    const pid = Number(readFileSync(pidPath, 'utf8'));
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    }, { timeout: 1000 }).toBe(false);
  } finally {
    controller.abort();
    await pending;
  }
}, 10000);
