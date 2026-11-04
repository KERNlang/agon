import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';

const root = resolve(import.meta.dirname, '../..');
const sandbox = mkdtempSync(join(tmpdir(), 'agon-release-performance-'));
const env = {
  ...process.env,
  HOME: join(sandbox, 'user'),
  AGON_HOME: join(sandbox, 'agon'),
  XDG_CONFIG_HOME: join(sandbox, 'config'),
  XDG_CACHE_HOME: join(sandbox, 'cache'),
  XDG_DATA_HOME: join(sandbox, 'data'),
  XDG_STATE_HOME: join(sandbox, 'state'),
  npm_config_cache: join(sandbox, 'npm-cache'),
  npm_config_ignore_scripts: 'true',
  npm_config_offline: 'true',
  npm_config_update_notifier: 'false',
};
const steps = [];
try {
  for (const key of ['HOME', 'AGON_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'npm_config_cache']) {
    mkdirSync(env[key], { recursive: true });
  }
  for (const slice of ['1a', '2', '3', '4', '5', '6', '7', '8']) {
    const args = ['--expose-gc', join(root, `scripts/spec/measure-modular-slice${slice}.mjs`), '--no-write'];
    const child = await spawnWithTimeout({ command: process.execPath, args,
      cwd: root, env, timeout: 180000, maxOutputBytes: 16 * 1024 * 1024,
    });
    let evidence;
    let reason;
    let parseError;
    let cleanupError;
    // Measurements must not leave work running between samples.
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') cleanupError = error; }
    }
    try { evidence = JSON.parse(child.stdout); }
    catch (error) { parseError = error; }
    try {
      if (cleanupError) throw cleanupError;
      if (child.timedOut || child.exitCode !== 0) throw new Error(child.timedOut ? 'measurement timed out' : `measurement exited ${child.exitCode}`);
      if (parseError) throw parseError;
      const flags = Object.entries(evidence.budgets ?? {}).filter(([name]) => name.endsWith('Green'));
      if ((Object.hasOwn(evidence, 'passed') && evidence.passed !== true) || flags.some(([, value]) => value !== true)
        || (evidence.passed !== true && flags.length === 0)) throw new Error('measurement has no passing verdict');
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    steps.push({ slice, command: [process.execPath, ...args], passed: reason === undefined,
      status: child.exitCode, ...(evidence === undefined ? {} : { evidence }), ...(reason ? { reason } : {}),
      stdout: child.stdout ?? '', stderr: child.stderr ?? '' });
    if (cleanupError) break;
  }
  const passed = steps.length === 8 && steps.every(step => step.passed);
  console.log(JSON.stringify({ schemaVersion: 1, measurement: 'modular-agon-release',
    platform: `${process.platform}-${process.arch}`, node: process.version, passed, steps }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
