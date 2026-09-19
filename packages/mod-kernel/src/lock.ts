import { createHash } from 'node:crypto';
import { valid } from 'semver';
import type { ModPlatform, ModSource } from '@kernlang/agon-mod-api';
import type { ResolvedModGraph } from './resolver.js';

export interface LockedModPackage {
  readonly id: string;
  readonly version: string;
  readonly source: ModSource;
  readonly sourceLocator: string;
  readonly contentHash: `sha256:${string}`;
  readonly manifestHash: `sha256:${string}`;
  readonly platform: ModPlatform;
  readonly enabled: boolean;
  readonly resolutionOrder: number;
  readonly dependencies: readonly string[];
  readonly trustRecordId: string;
  readonly grantRecordIds: readonly string[];
}

export interface CanonicalModLock {
  readonly schemaVersion: 1;
  readonly kernelVersion: string;
  readonly apiVersion: string;
  readonly desiredStateHash: `sha256:${string}`;
  readonly graphHash: `sha256:${string}`;
  readonly packages: readonly LockedModPackage[];
}

function assertWellFormedString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) throw new TypeError('canonical JSON rejects lone surrogate');
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('canonical JSON rejects lone surrogate');
    }
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    assertWellFormedString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => {
      assertWellFormedString(key);
      if (record[key] === undefined) throw new TypeError(`canonical JSON rejects undefined at ${key}`);
      return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function sha256Canonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export interface CreateLockOptions {
  readonly kernelVersion: string;
  readonly apiVersion: string;
  readonly platform: ModPlatform;
  readonly desiredIds: readonly string[];
  readonly desiredStateHash: CanonicalModLock['desiredStateHash'];
  readonly trustRecordIds?: Readonly<Record<string, string>>;
  readonly grantRecordIds?: Readonly<Record<string, readonly string[]>>;
}

export function createCanonicalLock(graph: ResolvedModGraph, options: CreateLockOptions): CanonicalModLock {
  if (!valid(options.kernelVersion) || !valid(options.apiVersion)) {
    throw new TypeError('lock kernel and Mod API versions must be valid semver');
  }
  const context = graph.resolutionContext;
  if (context.kernelVersion !== options.kernelVersion || context.apiVersion !== options.apiVersion || context.platform !== options.platform) {
    throw new TypeError('lock options must exactly match the resolver context');
  }
  const selectedIds = graph.selected.map(({ manifest }) => manifest.id).sort();
  const desiredIds = [...options.desiredIds].sort();
  if (new Set(desiredIds).size !== desiredIds.length || canonicalJson(selectedIds) !== canonicalJson(desiredIds)) {
    throw new TypeError('lock desired IDs must exactly match the resolved graph');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(options.desiredStateHash)) throw new TypeError('lock desired-state hash must be SHA-256');
  const desiredStateHash = options.desiredStateHash;
  for (const candidate of graph.selected) {
    if (!candidate.sourceLocator.trim()) throw new TypeError('lock source locator cannot be empty: ' + candidate.manifest.id);
    if (!candidate.contentHash || !/^sha256:[a-f0-9]{64}$/.test(candidate.contentHash)) {
      throw new TypeError('verified content hash is required for lock package: ' + candidate.manifest.id);
    }
    if (!candidate.manifestHash || !/^sha256:[a-f0-9]{64}$/.test(candidate.manifestHash)) {
      throw new TypeError('verified manifest hash is required for lock package: ' + candidate.manifest.id);
    }
    if (!options.trustRecordIds?.[candidate.manifest.id]?.trim()) {
      throw new TypeError('trust record is required for lock package: ' + candidate.manifest.id);
    }
  }
  const packages: LockedModPackage[] = graph.selected.map((candidate, resolutionOrder) => ({
    id: candidate.manifest.id,
    version: candidate.manifest.version,
    source: candidate.source,
    sourceLocator: candidate.sourceLocator,
    contentHash: candidate.contentHash!,
    manifestHash: candidate.manifestHash!,
    platform: options.platform,
    enabled: true,
    resolutionOrder,
    dependencies: Object.freeze(candidate.manifest.dependencies.required.map(({ id }) => id).sort()),
    trustRecordId: options.trustRecordIds![candidate.manifest.id]!,
    grantRecordIds: Object.freeze([...(options.grantRecordIds?.[candidate.manifest.id] ?? [])].sort()),
  }));
  const graphHash = sha256Canonical({
    kernelVersion: options.kernelVersion,
    apiVersion: options.apiVersion,
    desiredStateHash,
    packages,
  });
  return Object.freeze({
    schemaVersion: 1,
    kernelVersion: options.kernelVersion,
    apiVersion: options.apiVersion,
    desiredStateHash,
    graphHash,
    packages: Object.freeze(packages.map((entry) => Object.freeze(entry))),
  });
}
