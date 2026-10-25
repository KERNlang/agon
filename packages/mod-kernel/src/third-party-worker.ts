import { Worker } from 'node:worker_threads';
import type { AgonModV1, Dispose, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { ThirdPartyActivationError } from './third-party-activation.js';

interface Descriptor { readonly kind: string; readonly surface: string | null; readonly key: string; readonly value: Record<string, any>; }

interface RemoteStreamController {
  readonly iterable: AsyncIterable<any>;
  push(value: any): void;
  end(): void;
  fail(error: Error): void;
}

interface PendingRequest {
  resolve(value: any): void;
  reject(error: Error): void;
  readonly timer: NodeJS.Timeout;
  cleanup(): void;
  stream?: RemoteStreamController;
}

function createRemoteStream(onCancel: () => void, onOverflow: () => void): RemoteStreamController {
  const queue: any[] = [];
  const waiters: Array<{ resolve(value: IteratorResult<any>): void; reject(error: Error): void }> = [];
  let ended = false; let failure: Error | undefined;
  const settleDone = () => { for (const waiter of waiters.splice(0)) waiter.resolve({ done: true, value: undefined }); };
  const iterable: AsyncIterator<any> & AsyncIterable<any> = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() });
      if (failure) return Promise.reject(failure);
      if (ended) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    return() { if (!ended && !failure) onCancel(); ended = true; settleDone(); return Promise.resolve({ done: true, value: undefined }); },
  };
  return {
    iterable,
    push(value) {
      if (ended || failure) return;
      const waiter = waiters.shift();
      if (waiter) waiter.resolve({ done: false, value });
      else { queue.push(value); if (queue.length > 256) onOverflow(); }
    },
    end() { if (ended || failure) return; ended = true; settleDone(); },
    fail(error) { if (ended || failure) return; failure = error; queue.length = 0; for (const waiter of waiters.splice(0)) waiter.reject(error); },
  };
}

const INVOCATION_TIMEOUT_MS = 300_000;
const MAX_IN_FLIGHT_SERVICE_CALLS = 64;
const HOST_SERVICE_METHODS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  logger: ['debug', 'info', 'warn'], receipts: ['record'], permissions: ['check'], state: ['read', 'write'], engines: ['dispatch'],
});

function hostServiceMethod(services: ModServices, service: unknown, method: unknown): { target: object; method: (...args: unknown[]) => unknown } {
  const allowed = typeof service === 'string' && Object.hasOwn(HOST_SERVICE_METHODS, service) ? HOST_SERVICE_METHODS[service]! : [];
  const target = typeof method === 'string' && allowed.includes(method) ? (services as unknown as Record<string, Record<string, unknown>>)[service as string] : undefined;
  const fn = target?.[method as string];
  if (typeof fn !== 'function') throw new Error(`host service unavailable: ${String(service)}.${String(method)}`);
  return { target: target!, method: fn as (...args: unknown[]) => unknown };
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export async function createIsolatedThirdPartyMod(options: {
  readonly runtimeUrl: string; readonly services: ModServices; readonly timeoutMs: number;
}): Promise<{ readonly mod: AgonModV1; readonly dispose: () => Promise<void> }> {
  const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './third-party-worker-runner.mjs' : './third-party-worker-runner.js', import.meta.url), {
    workerData: { runtimeUrl: options.runtimeUrl, identity: options.services.identity, source: options.services.source },
  });
  let sequence = 0; let terminated = false; let workerFailure: ThirdPartyActivationError | undefined;
  let serviceCallsInFlight = 0;
  const invocations = new Map<string, { readonly context: InvocationContext; readonly controller: AbortController }>();
  const pending = new Map<string, PendingRequest>();
  let rejectReady: ((error: Error) => void) | undefined;
  const failPending = (failure: ThirdPartyActivationError) => {
    workerFailure = failure;
    rejectReady?.(failure);
    for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup(); item.stream?.fail(failure); item.reject(failure); }
    pending.clear();
    for (const invocation of invocations.values()) invocation.controller.abort(failure);
    invocations.clear();
  };
  const terminate = async () => {
    if (terminated) return;
    terminated = true;
    failPending(workerFailure ?? new ThirdPartyActivationError('isolated third-party worker terminated'));
    await worker.terminate();
  };
  const request = (op: string, payload: Record<string, unknown> = {}, timeoutMs = options.timeoutMs, signal?: AbortSignal, invocationContext?: InvocationContext): Promise<any> => {
    if (workerFailure) return Promise.reject(workerFailure);
    if (terminated) return Promise.reject(new ThirdPartyActivationError('isolated third-party worker is unavailable'));
    if (signal?.aborted) return Promise.reject(new ThirdPartyActivationError('third-party worker operation aborted', { boundary: `worker-${op}` }));
    const id = `host:${++sequence}`;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        invocations.get(id)?.controller.abort(); invocations.delete(id);
      };
      const onAbort = () => {
        const item = pending.get(id); if (!item) return;
        pending.delete(id); clearTimeout(item.timer); item.cleanup();
        if (!terminated) worker.postMessage({ type: 'cancel', id });
        const failure = new ThirdPartyActivationError('third-party worker operation aborted', { boundary: `worker-${op}` });
        item.stream?.fail(failure); item.reject(failure);
        // Give cooperative code one turn to observe its signal, then fail-stop the per-mod worker.
        setTimeout(() => { void terminate(); }, 50);
      };
      const timer = setTimeout(() => {
        const failure = new ThirdPartyActivationError('third-party worker operation timed out', { timeoutMs, boundary: `worker-${op}` });
        failPending(failure); void terminate();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, cleanup });
      if (invocationContext) invocations.set(id, { context: invocationContext, controller: new AbortController() });
      signal?.addEventListener('abort', onAbort, { once: true });
      try { worker.postMessage({ type: 'request', id, op, ...payload }); }
      catch (error) { clearTimeout(timer); cleanup(); pending.delete(id); reject(new ThirdPartyActivationError(errorText(error))); }
    });
  };
  const ready = new Promise<void>((resolve, reject) => {
    const settle = () => { clearTimeout(timer); worker.off('message', listener); rejectReady = undefined; };
    rejectReady = (error) => { settle(); reject(error); };
    const timer = setTimeout(() => {
      const failure = new ThirdPartyActivationError('third-party activation timed out', { timeoutMs: options.timeoutMs, boundary: 'worker-factory' });
      failPending(failure); void terminate();
    }, options.timeoutMs);
    const listener = (message: any) => {
      if (message.type !== 'ready') return;
      settle();
      message.ok ? resolve() : reject(new ThirdPartyActivationError(message.error));
    };
    worker.on('message', listener);
  });
  worker.on('message', (message: any) => {
    if (message.type === 'stream-start') {
      const item = pending.get(message.id); if (!item || item.stream) return;
      const cancel = () => {
        if (!pending.has(message.id)) return;
        const failure = new ThirdPartyActivationError('third-party output stream was abandoned', { boundary: 'worker-invoke' });
        pending.delete(message.id); clearTimeout(item.timer); item.cleanup(); item.stream?.fail(failure);
        if (!terminated) worker.postMessage({ type: 'cancel', id: message.id });
        setTimeout(() => { void terminate(); }, 50);
      };
      const overflow = () => {
        const failure = new ThirdPartyActivationError('third-party output stream exceeded its buffer limit', { boundary: 'worker-invoke', maxBufferedEvents: 256 });
        failPending(failure); void terminate();
      };
      item.stream = createRemoteStream(cancel, overflow); item.resolve(item.stream.iterable); return;
    }
    if (message.type === 'stream-event') {
      const item = pending.get(message.id); if (!item?.stream) { failPending(new ThirdPartyActivationError('third-party worker stream protocol violation')); void terminate(); return; }
      item.stream.push(message.value); return;
    }
    if (message.type === 'stream-end' || message.type === 'stream-error') {
      const item = pending.get(message.id); if (!item?.stream) return;
      pending.delete(message.id); clearTimeout(item.timer); item.cleanup();
      if (message.type === 'stream-end') item.stream.end(); else item.stream.fail(new ThirdPartyActivationError(message.error));
      return;
    }
    if (message.type === 'response') {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer); item.cleanup();
      message.ok ? item.resolve(message.value) : item.reject(new ThirdPartyActivationError(message.error)); return;
    }
    if (message.type !== 'service') return;
    if (serviceCallsInFlight >= MAX_IN_FLIGHT_SERVICE_CALLS) {
      if (!terminated) worker.postMessage({ type: 'service-response', id: message.id, ok: false, error: 'host service concurrency limit exceeded' });
      return;
    }
    serviceCallsInFlight += 1;
    void (async () => {
      try {
        const { target, method } = hostServiceMethod(options.services, message.service, message.method);
        let args: unknown[] = Array.isArray(message.args) ? message.args : [];
        if (message.service === 'engines') {
          const invocation = typeof message.invocationRequestId === 'string' ? invocations.get(message.invocationRequestId) : undefined;
          if (!invocation) throw new Error('engine dispatch is not bound to an active invocation');
          args = [args[0], args[1], { ...invocation.context, signal: invocation.context.signal ? AbortSignal.any([invocation.context.signal, invocation.controller.signal]) : invocation.controller.signal }, args[3]];
        }
        worker.postMessage({ type: 'service-response', id: message.id, ok: true, value: await method.apply(target, args) });
      } catch (error) {
        if (!terminated) worker.postMessage({ type: 'service-response', id: message.id, ok: false, error: errorText(error) });
      } finally { serviceCallsInFlight -= 1; }
    })();
  });
  worker.on('error', (error) => failPending(new ThirdPartyActivationError(errorText(error))));
  worker.on('exit', (code) => {
    if (!terminated) failPending(workerFailure ?? new ThirdPartyActivationError(`isolated third-party worker exited with code ${code}`));
  });
  try { await ready; } catch (error) { await terminate(); throw error; }
  // Message listeners ref a worker. Drop that idle ref after startup; active requests keep
  // the process alive through their bounded timeout handles.
  worker.unref();

  const invoke = (entry: Descriptor, method: string, args: readonly unknown[]) => {
    const context = args[1] as InvocationContext | undefined;
    const serializedArgs = context
      ? [args[0], { ...context, signal: undefined }]
      : args;
    return request('invoke', { key: entry.key, method, args: serializedArgs }, INVOCATION_TIMEOUT_MS, context?.signal, context);
  };
  const mod: AgonModV1 = Object.freeze({ apiVersion: '1', activate: async (registrar: Registrar) => {
    const entries = await request('activate') as Descriptor[]; const disposers: Dispose[] = [];
    for (const entry of entries) {
      const value = entry.value;
      if (entry.kind === 'command') disposers.push(registrar.command(entry.surface as 'cli' | 'tui', { ...value, run: (input: Json, context: InvocationContext) => invoke(entry, 'run', [input, context]) } as any));
      else if (entry.kind === 'intent') disposers.push(registrar.intent({ ...value, parse: (input: string) => invoke(entry, 'parse', [input]), run: (input: Json, context: InvocationContext) => invoke(entry, 'run', [input, context]) } as any));
      else if (entry.kind === 'tool') disposers.push(registrar.tool(entry.surface as 'mcp' | 'cesar', { ...value, run: (input: Json, context: InvocationContext) => invoke(entry, 'run', [input, context]) } as any));
      else if (entry.kind === 'planStep') disposers.push(registrar.planStep({ ...value, run: (input: Json, context: InvocationContext) => invoke(entry, 'run', [input, context]) } as any));
      else if (entry.kind === 'lifecycle') disposers.push(registrar.lifecycle({ ...value, event: value.id, handle: (input: Json, context: InvocationContext) => invoke(entry, 'handle', [input, context]) } as any));
      else if (entry.kind === 'resultType') disposers.push(registrar.resultType({ ...value, render: (input: Json) => invoke(entry, 'render', [input]) } as any));
      else if (entry.kind === 'docs') disposers.push(registrar.docs(value as any));
      else if (entry.kind === 'config') disposers.push(registrar.config(value.id, value.schema, value.aliases));
    }
    return async () => {
      for (const dispose of disposers.reverse()) await dispose();
      if (workerFailure || terminated) { await terminate(); return; }
      try { await request('dispose'); } finally { await terminate(); }
    };
  } });
  return Object.freeze({ mod, dispose: terminate });
}
