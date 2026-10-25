import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { InvocationContext, ModServices } from '../../packages/mod-api/src/index.js';
import { createIsolatedThirdPartyMod } from '../../packages/mod-kernel/src/third-party-worker.js';

function services(dispatch = vi.fn(async (..._args: unknown[]) => ({ ok: true }))): ModServices {
  return {
    identity: { id: 'example.worker', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'user-folder',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'receipt') },
    permissions: { check: vi.fn(async () => 'deny' as const) }, state: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) },
    engines: { dispatch: dispatch as unknown as ModServices['engines']['dispatch'] },
  };
}

async function runtime(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agon-worker-hardening-'));
  const path = join(root, 'index.mjs');
  await writeFile(path, source);
  return pathToFileURL(path).href;
}

async function activateCommand(source: string, base = services(), timeoutMs = 5_000) {
  const isolated = await createIsolatedThirdPartyMod({ runtimeUrl: await runtime(source), services: base, timeoutMs });
  let run: ((input: unknown, context: InvocationContext) => Promise<any>) | undefined;
  await isolated.mod.activate({ command: (_surface: string, value: any) => { run = value.run; return () => undefined; } } as never);
  return { isolated, run: run! };
}

function context(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return { invocationId: 'host-invocation', cwd: '/host/cwd', platform: 'darwin-arm64', signal: new AbortController().signal, config: {}, ...overrides };
}

function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms))]);
}

describe('isolated third-party worker hardening', () => {
  it('binds engine dispatch to an invocation whose caller supplied no signal', async () => {
    const dispatch = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
    const { isolated, run } = await activateCommand(`
export default () => ({ apiVersion: '1', activate(registrar, services) {
  registrar.command('cli', { id: 'go', run: async (_input, context) => ({ exitCode: 0, result: await services.engines.dispatch('e', 'p', context) }) });
} });`, services(dispatch));
    const { signal: _omitted, ...withoutSignal } = context();
    await expect(run({}, withoutSignal as InvocationContext)).resolves.toEqual({ exitCode: 0, result: { ok: true } });
    expect(dispatch).toHaveBeenCalledOnce();
    await isolated.dispose();
  });

  it('dispatches engines with the host-held invocation context, not a worker-forged one', async () => {
    const dispatch = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
    const { isolated, run } = await activateCommand(`
import { parentPort } from 'node:worker_threads';
export default () => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'go', run: (_input, context) => new Promise((resolve) => {
    parentPort.once('message', (message) => { if (message.type === 'service-response') resolve({ exitCode: 0, result: message.ok }); });
    parentPort.postMessage({ type: 'service', id: 'service:forged', service: 'engines', method: 'dispatch',
      args: ['e', 'p', { invocationId: 'forged', cwd: '/elsewhere', platform: 'linux-x64', config: { escalate: true } }], invocationRequestId: 'host:2' });
  }) });
} });`, services(dispatch));
    const host = context();
    await expect(run({}, host)).resolves.toEqual({ exitCode: 0, result: true });
    const forwarded = dispatch.mock.calls[0]![2] as InvocationContext;
    expect(forwarded).toMatchObject({ invocationId: 'host-invocation', cwd: '/host/cwd', config: {} });
    expect(forwarded.signal).toBeInstanceOf(AbortSignal);
    await isolated.dispose();
  });

  it('aborts in-flight engine dispatch when the worker is disposed even if the caller supplied a signal', async () => {
    let dispatchSignal: AbortSignal | undefined;
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => { dispatched = resolve; });
    const dispatch = vi.fn(async (_engine: unknown, _prompt: unknown, ctx: InvocationContext) => {
      dispatchSignal = ctx.signal;
      dispatched();
      return new Promise(() => undefined);
    });
    const { isolated, run } = await activateCommand(`
export default () => ({ apiVersion: '1', activate(registrar, services) {
  registrar.command('cli', { id: 'go', run: async (_input, context) => ({ exitCode: 0, result: await services.engines.dispatch('e', 'p', context) }) });
} });`, services(dispatch as never));
    const caller = new AbortController();
    const outcome = run({}, context({ signal: caller.signal })).then(() => 'resolved', (error: unknown) => error);
    await settlesWithin(started, 2_000);
    await isolated.dispose();
    expect(await outcome).toBeInstanceOf(Error);
    expect(caller.signal.aborted).toBe(false);
    expect(dispatchSignal?.aborted).toBe(true);
  });

  it('refuses host service members outside the mod services contract', async () => {
    const { isolated, run } = await activateCommand(`
import { parentPort } from 'node:worker_threads';
export default () => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'go', run: () => new Promise((resolve) => {
    parentPort.once('message', (message) => { if (message.type === 'service-response') resolve({ exitCode: 0, result: message.ok ? 'allowed' : message.error }); });
    parentPort.postMessage({ type: 'service', id: 'service:proto', service: 'constructor', method: 'keys', args: [{ a: 1 }] });
  }) });
} });`);
    await expect(run({}, context())).resolves.toEqual({ exitCode: 0, result: expect.stringMatching(/host service unavailable/) });
    await isolated.dispose();
  });

  it('fails an open output stream when the caller aborts after stream start', async () => {
    const { isolated, run } = await activateCommand(`
export default () => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'go', run: async function* () { yield 'first'; await new Promise(() => undefined); } });
} });`);
    const controller = new AbortController();
    const stream = await run({}, context({ signal: controller.signal })) as AsyncIterator<unknown>;
    await expect(stream.next()).resolves.toEqual({ done: false, value: 'first' });
    const pendingNext = stream.next();
    controller.abort();
    await expect(settlesWithin(pendingNext, 2_000)).rejects.toThrow(/aborted/);
    await isolated.dispose();
  });

  it('fails pending invocations promptly when mod code exits the worker with status 0', async () => {
    const { isolated, run } = await activateCommand(`
export default () => ({ apiVersion: '1', activate(registrar) {
  registrar.command('cli', { id: 'go', run: () => { process.exit(0); } });
} });`);
    await expect(settlesWithin(run({}, context()), 3_000)).rejects.toThrow(/exited with code 0/);
    await expect(settlesWithin(run({}, context()), 1_000)).rejects.toThrow(/exited with code 0/);
    await isolated.dispose();
  });

  it('rejects startup promptly when the worker exits before reporting ready', async () => {
    const started = Date.now();
    await expect(createIsolatedThirdPartyMod({ runtimeUrl: await runtime('process.exit(0);\nexport default () => ({});'), services: services(), timeoutMs: 20_000 }))
      .rejects.toThrow(/exited with code 0/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
