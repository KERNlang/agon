import { getEventListeners } from 'node:events';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { describe, expect, it, vi } from 'vitest';
import { runWorkflowCommand } from '../../packages/mod-jobs/src/workflow-process.js';
import { captureProcessSurfaceAuthority, disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority, processSurfaceClient } from '../../packages/cli/src/surface-authority-runtime.js';
import { resolveDaemonWorkflowJob } from '../../packages/cli/src/jobs/workflow-job.js';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

const workerModule = new URL('../../packages/mod-jobs/dist/index.js', import.meta.url).href;

describe('real job generation handshake', () => {
  it.each([false, true])('preserves command availability after admission (review disabled=%s)', async disabled => {
    const root = mkdtempSync(join(tmpdir(), 'agon-job-disabled-command-'));
    const hostRoot = join(root, 'host');
    vi.stubEnv('AGON_HOME', join(root, 'home'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', hostRoot);
    vi.stubEnv('CONSOLA_LEVEL', '3');
    const output: string[] = [];
    try {
      if (disabled) {
        const catalog = createFirstPartyModCatalog();
        const full = createFullCompatDesiredState(catalog, '2026-10-11T10:00:00.000Z');
        const desired = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.review' }, '2026-10-11T10:00:01.000Z').nextState;
        const host = new DurableModHost(hostRoot, { kernelVersion: '1.0.0', processIdentity: 'handshake-availability-test' });
        await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
      }
      await initializeProcessSurfaceAuthority();
      const code = await runWorkflowCommand({ signal: new AbortController().signal, emit: (type, data) => {
        if (type === 'stdout' || type === 'stderr') output.push((data as { text: string }).text);
      } }, fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url)), ['review', disabled ? 'uncommitted' : '--help'], root,
      1024, 50, { generation: processSurfaceClient('cli').generation, assertCurrent: captureProcessSurfaceAuthority() });
      if (disabled) {
        expect(code).not.toBe(0);
        expect(output.join('')).toMatch(/unknown command|unavailable|disabled/i);
      } else {
        expect(code).toBe(0);
        expect(output.join('')).toContain('review');
      }
    } finally {
      await disposeProcessSurfaceAuthority();
      vi.unstubAllEnvs();
      const generations = join(hostRoot, 'generations');
      if (existsSync(generations)) for (const entry of readdirSync(generations, { withFileTypes: true })) {
        if (entry.isDirectory()) chmodSync(join(generations, entry.name), 0o700);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([{ timeout: 8, startupMs: 5_200, allowed: true }, { timeout: 1, startupMs: 2_000, allowed: false }])(
    'uses configured startup budget $timeout seconds in the daemon executor', async ({ timeout, startupMs, allowed }) => {
      const root = mkdtempSync(join(tmpdir(), 'agon-job-startup-budget-'));
      const home = join(root, 'home');
      const script = join(root, 'worker.mjs');
      const effect = join(root, 'effect.txt');
      const previousScript = process.argv[1];
      const controller = new AbortController();
      mkdirSync(home);
      writeFileSync(join(home, 'config.json'), JSON.stringify({ timeout }));
      vi.stubEnv('AGON_HOME', home);
      vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
      vi.stubEnv('AGON_DAEMON_ECHO', undefined);
      try {
        await initializeProcessSurfaceAuthority();
        const generation = processSurfaceClient('cli').generation;
        writeFileSync(script, `
          import { writeFileSync } from 'node:fs';
          import { setTimeout } from 'node:timers/promises';
          import { confirmWorkflowGeneration } from ${JSON.stringify(workerModule)};
          await setTimeout(${startupMs});
          await confirmWorkflowGeneration(${JSON.stringify(generation)}, () => {});
          writeFileSync(${JSON.stringify(effect)}, 'ran once');
        `);
        process.argv[1] = script;
        const job = resolveDaemonWorkflowJob('review', { cwd: root, input: 'uncommitted' });
        const run = job.executor.run({ signal: controller.signal, emit: () => {} });
        if (allowed) {
          await expect(run).resolves.toMatchObject({ ok: true });
          expect(readFileSync(effect, 'utf8')).toBe('ran once');
        } else {
          await expect(run).rejects.toThrow(/generation handshake timed out/);
          expect(existsSync(effect)).toBe(false);
        }
      } finally {
        controller.abort();
        process.argv[1] = previousScript;
        await disposeProcessSurfaceAuthority();
        vi.unstubAllEnvs();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(['mismatch', 'invalid-approval', 'revoked', 'timeout', 'unmarked'] as const)(
    'releases only its own IPC channel when the caller catches rejection: %s', async scenario => {
      const root = mkdtempSync(join(tmpdir(), 'agon-job-caught-admission-'));
      const script = join(root, 'worker.mjs');
      const result = join(root, 'result.json');
      writeFileSync(script, `
        import { writeFileSync } from 'node:fs';
        import { confirmWorkflowGeneration } from ${JSON.stringify(workerModule)};
        let error;
        try {
          await confirmWorkflowGeneration(${JSON.stringify(scenario === 'mismatch' ? 'wrong' : 'generation-one')}, () => {
            if (${JSON.stringify(scenario)} === 'revoked') throw new Error('authority revoked');
          });
        } catch (caught) { error = caught.message; }
        writeFileSync(${JSON.stringify(result)}, JSON.stringify({
          connected: process.connected, error,
          messages: process.listenerCount('message'),
          disconnects: process.listenerCount('disconnect'),
          marker: process.env.AGON_JOB_GENERATION,
        }));
        if (process.connected) process.disconnect();
      `);
      const child = spawn(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, AGON_JOB_GENERATION: scenario === 'unmarked' ? undefined : 'generation-one' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      child.stdout.resume();
      child.stderr.resume();
      child.once('message', () => {
        if (scenario !== 'timeout') child.send({ event: 'agon-job-start', protocolVersion: 2, generation: 'generation-one' });
      });
      try {
        const [code] = await Promise.all([
          new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', resolve);
          }),
          finished(child.stdout), finished(child.stderr),
        ]);
        expect(code).toBe(0);
        const state = JSON.parse(readFileSync(result, 'utf8'));
        expect(state).toMatchObject({ connected: scenario === 'unmarked', messages: 0, disconnects: 0 });
        expect(state.marker).toBeUndefined();
        if (scenario === 'unmarked') expect(state.error).toBeUndefined();
        else expect(state.error).toMatch(/generation|revoked/);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(['no-ipc', 'disconnect', 'invalid-approval', 'child-revoked'] as const)(
    'refuses effects in the child: %s', async scenario => {
      const root = mkdtempSync(join(tmpdir(), 'agon-job-child-admission-'));
      const script = join(root, 'worker.mjs');
      const effect = join(root, 'effect.txt');
      writeFileSync(script, `
        import { writeFileSync } from 'node:fs';
        import { confirmWorkflowGeneration } from ${JSON.stringify(workerModule)};
        let checks = 0;
        await confirmWorkflowGeneration('generation-one', () => {
          if (++checks > 1 && ${JSON.stringify(scenario)} === 'child-revoked') throw new Error('child authority revoked');
        });
        writeFileSync(${JSON.stringify(effect)}, 'unexpected effect');
      `);
      const child = spawn(process.execPath, [script], {
        cwd: root, env: { ...process.env, AGON_JOB_GENERATION: 'generation-one' },
        stdio: scenario === 'no-ipc' ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const errors: string[] = [];
      child.stderr?.on('data', data => errors.push(String(data)));
      child.stdout?.resume();
      child.once('message', () => {
        if (scenario === 'disconnect') child.disconnect();
        else child.send({ event: 'agon-job-start', protocolVersion: scenario === 'invalid-approval' ? 2 : 1, generation: 'generation-one' });
      });
      try {
        // Node 26 can omit ChildProcess.close after a parent IPC disconnect.
        const [code] = await Promise.all([
          new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', resolve);
          }),
          finished(child.stdout!),
          finished(child.stderr!),
        ]);
        expect(code).not.toBe(0);
        expect(existsSync(effect)).toBe(false);
        expect(errors.join('')).toMatch(scenario === 'child-revoked' ? /child authority revoked/
          : scenario === 'disconnect' ? /parent disconnected before generation approval/ : /generation|IPC/);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each([false, true])('checks the built CLI before command output (mismatch=%s)', async mismatch => {
    const root = mkdtempSync(join(tmpdir(), 'agon-job-cli-handshake-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
    vi.stubEnv('AGON_HOME', join(root, 'home'));
    // Consola suppresses version logs when Vitest sets NODE_ENV=test.
    vi.stubEnv('CONSOLA_LEVEL', '3');
    const output: string[] = [];
    try {
      await initializeProcessSurfaceAuthority();
      const generation = processSurfaceClient('cli').generation;
      const run = runWorkflowCommand({ signal: new AbortController().signal, emit: (type, data) => {
        if (type === 'stdout') output.push((data as { text: string }).text);
      } }, fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url)), ['--version'], root,
      1024, 50, { generation: mismatch ? `${generation}:wrong` : generation, assertCurrent: captureProcessSurfaceAuthority() });
      if (mismatch) {
        await expect(run).rejects.toThrow(/generation/i);
        expect(output.join('')).toBe('');
      } else {
        await expect(run).resolves.toBe(0);
        expect(output.join('')).toContain('1.0.0');
      }
    } finally {
      await disposeProcessSurfaceAuthority();
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['matching', 'mismatch', 'revoked', 'malformed', 'protocol', 'timeout', 'disconnect', 'cancel', 'early-exit', 'legacy'] as const)(
    'controls child effects: %s', async scenario => {
      const root = mkdtempSync(join(tmpdir(), 'agon-job-handshake-'));
      const script = join(root, 'worker.mjs');
      const effect = join(root, 'effect.txt');
      const controller = new AbortController();
      const events: Array<{ type: string; data?: unknown }> = [];
      let checks = 0;
      const admission = scenario === 'early-exit' ? 'process.exit(0);'
        : scenario === 'timeout' ? 'await new Promise(() => { setInterval(() => {}, 1000); });'
        : scenario === 'disconnect' ? 'process.disconnect(); await new Promise(() => { setInterval(() => {}, 1000); });'
        : scenario === 'cancel' ? "process.on('SIGTERM', () => {}); process.stdout.write('waiting for approval'); await new Promise(() => { setInterval(() => {}, 1000); });"
        : scenario === 'malformed' || scenario === 'protocol'
          ? `process.send(${JSON.stringify({ event: 'agon-job-ready', protocolVersion: scenario === 'protocol' ? 2 : 1, generation: 'generation-one', ...(scenario === 'malformed' ? { extra: true } : {}) })}); await new Promise(() => { setInterval(() => {}, 1000); });`
          : `await confirmWorkflowGeneration(${JSON.stringify(scenario === 'mismatch' ? 'generation-two' : 'generation-one')}, () => {});`;
      writeFileSync(script, `
        import { writeFileSync } from 'node:fs';
        import { confirmWorkflowGeneration } from ${JSON.stringify(workerModule)};
        ${admission}
        if (process.env.AGON_JOB_GENERATION !== undefined) throw new Error('generation marker leaked');
        writeFileSync(${JSON.stringify(effect)}, 'ran once');
      `);
      try {
        const run = runWorkflowCommand({ signal: controller.signal, emit: (type, data) => {
          events.push({ type, data });
          if (scenario === 'cancel' && type === 'stdout') controller.abort(new Error('cancelled during admission'));
        } },
          script, [], root, 1024, 30, scenario === 'legacy' ? undefined : {
            generation: 'generation-one',
            timeoutMs: scenario === 'timeout' ? 100 : 3_000,
            assertCurrent: () => {
              checks += 1;
              if (scenario === 'revoked' && checks > 1) throw new Error('parent authority revoked');
            },
          });
        if (scenario === 'matching' || scenario === 'legacy') {
          await expect(run).resolves.toBe(0);
          expect(readFileSync(effect, 'utf8')).toBe('ran once');
          expect(checks).toBe(scenario === 'matching' ? 2 : 0);
        } else {
          await expect(run).rejects.toThrow(scenario === 'revoked' ? /authority revoked/ : /generation/i);
          expect(existsSync(effect)).toBe(false);
        }
        expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
        expect(events.filter(event => event.type === 'command-finished')).toHaveLength(1);
        if (scenario === 'cancel') {
          expect(events.at(-1)?.data).toMatchObject({ signal: 'SIGKILL' });
        }
      } finally {
        controller.abort();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
