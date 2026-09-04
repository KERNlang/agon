import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { Json, ModManifest, ModServices } from '@kernlang/agon-mod-api';

import { atomicWrite, nodeHostIo, pathExists, readJson, writeNewImmutableFile, type HostIo } from './host-io.js';

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const SENSITIVE = /authorization|cookie|credential|password|secret|token|api[-_]?key/i;

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function secretForms(secret: string): readonly string[] {
  const forms = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url')];
  return [...new Set(forms.filter((value) => value.length >= 4))].sort((left, right) => right.length - left.length);
}
export function collectProcessSecretValues(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  return Object.freeze(Object.entries(environment).filter(([key, value]) => SENSITIVE.test(key) && typeof value === 'string' && value.length >= 4)
    .slice(0, 64).map(([, value]) => value!));
}
function redact(value: Json, depth = 0, secrets: readonly string[] = []): Json {
  if (depth > 24) return '[depth-redacted]';
  if (typeof value === 'string') {
    let output = value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
      .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1[redacted]@')
      .replace(/([?&](?:access_token|api[-_]?key|auth|credential|password|secret|token)=)[^&#\s]+/gi, '$1[redacted]');
    for (const secret of secrets.filter(Boolean).flatMap(secretForms)) output = output.split(secret).join('[redacted]');
    return output;
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1, secrets));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE.test(key) ? '[redacted]' : redact(entry, depth + 1, secrets)]));
}
export function redactExternalDiagnostic(message: string, secretValues: readonly string[] = collectProcessSecretValues()): string {
  return String(redact(message, 0, secretValues)).slice(0, 4096);
}
function encode(value: Json): string {
  const output = JSON.stringify(value);
  if (Buffer.byteLength(output) > MAX_DOCUMENT_BYTES) throw new TypeError('external mod state or receipt exceeds the 1 MiB limit');
  return output;
}

/** Owner/content-scoped persistence and receipts; privileged host capabilities are deliberately absent. */
export function createSafeExternalModServices(options: {
  readonly hostRoot: string;
  readonly manifest: ModManifest;
  readonly contentHash: `sha256:${string}`;
  readonly source: 'user-folder' | 'explicit-dev';
  readonly io?: HostIo;
  readonly secretValues?: readonly string[];
}): ModServices {
  const io = options.io ?? nodeHostIo;
  const ownerRoot = join(options.hostRoot, 'external-mod-data', digest(`${options.manifest.id}\0${options.contentHash}`));
  const stateRoot = join(ownerRoot, 'state');
  const receiptRoot = join(ownerRoot, 'receipts');
  const receipt = async (kind: string, payload: Json): Promise<string> => {
    if (!kind.trim()) throw new TypeError('receipt kind must be non-empty');
    await io.mkdir(receiptRoot, { recursive: true, mode: 0o700 });
    const receiptId = randomUUID();
    const document = { schemaVersion: 1, receiptId, owner: options.manifest.id, contentHash: options.contentHash,
      kind, payload: redact(payload, 0, options.secretValues ?? collectProcessSecretValues()), recordedAt: new Date().toISOString() } as unknown as Json;
    await writeNewImmutableFile(io, join(receiptRoot, `${receiptId}.json`), encode(document) + '\n');
    return receiptId;
  };
  const log = async (level: 'debug' | 'info' | 'warn', message: string, fields?: Json): Promise<void> => {
    await receipt('log', { level, message, fields: fields ?? null });
    if (level === 'warn') console.warn(`[agon mod] ${JSON.stringify({ owner: options.manifest.id, level, message: redact(message, 0, options.secretValues ?? collectProcessSecretValues()) })}`);
  };
  return Object.freeze({
    identity: Object.freeze({ id: options.manifest.id, version: options.manifest.version, contentHash: options.contentHash }),
    source: options.source,
    logger: Object.freeze({ debug: (message: string, fields?: Json) => log('debug', message, fields),
      info: (message: string, fields?: Json) => log('info', message, fields), warn: (message: string, fields?: Json) => log('warn', message, fields) }),
    receipts: Object.freeze({ record: receipt }),
    permissions: Object.freeze({ check: async (capability: string, resource?: string) => {
      await receipt('permission-check', { capability, resource: resource ?? null, decision: 'deny-before-authority-wrapper' });
      return 'deny' as const;
    } }),
    state: Object.freeze({
      read: async <T extends Json>(key: string): Promise<T | undefined> => {
        if (!key || key.length > 512 || key.includes('\0')) throw new TypeError('external mod state key is invalid');
        const path = join(stateRoot, `${digest(key)}.json`);
        if (!await pathExists(io, path)) return undefined;
        const document = await readJson<{ readonly key: string; readonly value: T }>(io, path);
        if (document.key !== key) throw new Error('external mod state key hash collision');
        await receipt('state-read', { key });
        return document.value;
      },
      write: async (key: string, value: Json): Promise<void> => {
        if (!key || key.length > 512 || key.includes('\0')) throw new TypeError('external mod state key is invalid');
        await io.mkdir(stateRoot, { recursive: true, mode: 0o700 });
        await atomicWrite(io, join(stateRoot, `${digest(key)}.json`), encode({ key, value }) + '\n');
        await receipt('state-write', { key });
      },
    }),
    engines: Object.freeze({ dispatch: async () => { throw new Error('engine dispatch requires an explicit granted host capability'); } }),
  });
}
