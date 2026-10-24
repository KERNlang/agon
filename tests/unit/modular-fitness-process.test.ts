import { mkdtempSync, mkdirSync, chmodSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runFitnessCommand } from '../../packages/support-verification/src/fitness-command.js';
import { runFitness } from '../../packages/mod-forge/src/fitness.js';
import { runBaseline } from '../../packages/forge/src/stages.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'agon-fitness-process-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it('rejects cancelled Forge fitness before executing or writing artifacts', async () => {
  const reason = new Error('fixture cancellation');
  const runtime = { worktreeDiff: vi.fn(() => 'fixture patch'), diffLineCount: () => 1,
    diffFileCount: () => 1, runSyntaxCheck: vi.fn(() => ({ errors: 0, invalidFiles: [] })) };
  await expect(runFitness({ engineId: 'fixture', worktreePath: root, forgeDir: root,
    fitnessCmd: 'printf started > marker', timeout: 3, signal: AbortSignal.abort(reason) }, runtime))
    .rejects.toBe(reason);
  expect(existsSync(join(root, 'marker'))).toBe(false);
  expect(existsSync(join(root, 'fixture-patch.diff'))).toBe(false);
  expect(runtime.worktreeDiff).not.toHaveBeenCalled();
  expect(runtime.runSyntaxCheck).not.toHaveBeenCalled();
});

it.each(['fitness', 'eslint', 'prettier'] as const)('cancels the real Forge %s process without continuing validation', async phase => {
  const controller = new AbortController();
  const reason = new Error('fixture cancellation');
  const pidPath = join(root, 'started.pid');
  // File creation does not prove that the child has published its PID.
  const script = `import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(pidPath)}, '');
    setTimeout(() => writeFileSync(${JSON.stringify(pidPath)}, String(process.pid) + '\\n'), 250);
    setTimeout(() => process.exit(0), 4000);`;
  const scriptPath = join(root, 'wait.mjs');
  writeFileSync(scriptPath, script);
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;
  if (phase !== 'fitness') {
    const bin = join(root, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    const executable = join(bin, phase);
    writeFileSync(executable, `#!/bin/sh\nexec ${command}\n`);
    chmodSync(executable, 0o755);
  }
  const runtime = { worktreeDiff: () => 'fixture patch', diffLineCount: () => 1,
    diffFileCount: () => 1, runSyntaxCheck: vi.fn(() => ({ errors: 0, invalidFiles: [] })) };
  const pending = runFitness({ engineId: 'fixture', worktreePath: root, forgeDir: root,
    fitnessCmd: phase === 'fitness' ? command : 'true', timeout: 5, signal: controller.signal }, runtime);
  // Attach the rejection handler before aborting the real subprocess.
  const settled = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  try {
    await expect.poll(() => existsSync(pidPath) ? readFileSync(pidPath, 'utf8') : '', { timeout: 3000 })
      .toMatch(/^[1-9]\d*\n$/);
    const pid = Number(readFileSync(pidPath, 'utf8'));
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
    controller.abort(reason);
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    }, { timeout: 1500 }).toBe(false);
    expect((await settled).error).toBe(reason);
    expect(runtime.runSyntaxCheck).not.toHaveBeenCalled();
    expect(existsSync(join(root, 'fixture-fitness.txt'))).toBe(false);
  } finally {
    controller.abort(reason);
    await settled;
  }
}, 10000);

it('cancels baseline fitness and removes its real Git worktree', async () => {
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, 'fixture.txt'), 'baseline');
  execFileSync('git', ['add', 'fixture.txt'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', 'fixture'], { cwd: root });
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const forgeDir = join(root, 'run');
  mkdirSync(forgeDir);
  const pidPath = join(root, 'baseline.pid');
  const scriptPath = join(root, 'baseline-wait.mjs');
  writeFileSync(scriptPath, `import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setTimeout(() => {}, 4000)`);
  const controller = new AbortController();
  const reason = new Error('cancel baseline');
  const settled = runBaseline({ cwd: root, baseSha, forgeDir,
    fitnessCmd: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`, fitnessTimeout: 5,
    signal: controller.signal }).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  try {
    await expect.poll(() => existsSync(pidPath), { timeout: 3000 }).toBe(true);
    controller.abort(reason);
    expect((await settled).error).toBe(reason);
    expect(existsSync(join(forgeDir, 'baseline-worktree'))).toBe(false);
    expect(existsSync(join(forgeDir, 'baseline-fitness.txt'))).toBe(false);
    const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
    expect(worktrees.match(/^worktree /gm)).toHaveLength(1);
  } finally {
    controller.abort(reason);
    await settled;
  }
}, 10000);

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
    fs.writeFileSync('child.pid', String(process.pid) + '\\n');
    setTimeout(() => process.exit(0), 5000);
  `);
  const pending = runFitnessCommand(`${JSON.stringify(process.execPath)} child.cjs; :`,
    root, reason === 'timeout' ? 1 : 10, controller.signal);
  try {
    await expect.poll(() => existsSync(pidPath) ? readFileSync(pidPath, 'utf8') : '', { timeout: 3000 })
      .toMatch(/^[1-9]\d*\n$/);
    const pid = Number(readFileSync(pidPath, 'utf8'));
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
    if (reason === 'abort') controller.abort();
    const result = await pending;
    expect(result.aborted).toBe(reason === 'abort');
    expect(result.timedOut).toBe(reason === 'timeout');
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
