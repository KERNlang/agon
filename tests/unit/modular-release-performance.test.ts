import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { spawnWithTimeout } from '../../packages/support-engine-runtime/src/process.js';

const source = readFileSync(new URL('../../scripts/spec/measure-modular-release.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.dirname', JSON.stringify('/fixture/scripts/spec'));

it.each(['green', 'exit', 'timeout', 'malformed', 'absent-verdict', 'false-verdict', 'false-budget', 'zero-verdict', 'null-verdict', 'string-verdict'])(
  'retains all eight measurements and fails closed (%s)', async (failure) => {
    const calls: string[][] = [];
    const removed: string[] = [];
    let receipt: { passed: boolean; steps: Array<{ passed: boolean; reason?: string }> } | undefined;
    const process = { execPath: '/fixture/node', platform: 'linux', arch: 'x64', version: 'v26.3.0', env: {}, argv: [], exitCode: 0 };
    await runInNewContext(`(async () => { ${source} })()`, {
      process, dirname, join, resolve,
      tmpdir: () => '/fixture/tmp', mkdtempSync: () => '/fixture/tmp/unique', mkdirSync() {},
      rmSync: (path: string) => { removed.push(path); },
      spawnWithTimeout: (options: { command: string; args: string[]; timeout: number; env: Record<string, string> }) => {
        const { command, args } = options;
        expect(command).toBe('/fixture/node');
        expect(args[0]).toBe('--expose-gc');
        expect(args.at(-1)).toBe('--no-write');
        expect(options.timeout).toBeGreaterThan(0);
        expect(options.env.HOME).toBe('/fixture/tmp/unique/user');
        expect(options.env.npm_config_ignore_scripts).toBe('true');
        calls.push(args);
        const affected = calls.length === 2;
        if (affected && failure === 'exit') return { exitCode: 1, stdout: '{"passed":true}', stderr: 'measurement failed' };
        if (affected && failure === 'timeout') return { exitCode: 124, timedOut: true, stdout: '', stderr: '' };
        const evidence = affected && failure === 'absent-verdict' ? { samples: [] }
          : affected && failure === 'zero-verdict' ? { passed: 0, budgets: { coldGreen: true } }
          : affected && failure === 'null-verdict' ? { passed: null, budgets: { coldGreen: true } }
          : affected && failure === 'string-verdict' ? { passed: 'true', budgets: { coldGreen: true } }
          : affected && failure === 'false-verdict' ? { passed: false }
          : affected && failure === 'false-budget' ? { passed: true, budgets: { rssGreen: false } }
          : calls.length <= 3 ? { budgets: { coldGreen: true, rssGreen: true } } : { passed: true };
        return { exitCode: 0, stdout: affected && failure === 'malformed' ? '{' : JSON.stringify(evidence), stderr: '' };
      },
      console: { log: (text: string) => { receipt = JSON.parse(text); } },
    });
    expect(calls.map(args => args[1])).toEqual(['1a', '2', '3', '4', '5', '6', '7', '8']
      .map(slice => `/fixture/scripts/spec/measure-modular-slice${slice}.mjs`));
    expect(receipt!.steps).toHaveLength(8);
    expect(receipt!.passed).toBe(failure === 'green');
    expect(receipt!.steps.filter(step => !step.passed)).toHaveLength(failure === 'green' ? 0 : 1);
    expect(process.exitCode).toBe(failure === 'green' ? 0 : 1);
    expect(removed).toEqual(['/fixture/tmp/unique']);
  },
);

it.each([false, true])('cleans surviving descendants (timeout=%s)', async (timeout) => {
  let pid: number | undefined;
  let count = 0;
  const fixture = `const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
    console.log(JSON.stringify({passed:true,pid:child.pid})); child.unref();
    ${timeout ? "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);" : ''}`;
  let receipt: { passed: boolean; steps: Array<{ reason?: string }> } | undefined;
  const started = performance.now();
  try {
    await runInNewContext(`(async () => { ${source} })()`, {
      process: { execPath: process.execPath, platform: process.platform, arch: process.arch,
        version: process.version, env: {}, exitCode: 0, kill: process.kill.bind(process) },
      dirname, join, resolve,
      tmpdir: () => '/fixture/tmp', mkdtempSync: () => '/fixture/tmp/unique', mkdirSync() {}, rmSync() {},
      spawnWithTimeout: async (options: Parameters<typeof spawnWithTimeout>[0]) => {
        if (count++ > 0) return { exitCode: 0, stdout: '{"passed":true}', stderr: '' };
        const result = await spawnWithTimeout({ ...options, command: process.execPath, args: ['-e', fixture], cwd: process.cwd(), env: {}, timeout: 1000 });
        pid = JSON.parse(result.stdout).pid;
        return result;
      },
      console: { log: (value: string) => { receipt = JSON.parse(value); } },
    });
    expect(pid).toBeGreaterThan(0);
    expect(receipt!.passed).toBe(!timeout);
    if (timeout) expect(receipt!.steps[0].reason).toBe('measurement timed out');
    expect(performance.now() - started).toBeLessThan(5000);
    await expect.poll(() => { try { process.kill(pid!, 0); return true; } catch { return false; } }, { timeout: 2000 }).toBe(false);
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Fixture already stopped. */ } }
  }
});
