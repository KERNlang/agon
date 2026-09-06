import { AsyncLocalStorage } from 'node:async_hooks';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('third-party worker requires a parent port');
let serviceSequence = 0;
const servicePending = new Map();
const handlers = new Map();
const invocationControllers = new Map();
const invocationScope = new AsyncLocalStorage();
let mod;
let disposer;

function callService(service, method, args, invocationRequestId) {
  const id = `service:${++serviceSequence}`;
  return new Promise((resolve, reject) => {
    servicePending.set(id, { resolve, reject });
    parentPort.postMessage({ type: 'service', id, service, method, args, invocationRequestId });
  });
}

const services = Object.freeze({
  identity: Object.freeze(workerData.identity), source: workerData.source,
  logger: Object.freeze(Object.fromEntries(['debug', 'info', 'warn'].map((method) => [method, (...args) => callService('logger', method, args)]))),
  receipts: Object.freeze({ record: (...args) => callService('receipts', 'record', args) }),
  permissions: Object.freeze({ check: (...args) => callService('permissions', 'check', args) }),
  state: Object.freeze({ read: (...args) => callService('state', 'read', args), write: (...args) => callService('state', 'write', args) }),
  engines: Object.freeze({ dispatch: (engineId, prompt, _context, options) => {
    const active = invocationScope.getStore();
    if (!active) throw new Error('engine dispatch requires an active invocation');
    return callService('engines', 'dispatch', [engineId, prompt, { ...active.context, signal: undefined }, options], active.requestId);
  } }),
});

function descriptor(kind, surface, contribution) {
  const key = `${kind}:${surface ?? ''}:${contribution.id ?? contribution.event}`;
  handlers.set(key, contribution);
  const value = { ...contribution }; delete value.run; delete value.parse; delete value.handle; delete value.render;
  return { kind, surface, key, value };
}

function context(value, signal) {
  return { ...value, signal };
}

async function request(message) {
  if (message.op === 'activate') {
    const registrations = [];
    const registrar = {
      command: (surface, value) => { registrations.push(descriptor('command', surface, value)); return () => {}; },
      intent: (value) => { registrations.push(descriptor('intent', null, value)); return () => {}; },
      tool: (surface, value) => { registrations.push(descriptor('tool', surface, value)); return () => {}; },
      planStep: (value) => { registrations.push(descriptor('planStep', null, value)); return () => {}; },
      lifecycle: (value) => { registrations.push(descriptor('lifecycle', null, { ...value, id: value.event })); return () => {}; },
      resultType: (value) => { registrations.push(descriptor('resultType', null, value)); return () => {}; },
      docs: (value) => { registrations.push(descriptor('docs', null, value)); return () => {}; },
      config: (namespace, schema, aliases = []) => { registrations.push(descriptor('config', null, { id: namespace, schema, aliases })); return () => {}; },
    };
    disposer = await mod.activate(registrar, services);
    if (disposer !== undefined && typeof disposer !== 'function') throw new TypeError('mod activation disposer must be a function');
    return registrations;
  }
  if (message.op === 'dispose') { if (disposer) await disposer(); return null; }
  throw new Error(`unknown isolated worker operation: ${message.op}`);
}

parentPort.on('message', async (message) => {
  if (message.type === 'cancel') { invocationControllers.get(message.id)?.abort(); return; }
  if (message.type === 'service-response') {
    const pending = servicePending.get(message.id); if (!pending) return; servicePending.delete(message.id);
    if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error)); return;
  }
  if (message.type !== 'request') return;
  if (message.op === 'invoke') {
    let streaming = false;
    try {
      const contribution = handlers.get(message.key); if (!contribution) throw new Error(`isolated contribution is unavailable: ${message.key}`);
      if (message.method === 'parse') { parentPort.postMessage({ type: 'response', id: message.id, ok: true, value: await contribution.parse(message.args[0]) }); return; }
      if (message.method === 'render') { parentPort.postMessage({ type: 'response', id: message.id, ok: true, value: await contribution.render(message.args[0]) }); return; }
      const controller = new AbortController(); invocationControllers.set(message.id, controller);
      const invocationContext = context(message.args[1], controller.signal);
      try {
        const value = await invocationScope.run({ requestId: message.id, context: invocationContext }, async () => {
          if (message.method === 'handle') return contribution.handle(message.args[0], invocationContext);
          return contribution.run(message.args[0], invocationContext);
        });
        if (value && typeof value === 'object' && Symbol.asyncIterator in value) {
          if (!['command', 'intent', 'planStep'].includes(message.key.split(':', 1)[0])) throw new TypeError('this contribution kind cannot return an output stream');
          streaming = true; parentPort.postMessage({ type: 'stream-start', id: message.id });
          await invocationScope.run({ requestId: message.id, context: invocationContext }, async () => {
            for await (const event of value) parentPort.postMessage({ type: 'stream-event', id: message.id, value: event });
          });
          parentPort.postMessage({ type: 'stream-end', id: message.id });
        } else parentPort.postMessage({ type: 'response', id: message.id, ok: true, value });
      } finally { invocationControllers.delete(message.id); }
    } catch (error) {
      parentPort.postMessage({ type: streaming ? 'stream-error' : 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  try { parentPort.postMessage({ type: 'response', id: message.id, ok: true, value: await request(message) }); }
  catch (error) { parentPort.postMessage({ type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
});

try {
  const namespace = await import(workerData.runtimeUrl);
  if (typeof namespace.default !== 'function') throw new TypeError('runtime must default-export an AgonModFactory');
  mod = await namespace.default(services);
  if (!mod || mod.apiVersion !== '1' || typeof mod.activate !== 'function') throw new TypeError('mod factory returned an incompatible API');
  parentPort.postMessage({ type: 'ready', ok: true });
} catch (error) {
  parentPort.postMessage({ type: 'ready', ok: false, error: error instanceof Error ? error.message : String(error) });
}
