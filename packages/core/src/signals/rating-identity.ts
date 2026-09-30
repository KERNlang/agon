import type { DispatchOptions, EngineAdapter, EngineDefinition, EngineMeta, GlickoRating, RatingRecord } from '../models/types.js';

export type EngineIdentities = Record<string, string | null | undefined>;

export interface EngineIdentityMeta {
  identity?: string | null;
  pendingIdentity?: string;
  pendingCount?: number;
}

export interface IdentityNoteOptions {
  confirmRuns: number;
  phiMax: number;
  newMeta: () => EngineMeta;
}

function knownIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * True when the stored model identity of an engine and the identity it runs under now are both known and differ. An unknown side (legacy record, unresolvable backend) is never a change.
 */
export function identityChanged(meta: EngineMeta | undefined, current: string | null | undefined): boolean {
  const stored = (meta as (EngineMeta & EngineIdentityMeta) | undefined)?.identity;
  return knownIdentity(stored) && knownIdentity(current) && stored !== current;
}

function clearPending(meta: EngineMeta & EngineIdentityMeta): void {
  delete meta.pendingIdentity;
  delete meta.pendingCount;
}

function reopenEverywhere(record: RatingRecord, engineId: string, phiMax: number): void {
  const scopes: Array<Record<string, GlickoRating> | undefined> = [
    record.global,
    ...Object.values(record.byMode ?? {}),
    ...Object.values(record.byTaskClass ?? {}),
  ];
  for (const scope of scopes) {
    const rating = scope?.[engineId];
    if (!rating) continue;
    rating.phi = phiMax;
    rating.wins = 0;
    rating.losses = 0;
  }
}

/**
 * Record the model identity each engine ran under in one rating write, mutating the record in place. A first sighting only stores the identity. A differing identity must be seen in confirmRuns consecutive writes before it counts; seeing the stored identity again cancels it. A confirmed change reopens the engine's rating in every scope (phi to phiMax, wins/losses to 0, mu kept), appends the old identity to versions and stores the new one. Returns the engine ids that were reset.
 */
export function noteEngineIdentities(record: RatingRecord, identities: EngineIdentities, opts: IdentityNoteOptions): string[] {
  const reset: string[] = [];
  for (const [engineId, current] of Object.entries(identities)) {
    if (!knownIdentity(current)) continue;
    const meta = (record.engineMeta[engineId] ??= opts.newMeta()) as EngineMeta & EngineIdentityMeta;
    if (!knownIdentity(meta.identity)) {
      meta.identity = current;
      clearPending(meta);
      continue;
    }
    if (meta.identity === current) {
      clearPending(meta);
      continue;
    }
    meta.pendingCount = meta.pendingIdentity === current ? (meta.pendingCount ?? 0) + 1 : 1;
    meta.pendingIdentity = current;
    if (meta.pendingCount < opts.confirmRuns) continue;
    reopenEverywhere(record, engineId, opts.phiMax);
    meta.versions = [...(meta.versions ?? []), meta.identity];
    meta.identity = current;
    clearPending(meta);
    reset.push(engineId);
  }
  return reset;
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
  const identify = (adapter as { identify?: (engine: EngineDefinition, cwd?: string) => Promise<string | null> }).identify;
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
