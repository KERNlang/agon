import type { EngineMeta, GlickoRating, RatingRecord } from './types.js';
import type { EngineIdentities } from '@kernlang/agon-support-engine-runtime';

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
