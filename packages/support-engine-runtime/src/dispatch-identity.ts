import type { DispatchOptions, EngineAdapter, EngineDefinition } from './types.js';

export type EngineIdentities = Record<string, string | null | undefined>;

function knownIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Wrap an adapter so every dispatch/dispatchAgent result that reports an `identity` (CliAdapter does) is remembered per engine id; identities() returns the last one seen for each engine. Everything else passes through to the original adapter.
 */
export function tapDispatchIdentities(adapter: EngineAdapter): { adapter: EngineAdapter; identities: () => EngineIdentities } {
  const seen: EngineIdentities = {};
  const tap = (method: 'dispatch' | 'dispatchAgent') => {
    const original = adapter[method] as ((options: DispatchOptions) => Promise<unknown>) | undefined;
    if (typeof original !== 'function') return undefined;
    return async (options: DispatchOptions) => {
      const result = await original.call(adapter, options);
      const identity = (result as { identity?: unknown } | null | undefined)?.identity;
      if (options.engine?.id && knownIdentity(identity)) seen[options.engine.id] = identity;
      return result;
    };
  };
  const dispatch = tap('dispatch');
  const dispatchAgent = tap('dispatchAgent');
  const tapped = new Proxy(adapter, {
    get(target, prop, receiver) {
      if (prop === 'dispatch' && dispatch) return dispatch;
      if (prop === 'dispatchAgent' && dispatchAgent) return dispatchAgent;
      return Reflect.get(target, prop, receiver);
    },
  });
  return { adapter: tapped, identities: () => ({ ...seen }) };
}

/**
 * Current model identity of each engine, resolved through the adapter's identify(engine, cwd) without dispatching. An adapter without identify (test doubles), an unknown engine id or a failed lookup yields no or a null entry, which ranking treats as unchanged.
 */
export async function resolveCurrentIdentities(adapter: EngineAdapter, registry: { get(id: string): EngineDefinition }, engineIds: string[], cwd?: string): Promise<EngineIdentities> {
  const identify = adapter.identify;
  if (typeof identify !== 'function') return {};
  const entries = await Promise.all(engineIds.map(async (id): Promise<[string, string | null]> => {
    try {
      return [id, await identify.call(adapter, registry.get(id), cwd)];
    } catch {
      return [id, null];
    }
  }));
  return Object.fromEntries(entries);
}
