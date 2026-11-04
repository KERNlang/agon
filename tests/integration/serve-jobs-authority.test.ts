import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { JobService } from '@kernlang/agon-mod-jobs';
import type { BrainClient } from '@kernlang/agon-core';
import { SurfaceGenerationError } from '@kernlang/agon-kernel';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { createAgonServe } from '../../packages/cli/src/bridge/agon-serve.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';

let root: string;
let serve: ReturnType<typeof createAgonServe> | undefined;
let previous: Record<string, string | undefined>;
async function disableJobs(): Promise<void> {
  const catalog = createFirstPartyModCatalog();
  const full = createFullCompatDesiredState(catalog, '2026-10-10T10:00:00.000Z');
  const desired = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.jobs' }, '2026-10-10T10:00:01.000Z').nextState;
  const host = new DurableModHost(join(root, 'host'), { kernelVersion: '1.0.0', processIdentity: 'http-jobs-test' });
  await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-http-authority-'));
  previous = Object.fromEntries(['AGON_HOME', 'AGON_MODULAR_HOST_ROOT', 'AGON_MOD_SAFE_MODE'].map(key => [key, process.env[key]]));
  process.env.AGON_HOME = join(root, 'home');
  process.env.AGON_MODULAR_HOST_ROOT = join(root, 'host');
  delete process.env.AGON_MOD_SAFE_MODE;
});
afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await serve?.close();
    await disposeProcessSurfaceAuthority();
  } finally {
    serve = undefined;
    const generations = join(root, 'host', 'generations');
    if (existsSync(generations)) for (const entry of readdirSync(generations, { withFileTypes: true })) {
      if (entry.isDirectory()) chmodSync(join(generations, entry.name), 0o700);
    }
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

it.each(['disabled at boot', 'disabled after boot', 'host replaced', 'created after disable'] as const)(
  'denies every HTTP Jobs route when %s, without executing work', async scenario => {
    const hostRoot = join(root, 'host');
    if (scenario === 'disabled at boot') await disableJobs();
    await initializeProcessSurfaceAuthority(hostRoot);
    if (scenario === 'created after disable') await disableJobs();
    const jobs = new JobService();
    const execute = vi.fn(async () => 'fixture result');
    const resolve = vi.fn(() => ({ label: 'fixture', executor: { run: execute } }));
    const job = jobs.submit('fixture', 'retained fixture', { run: async () => 'retained' });
    await jobs.waitForIdle(1000);
    serve = createAgonServe({ brain: {} as BrainClient, sessionId: 'http-authority', jobService: jobs, resolveJob: { resolve } });
    const { url, token } = await serve.start();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (scenario === 'disabled after boot' || scenario === 'host replaced') {
      expect((await fetch(`${url}/v1/jobs`, { headers })).status).toBe(200);
      if (scenario === 'disabled after boot') await disableJobs();
      else {
        await disposeProcessSurfaceAuthority();
        await initializeProcessSurfaceAuthority(hostRoot);
      }
    }
    for (const [method, path, body] of [
      ['POST', '/v1/jobs', { kind: 'fixture', payload: {} }],
      ['GET', '/v1/jobs'],
      ['GET', `/v1/jobs/${job.id}`],
      ['GET', `/v1/jobs/${job.id}/events`],
      ['GET', `/v1/jobs/${job.id}/result`],
      ['POST', `/v1/jobs/${job.id}/cancel`, { reason: 'must not change' }],
    ] as const) {
      const response = await fetch(`${url}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect(response.status, `${method} ${path}`).toBe(scenario === 'disabled at boot' ? 403 : 409);
      expect(await response.json()).toMatchObject({ code: scenario === 'disabled at boot' ? 'MOD_SURFACE_UNAVAILABLE' : 'MOD_GENERATION_MISMATCH' });
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(jobs.list()).toHaveLength(1);
    expect((await fetch(`${url}/attach`, { method: 'POST', headers })).status).toBe(200);
    expect((await fetch(`${url}/v1/jobs`)).status).toBe(401);
  },
);

it.each([
  ['queued', 'disable'], ['running', 'disable'],
  ['queued', 'replace'], ['running', 'replace'],
  ['running', 'cancel'],
  ['running', 'ignore-abort'],
] as const)('revokes execution authority for %s HTTP jobs on %s', async (scenario, change) => {
  await initializeProcessSurfaceAuthority(join(root, 'host'));
  const jobs = new JobService({ maxConcurrency: 1 });
  let release = () => {};
  const blocker = new Promise<void>(resolve => { release = resolve; });
  if (scenario === 'queued') jobs.submit('fixture', 'occupy worker', { run: async ctx => {
    ctx.signal.addEventListener('abort', release, { once: true });
    try { await blocker; } finally { ctx.signal.removeEventListener('abort', release); }
  } });
  let began = () => {};
  const started = new Promise<void>(resolve => { began = resolve; });
  let finishCleanup = () => {};
  let cleanupStarted = false;
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  const execute = vi.fn(async (ctx: { signal: AbortSignal }) => {
    began();
    try {
      await new Promise<void>(resolve => {
        if (ctx.signal.aborted) resolve();
        else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (change !== 'ignore-abort') ctx.signal.throwIfAborted();
    } finally {
      cleanupStarted = true;
      await cleanup;
    }
  });
  serve = createAgonServe({ brain: {} as BrainClient, sessionId: 'http-running-authority', jobService: jobs,
    resolveJob: { resolve: () => ({ label: 'fixture', executor: { run: execute } }) } });
  const { url, token } = await serve.start();
  try {
    const response = await fetch(`${url}/v1/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind: 'fixture', payload: {} }) });
    expect(response.status).toBe(202);
    const { job } = await response.json() as { job: { id: string } };
    if (scenario === 'running') await started;
    else expect(jobs.get(job.id)?.state).toBe('queued');
    if (change === 'disable' || change === 'ignore-abort') await disableJobs();
    else if (change === 'replace') {
      await disposeProcessSurfaceAuthority();
      await initializeProcessSurfaceAuthority(join(root, 'host'));
    } else {
      const cancelled = await fetch(`${url}/v1/jobs/${job.id}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: 'operator cancellation' }),
      });
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toMatchObject({ status: 'accepted' });
    }
    release();
    if (scenario === 'running') {
      await vi.waitFor(() => expect(cleanupStarted).toBe(true), { timeout: 1000 });
      expect(await jobs.waitForIdle(1)).toBe(false);
    }
    finishCleanup();
    expect(await jobs.waitForIdle(2000)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(scenario === 'queued' ? 0 : 1);
    expect(jobs.result(job.id)).toMatchObject(change === 'cancel'
      ? { state: 'cancelled', error: 'operator cancellation' }
      : { state: 'failed', error: expect.stringMatching(/generation.*changed.*restart|disposed or replaced/i) });
  } finally { release(); finishCleanup(); }
});

it('preserves successful results under an initialized enabled host', async () => {
  await initializeProcessSurfaceAuthority(join(root, 'host'));
  const jobs = new JobService();
  const execute = vi.fn(async () => ({ text: 'completed' }));
  serve = createAgonServe({ brain: {} as BrainClient, sessionId: 'http-success', jobService: jobs,
    resolveJob: { resolve: () => ({ label: 'fixture', executor: { run: execute } }) } });
  const { url, token } = await serve.start();
  const headers = { Authorization: `Bearer ${token}` };
  const submitted = await fetch(`${url}/v1/jobs`, { method: 'POST', headers, body: JSON.stringify({ kind: 'fixture', payload: {} }) });
  expect(submitted.status).toBe(202);
  const { job } = await submitted.json() as { job: { id: string } };
  expect(await jobs.waitForIdle(1000)).toBe(true);
  const result = await fetch(`${url}/v1/jobs/${job.id}/result`, { headers });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ ready: true, outcome: { state: 'succeeded', value: { text: 'completed' } } });
  expect(execute).toHaveBeenCalledOnce();
});

it('preserves the non-Jobs error response for a typed brain failure', async () => {
  const brain = { cancel: async () => { throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'fixture mismatch', true); } } as unknown as BrainClient;
  serve = createAgonServe({ brain, sessionId: 'http-brain-error' });
  const { url, token } = await serve.start();
  const response = await fetch(`${url}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ turnId: 'fixture-turn' }) });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'fixture mismatch' });
});

it.each(['submit', 'cancel'] as const)('rechecks authority after reading the %s body', async action => {
  await initializeProcessSurfaceAuthority(join(root, 'host'));
  const jobs = new JobService();
  const job = jobs.createManual('fixture', 'retained');
  const resolve = vi.fn(() => ({ label: 'fixture', executor: { run: async () => 'must not run' } }));
  serve = createAgonServe({ brain: {} as BrainClient, sessionId: 'http-body-authority', jobService: jobs, resolveJob: { resolve } });
  // Keep the real reader. Change authority at its asynchronous return boundary.
  const reader = serve as unknown as { readJson(req: IncomingMessage): Promise<Record<string, unknown>> };
  const read = reader.readJson.bind(serve);
  vi.spyOn(reader, 'readJson').mockImplementation(async req => {
    const body = await read(req);
    await disableJobs();
    return body;
  });
  const { url, token } = await serve.start();
  const path = action === 'submit' ? '/v1/jobs' : `/v1/jobs/${job.id}/cancel`;
  const response = await fetch(`${url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(action === 'submit' ? { kind: 'fixture', payload: {} } : { reason: 'must not cancel' }) });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'MOD_GENERATION_MISMATCH', restartRequired: true });
  expect(resolve).not.toHaveBeenCalled();
  expect(jobs.get(job.id)?.state).toBe('running');
  expect(jobs.list()).toHaveLength(1);
});
