import { expect, it, vi } from 'vitest';
import { createDaemonController, jobCliCommands, jobCliProjection, runJobCliContribution } from '@kernlang/agon-mod-jobs';
import type { DaemonControllerHost, JobCliAction, JobCliInvocationContext } from '@kernlang/agon-mod-jobs';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import legacy from '../fixtures/modular-jobs-legacy-cli.json';
import { createMod } from '../../packages/mod-jobs/src/implementation.js';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';

it('preserves the frozen CLI metadata, defaults, aliases and required arguments', () => {
  expect(jobCliCommands).toEqual(legacy);
  for (const action of Object.keys(legacy) as JobCliAction[]) {
    const projection = jobCliProjection(action);
    const schema = projection.inputSchema as { required: string[]; properties: Record<string, { type: string; default?: unknown; description: string }> };
    const args = jobCliCommands[action].args;
    for (const [name, arg] of Object.entries(args)) {
      expect(schema.properties[name]).toEqual({ type: arg.type === 'boolean' ? 'boolean' : 'string', description: arg.description, ...('default' in arg ? { default: arg.default } : {}) });
      expect(schema.required.includes(name)).toBe('required' in arg && arg.required === true);
      expect(projection.cli?.positionals?.includes(name)).toBe(arg.type === 'positional');
      expect(projection.cli?.aliases?.[name]).toBe('alias' in arg ? arg.alias : undefined);
    }
  }
});

it('does not list jobs again when Citty invokes the parent after its child', async () => {
  const sendRequest = vi.fn();
  const context: JobCliInvocationContext = { invocationId: 'fixture', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
    jobCli: { sendRequest, startDaemon: vi.fn(), log: vi.fn(), error: vi.fn(), stdout: { write: vi.fn() }, stderr: { write: vi.fn() }, setExitCode: vi.fn() },
  };
  expect(await runJobCliContribution('parent', {}, context, () => {})).toEqual({ exitCode: 0 });
  expect(sendRequest).not.toHaveBeenCalled();
  expect(await runJobCliContribution('daemon', {}, context, () => {})).toEqual({ exitCode: 2, stderr: 'Daemon lifecycle requires its dedicated host.\n' });
  expect(await runJobCliContribution('list', [], context, () => {})).toEqual({ exitCode: 2, stderr: 'Job input must be an object.\n' });
  expect(sendRequest).not.toHaveBeenCalled();
  await expect(runJobCliContribution('list', {}, { ...context, signal: AbortSignal.abort() }, () => {})).rejects.toThrow();
  expect(sendRequest).not.toHaveBeenCalled();
});

it('projects the existing daemon action and foreground arguments', () => {
  const projection = jobCliProjection('daemon');
  expect(projection.description).toBe('Run a long-lived agon session host (agond) you can attach to (client/server split M3): start | stop | status');
  expect(projection.inputSchema).toEqual({
    type: 'object', additionalProperties: false, required: [], properties: {
      action: { type: 'string', description: 'start | stop | status | run (run is the internal foreground loop the detached child uses)' },
      foreground: { type: 'boolean', description: 'Run the server loop in THIS process instead of detaching (used by `daemon run` internally; also for debugging)', default: false },
    },
  });
  expect(projection.cli).toEqual({ positionals: ['action'], aliases: {} });
});

function daemonFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'agon-daemon-projection-'));
  const text = (value: string) => value;
  const host: DaemonControllerHost = {
    daemonDirectory: () => directory, ensureHome: vi.fn(), runServer: vi.fn(async () => {}),
    ping: vi.fn(async () => null), shutdown: vi.fn(async () => null),
    spawn: vi.fn(() => { throw new Error('Unexpected process launch'); }),
    output: { header: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn(), bold: text, dim: text, green: text, cyan: text, yellow: text, red: text },
  };
  const context: JobCliInvocationContext = {
    invocationId: 'daemon-projection', cwd: directory, platform: 'darwin-arm64',
    signal: new AbortController().signal, config: {}, daemonCli: host,
  };
  return { directory, host, context, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

it.each([
  { action: 'run', foreground: false },
  { action: 'run', foreground: true },
  { action: 'start', foreground: true },
])('runs daemon $action (foreground=$foreground) through the physical mod controller', async input => {
  const fixture = daemonFixture();
  try {
    expect(await runJobCliContribution('daemon', input, fixture.context, () => {})).toEqual({ exitCode: 0 });
    expect(fixture.host.runServer).toHaveBeenCalledOnce();
    expect(fixture.host.spawn).not.toHaveBeenCalled();
    expect(fixture.host.ensureHome).toHaveBeenCalled();
  } finally { fixture.cleanup(); }
});

it.each([undefined, '', 'status', 'stop', 'unknown'])('preserves daemon action %j behavior', async action => {
  const fixture = daemonFixture();
  try {
    const result = await runJobCliContribution('daemon', action === undefined ? {} : { action }, fixture.context, () => {});
    expect(result.exitCode).toBe(0);
    if (action === 'unknown') expect(fixture.host.output.warn).toHaveBeenCalledWith('Unknown action "unknown". Use: start | stop | status');
    else if (action === 'stop') expect(fixture.host.output.info).toHaveBeenCalledWith('No daemon running.');
    else expect(fixture.host.output.header).toHaveBeenCalledWith('agond status');
    expect(fixture.host.spawn).not.toHaveBeenCalled();
  } finally { fixture.cleanup(); }
});

it('stops a disposed daemon contribution after an awaited probe, before cleanup or spawn', async () => {
  const fixture = daemonFixture();
  let active = true;
  const check = () => { if (!active) throw new Error('Jobs disposed'); };
  try {
    mkdirSync(fixture.directory, { recursive: true });
    writeFileSync(join(fixture.directory, 'agond.pid'), JSON.stringify({ pid: 2147480000, sessionId: 'old', startedAt: '' }));
    writeFileSync(join(fixture.directory, 'agond.sock'), 'stale socket');
    vi.mocked(fixture.host.ping).mockImplementation(async () => { active = false; return null; });
    await expect(runJobCliContribution('daemon', { action: 'start' }, fixture.context, check)).rejects.toThrow('Jobs disposed');
    expect(existsSync(join(fixture.directory, 'agond.pid'))).toBe(true);
    expect(existsSync(join(fixture.directory, 'agond.sock'))).toBe(true);
    expect(fixture.host.spawn).not.toHaveBeenCalled();
  } finally { fixture.cleanup(); }
});

it.each(['abort', 'dispose'])('propagates %s into job startup before stale cleanup or spawn', async reason => {
  const fixture = daemonFixture();
  const cancellation = new AbortController();
  let active = true;
  try {
    writeFileSync(join(fixture.directory, 'agond.pid'), JSON.stringify({ pid: 2147480000, sessionId: 'old', startedAt: '' }));
    writeFileSync(join(fixture.directory, 'agond.sock'), 'stale socket');
    vi.mocked(fixture.host.ping).mockImplementation(async () => {
      if (reason === 'abort') cancellation.abort(new Error('invocation cancelled'));
      else active = false;
      return null;
    });
    const context: JobCliInvocationContext = { ...fixture.context, signal: cancellation.signal, jobCli: {
      sendRequest: vi.fn(async () => null),
      startDaemon: async (...args: unknown[]) => {
        await createDaemonController({ ...fixture.host, assertAvailable: args[1] as (() => void) | undefined }).startDaemon(false);
      },
      log: vi.fn(), error: vi.fn(), stdout: { write: vi.fn() }, stderr: { write: vi.fn() }, setExitCode: vi.fn(),
    } };
    await expect(runJobCliContribution('list', {}, context, () => { if (!active) throw new Error('Jobs disposed'); }))
      .rejects.toThrow(reason === 'abort' ? 'invocation cancelled' : 'Jobs disposed');
    expect(existsSync(join(fixture.directory, 'agond.pid'))).toBe(true);
    expect(existsSync(join(fixture.directory, 'agond.sock'))).toBe(true);
    expect(fixture.host.spawn).not.toHaveBeenCalled();
  } finally { fixture.cleanup(); }
});

it.each(['abort', 'dispose'])('cancels foreground daemon lifetime on %s', async reason => {
  const fixture = daemonFixture();
  const cancellation = new AbortController();
  let command: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && (args[1] as CommandContribution).id === 'cliCommands:0015') command = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  const services = {} as ModServices;
  const dispose = await (await createMod(services)).activate(registrar, services);
  let signal: AbortSignal | undefined;
  let finish = () => {};
  vi.mocked(fixture.host.runServer).mockImplementation((...args: unknown[]) => {
    signal = args[0] as AbortSignal | undefined;
    return new Promise<void>(resolve => { finish = resolve; signal?.addEventListener('abort', resolve.bind(null, undefined), { once: true }); });
  });
  const pending = command!.run({ action: 'run' }, { ...fixture.context, signal: cancellation.signal });
  const outcome = Promise.resolve(pending).catch(error => error);
  try {
    await vi.waitFor(() => expect(fixture.host.runServer).toHaveBeenCalledOnce());
    if (reason === 'abort') cancellation.abort(new Error('cancelled')); else await dispose?.();
    expect(signal?.aborted).toBe(true);
    expect(await outcome).toBeInstanceOf(Error);
  } finally { finish(); await outcome; await dispose?.(); fixture.cleanup(); }
});
