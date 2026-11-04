import { expect, it, vi } from 'vitest';
import type { IntentContribution, InvocationContext, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { runSessionJobAction, runSessionJobContribution } from '@kernlang/agon-mod-jobs';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
import { createMod } from '../../packages/mod-jobs/src/implementation.js';
import { createGeneratedLazySubCommands } from '../../packages/cli/src/lazy-commands.js';
import { runCommand } from 'citty';
import type { CommandDef } from 'citty';
import { JobManager } from '../../packages/cli/src/signals/job-manager.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';
import { dispatchIntent } from '../../packages/cli/src/signals/dispatch/intent-router.js';
import { dispatchMetaIntent } from '../../packages/cli/src/signals/dispatch/intent-meta.js';
import { detectIntent } from '../../packages/cli/src/signals/intent.js';
import { initializeProcessSurfaceAuthority, disposeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('refuses an absent session or cancelled invocation without using another store', () => {
  const controller = new AbortController();
  const context: InvocationContext = { invocationId: 'fixture', cwd: process.cwd(), platform: 'darwin-arm64', signal: controller.signal, config: {} };
  expect(runSessionJobContribution('list', {}, context)).toEqual({ exitCode: 2, stderr: 'No interactive Jobs session is available.\n' });
  const dispatch = vi.fn();
  const cancel = vi.fn();
  controller.abort(new Error('fixture cancellation'));
  expect(() => runSessionJobContribution('list', { action: 'cancel', jobId: '1' }, { ...context, sessionJobs: { dispatch, manager: { cancel } } })).toThrow('fixture cancellation');
  expect(cancel).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

it('preserves missing, failed, finished and empty session notices', () => {
  const manager = new JobManager();
  const dispatch = vi.fn();
  const host = { manager, dispatch };
  runSessionJobAction('list', undefined, host);
  runSessionJobAction('focus', undefined, host);
  runSessionJobAction('cancel', undefined, host);
  runSessionJobAction('focus', 'missing', host);
  runSessionJobAction('cancel', 'missing', host);
  expect(dispatch.mock.calls.map(([event]) => event)).toEqual([
    { type: 'info', message: 'No jobs.' },
    { type: 'info', message: 'Usage: /focus <job-id>' },
    { type: 'info', message: 'Usage: /jobs cancel <job-id>' },
    { type: 'error', message: 'Job not found: missing' },
    { type: 'error', message: 'Job not found: missing' },
  ]);
  const failed = manager.create('review', 'failed review');
  manager.fail(failed.id, 'fixture failure');
  dispatch.mockClear();
  runSessionJobAction('focus', failed.id, host);
  expect(dispatch.mock.calls.map(([event]) => event)).toEqual([
    { type: 'info', message: `Job ${failed.id}: review — failed — failed review` },
    { type: 'error', message: 'fixture failure' },
  ]);
  const done = manager.create('review', 'finished review');
  manager.complete(done.id);
  dispatch.mockClear();
  runSessionJobAction('cancel', done.id, host);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'info', message: `Job ${done.id} is already done.` });
});

it('uses session-local IDs and output for generated Jobs list, focus and cancel', async () => {
  const intents: IntentContribution[] = [];
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'intent') intents.push(args[0] as IntentContribution);
    return () => {};
  } }) as Registrar;
  const state = { read: vi.fn(), write: vi.fn() };
  const dispatchEngine = vi.fn();
  const services = { state, receipts: { record: vi.fn() }, engines: { dispatch: dispatchEngine } } as unknown as ModServices;
  let dispose = await (await createMod(services)).activate(registrar, services);
  const manager = new JobManager();
  const job = manager.create('review', 'existing session review');
  const dispatch = vi.fn();
  const cb = { dispatch, jobManager: manager, ctx: { config: {} } } as unknown as DispatchCallbacks;
  const run = async (line: string, callbacks = cb) => {
    const intent = intents.find(entry => entry.id === (line.startsWith('/focus') ? 'intentVariants:0031' : 'intentVariants:0038'))!;
    await runPhysicalTuiContribution({ owner: { id: 'agon.jobs' }, payload: intent }, intent.parse(line)!, line.startsWith('/focus') ? 'focus' : 'jobs', callbacks, new AbortController().signal);
  };
  try {
    await run('/jobs');
    expect(dispatch.mock.calls.map(([event]) => event)).toEqual([
      { type: 'header', title: 'Jobs' },
      { type: 'table', headers: ['ID', 'Type', 'State', 'Label', 'Started'], rows: [[job.id, 'review', 'running', job.label, job.startedAt.slice(11, 19)]] },
    ]);
    dispatch.mockClear();
    await run(`/focus ${job.id}`);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'info', message: `Job ${job.id}: review — running — ${job.label}` });
    const otherManager = new JobManager();
    const otherJob = otherManager.create('review', 'other session');
    const otherDispatch = vi.fn();
    expect(otherJob.id).toBe(job.id);
    try {
      await run(`/jobs cancel ${otherJob.id}`, { ...cb, jobManager: otherManager, dispatch: otherDispatch });
      expect(otherManager.get(otherJob.id)?.state).toBe('cancelled');
      expect(manager.get(job.id)?.state).toBe('running');
      expect(otherDispatch).toHaveBeenCalledExactlyOnceWith({ type: 'success', message: `Cancelled job ${otherJob.id}.` });
    } finally { otherManager.cancel(otherJob.id); }
    dispatch.mockClear();
    await run(`/jobs cancel ${job.id}`);
    expect(manager.get(job.id)?.state).toBe('cancelled');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'success', message: `Cancelled job ${job.id}.` });
    expect(dispatchEngine).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    const next = manager.create('review', 'must remain running');
    await dispose?.();
    dispose = undefined;
    try {
      await expect(run(`/jobs cancel ${next.id}`)).rejects.toThrow('Jobs service is closed');
      expect(manager.get(next.id)?.state).toBe('running');
    } finally { manager.cancel(next.id); }
  } finally { manager.cancel(job.id); await dispose?.(); }
});

it('routes real generated session actions without creating jobs and refuses a cached disabled action', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agon-jobs-session-'));
  const manager = new JobManager();
  const job = manager.create('review', 'session job');
  const dispatch = vi.fn();
  const runAsJob = vi.fn();
  const cb = { dispatch, runAsJob, jobManager: manager, ctx: { config: {} } } as unknown as DispatchCallbacks;
  try {
    await initializeProcessSurfaceAuthority(root);
    const list = detectIntent('/jobs');
    expect(list).toHaveProperty('_modSurface');
    expect(await dispatchIntent(list, '/jobs', cb)).toEqual({ handled: true, ranAsJob: false });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'table', rows: [expect.arrayContaining([job.id, job.label])] }));
    expect(manager.list()).toHaveLength(1);
    expect(runAsJob).not.toHaveBeenCalled();
    dispatch.mockClear();
    expect(await dispatchIntent(detectIntent(`/focus ${job.id}`), `/focus ${job.id}`, cb)).toEqual({ handled: true, ranAsJob: false });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'info', message: `Job ${job.id}: review — running — ${job.label}` });
    const cancel = detectIntent(`/jobs cancel ${job.id}`);
    expect(await dispatchIntent(cancel, `/jobs cancel ${job.id}`, cb)).toEqual({ handled: true, ranAsJob: false });
    expect(manager.get(job.id)?.state).toBe('cancelled');
    const protectedJob = manager.create('review', 'must survive disabled control');
    const cachedCancel = detectIntent(`/jobs cancel ${protectedJob.id}`);
    const cachedCliJobs = createGeneratedLazySubCommands().job as CommandDef;
    const cachedCliDaemon = createGeneratedLazySubCommands().daemon as CommandDef;
    expect(cachedCliDaemon.meta).toEqual({
      name: 'daemon', description: 'Run a long-lived agon session host (agond) you can attach to (client/server split M3): start | stop | status',
    });
    expect(cachedCliDaemon.args).toMatchObject({ action: { type: 'positional', required: false }, foreground: { type: 'boolean', default: false } });
    const cachedCliHistory = createGeneratedLazySubCommands().history as CommandDef;
    const catalog = createFirstPartyModCatalog();
    const now = '2026-10-10T12:00:00.000Z';
    const desired = planDesiredStateChange(catalog, createFullCompatDesiredState(catalog, now), { kind: 'disable', id: 'agon.jobs' }, now).nextState;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'jobs-session-test' });
    await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
    await disposeProcessSurfaceAuthority();
    await initializeProcessSurfaceAuthority(root);
    dispatch.mockClear();
    expect(createGeneratedLazySubCommands()).not.toHaveProperty('job');
    expect(createGeneratedLazySubCommands()).not.toHaveProperty('daemon');
    await expect(runCommand(cachedCliJobs, { rawArgs: ['list', '--json'] })).rejects.toThrow('captured modular host was disposed or replaced');
    await expect(runCommand(cachedCliDaemon, { rawArgs: ['status'] })).rejects.toThrow(/generation|disposed|replaced/i);
    await expect(runCommand(cachedCliHistory, { rawArgs: [] })).rejects.toThrow(/generation|disposed|replaced/i);
    await dispatchIntent(cachedCancel, `/jobs cancel ${protectedJob.id}`, cb);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('unavailable') }));
    expect(manager.get(protectedJob.id)?.state).toBe('running');
    expect(runAsJob).not.toHaveBeenCalled();
    await expect(dispatchMetaIntent({ type: 'jobs', action: 'cancel', jobId: protectedJob.id }, '', cb)).rejects.toThrow(/unavailable|disabled/i);
    await expect(dispatchMetaIntent({ type: 'focus', jobId: protectedJob.id }, '', cb)).rejects.toThrow(/unavailable|disabled/i);
    expect(manager.get(protectedJob.id)?.state).toBe('running');
  } finally {
    for (const runningJob of manager.running()) manager.cancel(runningJob.id);
    await disposeProcessSurfaceAuthority();
    const generations = join(root, 'generations');
    if (existsSync(generations)) {
      for (const generation of readdirSync(generations)) chmodSync(join(generations, generation), 0o755);
    }
    rmSync(root, { recursive: true, force: true });
  }
});
