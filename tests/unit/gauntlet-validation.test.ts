import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as core from '@kernlang/agon-support-engine-runtime';
import { validateBreakerArtifact } from '../../packages/forge/src/gauntlet.js';

let root: string;
let winnerWorktree: string;
let cleanWorktree: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-gauntlet-validation-'));
  winnerWorktree = join(root, 'winner');
  cleanWorktree = join(root, 'clean');
  mkdirSync(winnerWorktree);
  mkdirSync(cleanWorktree);
  writeFileSync(join(winnerWorktree, 'patched'), 'fixture');
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

it.each([
  { name: 'repeatable patch failure', script: "process.exit(existsSync('patched') ? 1 : 0)", validated: true, deterministic: true, timeout: 3 },
  { name: 'passes on patched code', script: 'process.exit(0)', validated: false, deterministic: false, timeout: 3 },
  { name: 'also fails on clean code', script: 'process.exit(1)', validated: false, deterministic: true, timeout: 3 },
  { name: 'times out only on patched code', script: "if (existsSync('patched')) setInterval(() => {}, 1000); else process.exit(0)", validated: false, deterministic: false, timeout: 1 },
  { name: 'times out on repeat check', script: "if (!existsSync('patched')) process.exit(0); if (existsSync('attempt')) setInterval(() => {}, 1000); else { writeFileSync('attempt', 'first'); process.exit(1); }", validated: false, deterministic: false, timeout: 1 },
  { name: 'passes on repeat check', script: "if (!existsSync('patched') || existsSync('attempt')) process.exit(0); writeFileSync('attempt', 'first'); process.exit(1)", validated: false, deterministic: false, timeout: 3 },
])('validates evidence from real subprocesses: $name', async ({ script, validated, deterministic, timeout }) => {
  const artifact = {
    engineId: 'fixture', testScript: `import { existsSync, writeFileSync } from 'node:fs';\n${script};\n`,
    testPath: '', failureMessage: '', validated: false, deterministic: false,
  };
  const result = await validateBreakerArtifact({ artifact, winnerWorktree, cleanWorktree,
    fitnessTimeout: timeout, fitnessCmd: JSON.stringify(process.execPath) });
  expect(result).toMatchObject({ validated, deterministic });
  if (validated) expect(result.testPath.startsWith(winnerWorktree + '/')).toBe(true);
}, 5000);

it.each([1, 2])('does not count a process exception on check %s as an attack', async (check) => {
  const result = { exitCode: 1, stdout: '', stderr: '', durationMs: 0, timedOut: false };
  const runner = vi.spyOn(core, 'spawnWithTimeout');
  if (check === 2) runner.mockResolvedValueOnce(result);
  runner.mockRejectedValueOnce(new Error('fixture launch failure'));
  if (check === 1) runner.mockResolvedValueOnce(result);
  runner.mockResolvedValue({ ...result, exitCode: 0 });
  const artifact = { engineId: 'fixture', testScript: 'process.exit(1)', testPath: '',
    failureMessage: '', validated: false, deterministic: false };
  const checked = await validateBreakerArtifact({ artifact, winnerWorktree, cleanWorktree,
    fitnessTimeout: 1, fitnessCmd: JSON.stringify(process.execPath) });
  expect(checked).toMatchObject({ validated: false, deterministic: false });
  expect(runner).toHaveBeenCalledTimes(check);
});

it.each([1, 2, 3].flatMap(check => ['spawnError', 'aborted', 'timedOut'].map(reason => ({ check, reason }))))('rejects returned $reason on check $check', async ({ check, reason }) => {
  const result = { exitCode: 1, stdout: '', stderr: '', durationMs: 0, timedOut: false };
  const runner = vi.spyOn(core, 'spawnWithTimeout');
  for (let index = 1; index < check; index++) runner.mockResolvedValueOnce(result);
  runner.mockResolvedValueOnce({ ...result, exitCode: check === 3 ? 0 : 1,
    [reason]: reason === 'spawnError' ? new Error('fixture') : true });
  runner.mockResolvedValueOnce(result).mockResolvedValue({ ...result, exitCode: 0 });
  const artifact = { engineId: 'fixture', testScript: 'process.exit(1)', testPath: '',
    failureMessage: '', validated: false, deterministic: false };
  expect(await validateBreakerArtifact({ artifact, winnerWorktree, cleanWorktree, fitnessTimeout: 1 }))
    .toMatchObject({ validated: false, deterministic: check === 3 });
  expect(runner).toHaveBeenCalledTimes(check);
  for (const [options] of runner.mock.calls) expect(options.maxCapturedBytesPerStream).toBe(1024 * 1024);
});

it('does not write or launch a test after cancellation', async () => {
  const runner = vi.spyOn(core, 'spawnWithTimeout');
  const options = { winnerWorktree, cleanWorktree, fitnessTimeout: 1, signal: AbortSignal.abort(),
    fitnessCmd: JSON.stringify(process.execPath), artifact: { engineId: 'fixture',
      testScript: "import { existsSync } from 'node:fs'; process.exit(existsSync('patched') ? 1 : 0)",
      testPath: '', failureMessage: '', validated: false, deterministic: false } };
  expect(await validateBreakerArtifact(options)).toMatchObject({ validated: false, deterministic: false });
  expect(runner).not.toHaveBeenCalled();
  expect(readdirSync(winnerWorktree)).toEqual(['patched']);
  expect(readdirSync(cleanWorktree)).toEqual([]);
});

it('keeps engine IDs out of executable filenames', async () => {
  const artifact = { engineId: 'fixture; touch injected; #',
    testScript: "import { existsSync } from 'node:fs'; process.exit(existsSync('patched') ? 1 : 0)",
    testPath: '', failureMessage: '', validated: false, deterministic: false };
  const checked = await validateBreakerArtifact({ artifact, winnerWorktree, cleanWorktree,
    fitnessTimeout: 3, fitnessCmd: JSON.stringify(process.execPath) });
  expect(existsSync(join(winnerWorktree, 'injected'))).toBe(false);
  expect(existsSync(join(cleanWorktree, 'injected'))).toBe(false);
  expect(checked).toMatchObject({ engineId: artifact.engineId, validated: true, deterministic: true });
});

it('cancels a running validation process without starting the clean check', async () => {
  const controller = new AbortController();
  const pidPath = join(winnerWorktree, 'started');
  const artifact = { engineId: 'fixture',
    testScript: "import { writeFileSync } from 'node:fs'; writeFileSync('started', String(process.pid)); setInterval(() => {}, 1000)",
    testPath: '', failureMessage: '', validated: false, deterministic: false };
  const pending = validateBreakerArtifact({ artifact, winnerWorktree, cleanWorktree,
    fitnessTimeout: 10, fitnessCmd: JSON.stringify(process.execPath), signal: controller.signal });
  try {
    await expect.poll(() => existsSync(pidPath), { timeout: 3000 }).toBe(true);
    const cancelledAt = Date.now();
    controller.abort();
    expect(await pending).toMatchObject({ validated: false, deterministic: false });
    expect(Date.now() - cancelledAt).toBeLessThan(2500);
    expect(existsSync(join(cleanWorktree, 'started'))).toBe(false);
    const pid = Number(readFileSync(pidPath, 'utf8'));
    try {
      await expect.poll(() => {
        try { process.kill(pid, 0); return true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
          throw error;
        }
      }, { timeout: 1000 }).toBe(false);
    } catch (error) {
      let processState: string;
      try { processState = execFileSync('ps', ['-o', 'pid=,ppid=,pgid=,stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 }); }
      catch (probeError) { processState = `Process-state probe failed: ${String(probeError)}`; }
      console.error('GAUNTLET_CANCEL_DIAG', JSON.stringify({ pid, elapsedMs: Date.now() - cancelledAt, processState }));
      throw error;
    }
  } finally {
    controller.abort();
    await pending;
  }
}, 6000);
