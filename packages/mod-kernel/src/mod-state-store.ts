import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Json } from '@kernlang/agon-mod-api';
import { canonicalJson, sha256Canonical } from './lock.js';

const OWNER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const MAX_KEY_BYTES = 4096;

export class ModStateStoreError extends Error {
  readonly code = 'MOD_STATE_INVALID';
}

function assertIdentity(ownerId: string, key: string): void {
  if (!OWNER.test(ownerId)) throw new ModStateStoreError(`invalid mod state owner: ${ownerId}`);
  if (!key || Buffer.byteLength(key) > MAX_KEY_BYTES || key.includes('\0')) throw new ModStateStoreError('invalid mod state key');
}

export class ModStateStore {
  constructor(readonly hostRoot: string, readonly ownerId: string) {
    assertIdentity(ownerId, 'constructor');
  }

  private path(key: string): string {
    assertIdentity(this.ownerId, key);
    return join(this.hostRoot, 'mod-state', this.ownerId, `${sha256Canonical(key).slice('sha256:'.length)}.json`);
  }

  async read<T extends Json>(key: string): Promise<T | undefined> {
    const path = this.path(key);
    let raw: string;
    try { raw = await readFile(path, 'utf8'); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
    let record: unknown;
    try { record = JSON.parse(raw); }
    catch { throw new ModStateStoreError(`mod state record is not valid JSON: ${this.ownerId}/${key}`); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new ModStateStoreError('mod state record must be an object');
    const value = record as Record<string, unknown>;
    if (value.schemaVersion !== 1 || value.ownerId !== this.ownerId || value.key !== key || !('value' in value)) {
      throw new ModStateStoreError(`mod state identity mismatch: ${this.ownerId}/${key}`);
    }
    return structuredClone(value.value) as T;
  }

  async write(key: string, value: Json): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${canonicalJson({ schemaVersion: 1, ownerId: this.ownerId, key, value })}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
