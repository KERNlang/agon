import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState,
  planDesiredStateChange,
} from '../../packages/mod-kernel/src/index.js';
import { decodeFrames, encodeFrame } from '@kernlang/agon-support-browser-bridge';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

const roots: string[] = [];
const origin = `chrome-extension://${'a'.repeat(32)}`;
const token = 'synthetic-native-host-test-token';
const launcher = resolve('packages/cli/dist/browser-host.js');

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const generations = join(root, 'modular-host', 'generations');
    // Durable generations are immutable. Only make these test directories removable.
    if (existsSync(generations)) {
      for (const entry of await readdir(generations, { withFileTypes: true })) {
        if (entry.isDirectory()) await chmod(join(generations, entry.name), 0o700);
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function selectGeneration(root: string, disabled: boolean): Promise<void> {
  const catalog = createFirstPartyModCatalog();
  const full = createFullCompatDesiredState(catalog, '2026-10-30T00:00:00.000Z');
  const desired = disabled
    ? planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.browser' }, '2026-10-30T00:00:01.000Z').nextState
    : full;
  const host = new DurableModHost(join(root, 'modular-host'), {
    kernelVersion: '1.0.0', processIdentity: 'native-host-authority-test',
  });
  await host.commitGeneration({ operation: disabled ? 'disable' : 'install',
    lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
}

async function fixture(disabled: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agon-native-authority-'));
  roots.push(root);
  await selectGeneration(root, disabled);
  await mkdir(join(root, 'browser-host'), { recursive: true });
  await mkdir(join(root, 'serve'), { recursive: true });
  await writeFile(join(root, 'browser-host', 'state.json'), JSON.stringify({
    origins: [origin], launcherPath: launcher, cwd: root, path: '', manifests: [],
  }));
  // Reuse this live fixture PID. No server or real provider is needed.
  await writeFile(join(root, 'serve', 'fixture.json'), JSON.stringify({
    url: 'http://127.0.0.1:1', token, sessionId: 'fixture', pid: process.pid,
    allowedOrigins: [origin],
  }), { mode: 0o600 });
  return root;
}

async function pair(root: string, options: {
  afterFirst?: () => Promise<void>;
  afterSend?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  preload?: string;
  requestCount?: number;
  exitCode?: number;
} = {}): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, [launcher], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''}${options.preload ? ` --require=${JSON.stringify(options.preload)}` : ''}`,
      HOME: root, AGON_HOME: root, AGON_MODULAR_HOST_ROOT: join(root, 'modular-host'),
      XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_DATA_HOME: root,
      XDG_STATE_HOME: root, CI: 'true', AGON_DISABLE_CLASSIFIER_SIDECAR: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let buffer: Buffer = Buffer.alloc(0);
  let received = 0;
  let overflow = false;
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const closed = once(child, 'close');
  // Attach immediately so spawn errors cannot become unhandled rejections.
  void closed.catch(() => {});
  try {
    return await new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      const timer = setTimeout(() => reject(new Error(`native host response timeout: ${stderr}`)), 10_000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      child.once('error', fail);
      child.once('close', () => fail(new Error(`native host closed before response: ${stderr}`)));
      child.stdout.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const decoded = decodeFrames(buffer);
        overflow ||= decoded.overflow;
        buffer = Buffer.from(decoded.rest);
        for (const frame of decoded.frames) {
          try {
            const response = JSON.parse(frame) as Record<string, unknown>;
            received++;
            if (options.afterFirst && received === 1) {
              expect(response).toMatchObject({ ok: true, token });
              void options.afterFirst().then(() => child.stdin.write(encodeFrame({ cmd: 'pair', origin, protocol: 1 }))).catch(fail);
            } else {
              clearTimeout(timer);
              resolveResponse(response);
            }
          } catch (error) { clearTimeout(timer); reject(error); }
        }
      });
      child.stdin.on('error', fail);
      child.stdin.write(Buffer.concat(Array.from({ length: options.requestCount ?? 1 },
        () => encodeFrame({ cmd: 'pair', origin, protocol: 1 }))));
      if (options.afterSend) void options.afterSend(child).catch(fail);
    });
  } finally {
    if (options.exitCode === 1) child.stdin.end();
    else child.kill('SIGTERM');
    let forced = false;
    const killTimer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 2_000);
    try {
      const [code, signal] = await closed;
      expect(forced).toBe(false);
      expect(signal).toBe(null);
      expect(code).toBe(options.exitCode ?? 0);
      expect(overflow).toBe(false);
      expect(buffer.length).toBe(0);
      expect(received).toBe(options.afterFirst ? 2 : 1);
    } finally { clearTimeout(killTimer); }
  }
}

describe('native Browser Host durable authority', () => {
  it('pairs through the real framed launcher when Browser is enabled', async () => {
    const root = await fixture(false);
    expect(await pair(root)).toMatchObject({ ok: true, token, started: false, protocol: 1,
      generation: expect.stringMatching(/^generated:1:/) });
    const host = new DurableModHost(join(root, 'modular-host'), { kernelVersion: '1.0.0' });
    expect(await readdir(host.paths.leases)).toHaveLength(1);
    expect(await host.activeGenerationLeases()).toEqual([]);
  });

  it('does not expose a reusable connection when Browser is disabled', async () => {
    const response = await pair(await fixture(true));
    expect(response).toMatchObject({ ok: false, code: 'MOD_SURFACE_UNAVAILABLE', protocol: 1 });
    expect(response).not.toHaveProperty('token');
  });

  it('rejects new pairing after its selected generation changes', async () => {
    const root = await fixture(false);
    const response = await pair(root, { afterFirst: () => selectGeneration(root, true) });
    expect(response).toMatchObject({ ok: false, code: 'MOD_GENERATION_MISMATCH', protocol: 1 });
    expect(response).not.toHaveProperty('token');
    const host = new DurableModHost(join(root, 'modular-host'), { kernelVersion: '1.0.0' });
    expect(await readdir(host.paths.leases)).toHaveLength(1);
    expect(await host.activeGenerationLeases()).toEqual([]);
  });

  it('does not pair when its selected generation is unreadable', async () => {
    const root = await fixture(false);
    await writeFile(join(root, 'modular-host', 'current-generation.json'), '{broken');
    const response = await pair(root, { exitCode: 1 });
    expect(response).toMatchObject({ ok: false, protocol: 1, code: expect.any(String) });
    expect(response).not.toHaveProperty('token');
  });

  it('does not spawn after its generation changes while waiting for the pair lock', async () => {
    const root = await fixture(false);
    await unlink(join(root, 'serve', 'fixture.json'));
    const lock = join(root, 'browser-host', 'pair.lock');
    await writeFile(lock, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    const marker = join(root, 'spawned');
    const preload = join(root, 'observe-spawn.cjs');
    await writeFile(preload, `require('node:child_process').spawn = () => {
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected spawn');
      throw new Error('fixture blocks detached spawn');
    }; require('node:module').syncBuiltinESMExports();`);
    const host = new DurableModHost(join(root, 'modular-host'), { kernelVersion: '1.0.0' });
    const response = await pair(root, { preload, afterSend: async () => {
      await vi.waitFor(async () => expect(await host.activeGenerationLeases()).toHaveLength(1), { timeout: 4_000 });
      await selectGeneration(root, true);
      await unlink(lock);
    } });
    expect(existsSync(marker)).toBe(false);
    expect(response).toMatchObject({ ok: false, code: 'MOD_GENERATION_MISMATCH' });
  });

  it('does not start queued pairing after disconnect during an active request', async () => {
    const root = await fixture(false);
    await unlink(join(root, 'serve', 'fixture.json'));
    const marker = join(root, 'spawned');
    const preload = join(root, 'fake-spawn.cjs');
    await writeFile(preload, `require('node:child_process').spawn = () => {
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fixture spawn');
      return {pid: process.pid, unref() {}};
    }; require('node:module').syncBuiltinESMExports();`);
    await pair(root, { preload, requestCount: 2, afterSend: async child => {
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 4_000 });
      child.stdin.end();
      await writeFile(join(root, 'serve', 'fixture.json'), JSON.stringify({
        url: 'http://127.0.0.1:1', token, sessionId: 'fixture', pid: child.pid,
        allowedOrigins: [origin],
      }), { mode: 0o600 });
    } });
    const host = new DurableModHost(join(root, 'modular-host'), { kernelVersion: '1.0.0' });
    expect(await readdir(host.paths.leases)).toHaveLength(1);
    expect(await host.activeGenerationLeases()).toEqual([]);
  });
});
