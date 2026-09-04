import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MOD_ID_PATTERN, type ModManifest, type ModSource } from '@kernlang/agon-mod-api';
import { valid as validVersion } from 'semver';
import { atomicWrite, nodeHostIo, pathExists, writeNewImmutableFile, type HostIo } from './host-io.js';
import { sha256Canonical } from './lock.js';

const HASH = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AUTHORITY_LIMITS = Object.freeze({ maxRecordsPerKind: 4_096, maxRecordBytes: 64 * 1024, maxTotalBytesPerKind: 16 * 1024 * 1024 });

export type TrustDecision = 'trusted' | 'rejected' | 'revoked';
export type TrustScope = 'exact-artifact' | 'explicit-dev-path';
export type GrantDecision = 'allow' | 'ask' | 'deny';

export interface TrustPublisher {
  readonly registryOrigin: string;
  readonly packageName: string;
  readonly provenanceIdentity: string;
  readonly provenanceStatus: 'verified' | 'absent' | 'invalid' | 'not-applicable';
}

export interface TrustRecord {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly sequence?: number;
  readonly modId: string;
  readonly version: string;
  readonly source: ModSource;
  readonly sourceLocator: string;
  readonly contentHash: `sha256:${string}`;
  readonly manifestHash: `sha256:${string}`;
  readonly decision: TrustDecision;
  readonly decidedAt: string;
  readonly scope: TrustScope;
  readonly publisher: TrustPublisher;
  readonly reason: string;
}

export interface GrantRecord {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly sequence?: number;
  readonly modId: string;
  readonly contentHash: `sha256:${string}`;
  readonly capability: string;
  readonly resources: readonly string[];
  readonly decision: GrantDecision;
  readonly grantedAt: string;
  readonly grantedBy: 'local-user';
  readonly reason: string;
  readonly revokedAt?: string;
}

export interface ThirdPartyArtifactIdentity {
  readonly modId: string;
  readonly version: string;
  readonly source: Exclude<ModSource, 'bundled'>;
  readonly sourceLocator: string;
  readonly contentHash: `sha256:${string}`;
  readonly manifestHash: `sha256:${string}`;
  readonly publisher: TrustPublisher;
}

export interface AuthorityEvaluation {
  readonly allowed: boolean;
  readonly trustRecordId?: string;
  readonly grantRecordIds: readonly string[];
  readonly missingCapabilities: readonly { capability: string; resources: readonly string[] }[];
  readonly reason?: 'invalid-provenance' | 'untrusted-source' | 'permission-not-granted';
  readonly trustModel: 'full-code';
}

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function hash(value: unknown, label: string): `sha256:${string}` {
  const parsed = text(value, label);
  if (!HASH.test(parsed)) throw new TypeError(`${label} must be a canonical SHA-256 hash`);
  return parsed as `sha256:${string}`;
}

function timestamp(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed)))
    throw new TypeError(`${label} must be a canonical UTC ISO timestamp`);
  return parsed;
}

function modId(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (parsed.length > 256 || !MOD_ID_PATTERN.test(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function sequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError('authority sequence must be a positive safe integer');
  return Number(value);
}

function recordId(value: unknown): string {
  const parsed = text(value, 'record ID');
  if (!UUID.test(parsed)) throw new TypeError('record ID must be a UUID');
  return parsed;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function parseTrustRecord(value: unknown): TrustRecord {
  const input = plain(value, 'trust record');
  exact(input, ['schemaVersion', 'recordId', 'modId', 'version', 'source', 'sourceLocator', 'contentHash', 'manifestHash', 'decision', 'decidedAt', 'scope', 'publisher', 'reason'], ['sequence'], 'trust record');
  if (input.schemaVersion !== 1) throw new TypeError('trust schema version must be 1');
  if (!['bundled', 'registry', 'user-folder', 'explicit-dev'].includes(String(input.source))) throw new TypeError('invalid trust source');
  if (!['trusted', 'rejected', 'revoked'].includes(String(input.decision))) throw new TypeError('invalid trust decision');
  if (!['exact-artifact', 'explicit-dev-path'].includes(String(input.scope))) throw new TypeError('invalid trust scope');
  const publisher = plain(input.publisher, 'trust publisher');
  exact(publisher, ['registryOrigin', 'packageName', 'provenanceIdentity', 'provenanceStatus'], [], 'trust publisher');
  if (!['verified', 'absent', 'invalid', 'not-applicable'].includes(String(publisher.provenanceStatus))) throw new TypeError('invalid provenance status');
  return freeze({
    schemaVersion: 1, recordId: recordId(input.recordId), ...(input.sequence === undefined ? {} : { sequence: sequence(input.sequence) }), modId: modId(input.modId, 'trust mod ID'),
    version: (() => { const value = text(input.version, 'trust version'); if (!validVersion(value)) throw new TypeError('trust version is invalid'); return value; })(), source: input.source as ModSource,
    sourceLocator: text(input.sourceLocator, 'trust source locator'), contentHash: hash(input.contentHash, 'trust content hash'),
    manifestHash: hash(input.manifestHash, 'trust manifest hash'), decision: input.decision as TrustDecision,
    decidedAt: timestamp(input.decidedAt, 'trust decidedAt'), scope: input.scope as TrustScope,
    publisher: { registryOrigin: text(publisher.registryOrigin, 'registry origin'), packageName: text(publisher.packageName, 'package name'), provenanceIdentity: text(publisher.provenanceIdentity, 'provenance identity'), provenanceStatus: publisher.provenanceStatus as TrustPublisher['provenanceStatus'] },
    reason: text(input.reason, 'trust reason'),
  });
}

export function parseGrantRecord(value: unknown): GrantRecord {
  const input = plain(value, 'grant record');
  exact(input, ['schemaVersion', 'recordId', 'modId', 'contentHash', 'capability', 'resources', 'decision', 'grantedAt', 'grantedBy', 'reason'], ['revokedAt', 'sequence'], 'grant record');
  if (input.schemaVersion !== 1) throw new TypeError('grant schema version must be 1');
  if (!Array.isArray(input.resources) || input.resources.some((resource) => typeof resource !== 'string')) throw new TypeError('grant resources must be strings');
  if (input.resources.some((resource) => resource.length < 1 || resource.length > 1024 || !/^[\x20-\x7e]+$/.test(resource))) {
    throw new TypeError('grant resources must be bounded printable ASCII');
  }
  if (new Set(input.resources).size !== input.resources.length) throw new TypeError('grant resources must be unique');
  if (!['allow', 'ask', 'deny'].includes(String(input.decision))) throw new TypeError('invalid grant decision');
  if (input.grantedBy !== 'local-user') throw new TypeError('grant principal must be local-user');
  return freeze({
    schemaVersion: 1, recordId: recordId(input.recordId), ...(input.sequence === undefined ? {} : { sequence: sequence(input.sequence) }), modId: modId(input.modId, 'grant mod ID'),
    contentHash: hash(input.contentHash, 'grant content hash'), capability: (() => { const value = text(input.capability, 'grant capability'); if (!/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new TypeError('grant capability is invalid'); return value; })(),
    resources: [...input.resources] as string[], decision: input.decision as GrantDecision,
    grantedAt: timestamp(input.grantedAt, 'grant grantedAt'), grantedBy: 'local-user', reason: text(input.reason, 'grant reason'),
    ...(input.revokedAt === undefined ? {} : { revokedAt: timestamp(input.revokedAt, 'grant revokedAt') }),
  });
}

function samePublisher(left: TrustPublisher, right: TrustPublisher): boolean {
  return left.registryOrigin === right.registryOrigin && left.packageName === right.packageName
    && left.provenanceIdentity === right.provenanceIdentity && left.provenanceStatus === right.provenanceStatus;
}

function resourcesEqual(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function evaluateThirdPartyAuthority(
  artifact: ThirdPartyArtifactIdentity,
  manifest: ModManifest,
  trustRecords: readonly TrustRecord[],
  grantRecords: readonly GrantRecord[],
): AuthorityEvaluation {
  if (artifact.publisher.provenanceStatus === 'invalid') {
    return freeze({ allowed: false, grantRecordIds: [], missingCapabilities: [], reason: 'invalid-provenance', trustModel: 'full-code' });
  }
  const newestFirst = <T extends { recordId: string; sequence?: number }>(records: readonly T[], at: (record: T) => string): T[] => [...records].sort((left, right) =>
    (right.sequence ?? 0) - (left.sequence ?? 0) || at(right).localeCompare(at(left)) || right.recordId.localeCompare(left.recordId));
  const matchingTrust = newestFirst(trustRecords, (record) => record.decidedAt).find((record) => {
    if (record.modId !== artifact.modId || record.source !== artifact.source || record.sourceLocator !== artifact.sourceLocator) return false;
    if (!samePublisher(record.publisher, artifact.publisher)) return false;
    if (record.scope === 'explicit-dev-path' && artifact.source !== 'explicit-dev') return false;
    return record.version === artifact.version
      && record.contentHash === artifact.contentHash
      && record.manifestHash === artifact.manifestHash;
  });
  if (!matchingTrust || matchingTrust.decision !== 'trusted') {
    return freeze({ allowed: false, grantRecordIds: [], missingCapabilities: manifest.permissions.map(({ capability, resources }) => ({ capability, resources })), reason: 'untrusted-source', trustModel: 'full-code' });
  }
  const grantRecordIds: string[] = [];
  const missingCapabilities: { capability: string; resources: readonly string[] }[] = [];
  const grantsNewestFirst = newestFirst(grantRecords, (record) => record.grantedAt);
  for (const permission of manifest.permissions) {
    const grant = grantsNewestFirst.find((record) => record.modId === artifact.modId
      && record.contentHash === artifact.contentHash && record.capability === permission.capability
      && resourcesEqual(record.resources, permission.resources));
    if (!grant || grant.decision !== 'allow' || grant.revokedAt) {
      if (permission.required) missingCapabilities.push({ capability: permission.capability, resources: permission.resources });
    } else grantRecordIds.push(grant.recordId);
  }
  return freeze({
    allowed: missingCapabilities.length === 0,
    trustRecordId: matchingTrust.recordId,
    grantRecordIds: grantRecordIds.sort(),
    missingCapabilities,
    ...(missingCapabilities.length ? { reason: 'permission-not-granted' as const } : {}),
    trustModel: 'full-code',
  });
}
export interface AuthorityMutationPlan {
  readonly schemaVersion: 1;
  readonly kind: 'trust' | 'grant';
  readonly record: TrustRecord | GrantRecord;
  readonly warning: 'executable code receives full code trust; worker isolation is not a sandbox';
  readonly planHash: `sha256:${string}`;
}


export class TrustGrantStore {
  readonly paths: Readonly<{ trust: string; grants: string; authorityMarker: string }>;
  constructor(readonly root: string, readonly io: HostIo = nodeHostIo) {
    this.paths = Object.freeze({ trust: join(root, 'trust'), grants: join(root, 'grants'), authorityMarker: join(root, 'authority-owned-by-local-user') });
  }
  async initialize(): Promise<void> {
    await this.io.mkdir(this.paths.trust, { recursive: true, mode: 0o700 });
    await this.io.mkdir(this.paths.grants, { recursive: true, mode: 0o700 });
    if (!await pathExists(this.io, this.paths.authorityMarker)) await atomicWrite(this.io, this.paths.authorityMarker, 'local-user\n');
  }
  previewTrust(input: Omit<TrustRecord, 'schemaVersion' | 'recordId'> & { recordId?: string }): AuthorityMutationPlan {
    const record = parseTrustRecord({ ...input, schemaVersion: 1, recordId: input.recordId ?? randomUUID() });
    const unsigned = { schemaVersion: 1 as const, kind: 'trust' as const, record, warning: 'executable code receives full code trust; worker isolation is not a sandbox' as const };
    return freeze({ ...unsigned, planHash: sha256Canonical(unsigned) });
  }
  previewGrant(input: Omit<GrantRecord, 'schemaVersion' | 'recordId'> & { recordId?: string }): AuthorityMutationPlan {
    const record = parseGrantRecord({ ...input, schemaVersion: 1, recordId: input.recordId ?? randomUUID() });
    const unsigned = { schemaVersion: 1 as const, kind: 'grant' as const, record, warning: 'executable code receives full code trust; worker isolation is not a sandbox' as const };
    return freeze({ ...unsigned, planHash: sha256Canonical(unsigned) });
  }
  async nextSequence(): Promise<number> {
    const [trust, grants] = await Promise.all([this.readTrust(), this.readGrants()]);
    return Math.max(0, ...[...trust, ...grants].map((record) => record.sequence ?? 0)) + 1;
  }
  materialize(plan: AuthorityMutationPlan, approval: { readonly approvedPlanHash: string }, assignedSequence: number): TrustRecord | GrantRecord {
    const { planHash, ...unsigned } = plan;
    if (planHash !== sha256Canonical(unsigned)) throw new TypeError('authority plan hash mismatch');
    if (approval.approvedPlanHash !== planHash) throw new TypeError('authority approval does not match the exact plan');
    if (plan.kind === 'trust') return parseTrustRecord({ ...plan.record, sequence: assignedSequence });
    return parseGrantRecord({ ...plan.record, sequence: assignedSequence });
  }
  async apply(plan: AuthorityMutationPlan, approval: { readonly approvedPlanHash: string }, assignedSequence?: number): Promise<TrustRecord | GrantRecord> {
    await this.initialize();
    const record = this.materialize(plan, approval, assignedSequence ?? await this.nextSequence());
    if (plan.kind === 'trust') {
      await writeNewImmutableFile(this.io, join(this.paths.trust, `${record.recordId}.json`), JSON.stringify(record) + '\n');
      return record;
    }
    await writeNewImmutableFile(this.io, join(this.paths.grants, `${record.recordId}.json`), JSON.stringify(record) + '\n');
    return record;
  }
  async readTrust(): Promise<readonly TrustRecord[]> { return this.#readRecords(this.paths.trust, parseTrustRecord); }
  async readGrants(): Promise<readonly GrantRecord[]> { return this.#readRecords(this.paths.grants, parseGrantRecord); }
  async #readRecords<T>(directory: string, parse: (value: unknown) => T): Promise<readonly T[]> {
    if (!await pathExists(this.io, directory)) return Object.freeze([]);
    const names = (await this.io.readdir(directory)).map(String).filter((name) => name.endsWith('.json')).sort();
    if (names.length > AUTHORITY_LIMITS.maxRecordsPerKind) throw new RangeError('authority record count exceeds the configured limit');
    const records: T[] = [];
    let totalBytes = 0;
    for (const name of names) {
      if (!UUID.test(name.slice(0, -5))) throw new TypeError('authority record filename must be a UUID');
      const path = join(directory, name);
      const observed = await this.io.stat(path);
      if (!observed.isFile() || observed.size > AUTHORITY_LIMITS.maxRecordBytes) throw new RangeError('authority record exceeds the configured file limit');
      totalBytes += observed.size;
      if (totalBytes > AUTHORITY_LIMITS.maxTotalBytesPerKind) throw new RangeError('authority records exceed the configured aggregate limit');
      const bytes = await this.io.readFile(path);
      if (bytes.byteLength !== observed.size || bytes.byteLength > AUTHORITY_LIMITS.maxRecordBytes) throw new RangeError('authority record changed during bounded read');
      records.push(parse(JSON.parse(new TextDecoder().decode(bytes))));
    }
    return Object.freeze(records);
  }
}
