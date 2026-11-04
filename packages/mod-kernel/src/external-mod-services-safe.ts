import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { Json, ModManifest, ModServices } from '@kernlang/agon-mod-api';

import { atomicWrite, nodeHostIo, pathExists, readJson, type HostIo } from './host-io.js';

import { createModObservability } from './mod-observability.js';
export { collectProcessSecretValues, redactExternalDiagnostic } from './mod-observability.js';

const MAX_DOCUMENT_BYTES = 1024 * 1024;

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
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
  const observability = createModObservability({ receiptRoot, owner: options.manifest.id, contentHash: options.contentHash, io, secretValues: options.secretValues });
  const receipt = observability.receipts.record;
  return Object.freeze({
    identity: Object.freeze({ id: options.manifest.id, version: options.manifest.version, contentHash: options.contentHash }),
    source: options.source,
    ...observability,
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
