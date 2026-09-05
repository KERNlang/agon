import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Json, ModServices } from '@kernlang/agon-mod-api';
import { nodeHostIo, writeNewImmutableFile, type HostIo } from './host-io.js';

const SENSITIVE = /authorization|cookie|credential|password|secret|token|api[-_]?key/i;

function secretForms(secret: string): readonly string[] {
  const forms = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url')];
  return [...new Set(forms.filter((value) => value.length >= 4))].sort((left, right) => right.length - left.length);
}
export function collectProcessSecretValues(environment: Readonly<Record<string, string | undefined>> = process.env): readonly string[] {
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

/** Shared evidence contract for bundled and external mods; never a capability grant. */
export function createModObservability(options: {
  readonly receiptRoot: string;
  readonly owner: string;
  readonly contentHash: `sha256:${string}`;
  readonly io?: HostIo;
  readonly secretValues?: readonly string[];
}): Pick<ModServices, 'logger' | 'receipts'> {
  const io = options.io ?? nodeHostIo;
  const receipt = async (kind: string, payload: Json): Promise<string> => {
    if (!kind.trim()) throw new TypeError('receipt kind must be non-empty');
    const receiptId = randomUUID();
    const document = { schemaVersion: 1, receiptId, owner: options.owner, contentHash: options.contentHash,
      kind, payload: redact(payload, 0, options.secretValues ?? collectProcessSecretValues()), recordedAt: new Date().toISOString() };
    const encoded = JSON.stringify(document);
    if (Buffer.byteLength(encoded) > 1024 * 1024) throw new TypeError('mod receipt exceeds the 1 MiB limit');
    await io.mkdir(options.receiptRoot, { recursive: true, mode: 0o700 });
    await writeNewImmutableFile(io, join(options.receiptRoot, `${receiptId}.json`), encoded + '\n');
    return receiptId;
  };
  const log = async (level: 'debug' | 'info' | 'warn', message: string, fields?: Json): Promise<void> => {
    await receipt('log', { level, message, fields: fields ?? null });
    if (level === 'warn') console.warn(`[agon mod] ${JSON.stringify({ owner: options.owner, level, message: redactExternalDiagnostic(message, options.secretValues) })}`);
  };
  return Object.freeze({
    logger: Object.freeze({ debug: (message: string, fields?: Json) => log('debug', message, fields),
      info: (message: string, fields?: Json) => log('info', message, fields), warn: (message: string, fields?: Json) => log('warn', message, fields) }),
    receipts: Object.freeze({ record: receipt }),
  });
}
