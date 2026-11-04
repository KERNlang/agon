import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export interface ConfigMemoEntry<T> {
  globalMtime: number;
  localMtime: number;
  localPrivateMtime: number;
  /** Timestamps remain diagnostic. Only captured contents authorize reuse. */
  contentHashes?: readonly (string | null)[];
  result: T;
}

export interface ScopedConfigStoreOptions<T extends object> {
  globalPath(): string;
  readonly localName: string;
  readonly privateLocalName: string;
  /** The caller owns defaults, scope policy, and value normalization. */
  merge(global: Partial<T>, local: Partial<T>, privateLocal: Partial<T>): T;
  /** Keep the existing synchronous cross-process lock at the host boundary. */
  withLock(path: string, action: () => void): void;
  /** Apply owner policy inside the lock, before the atomic write. */
  prepareWrite?(existing: Readonly<Partial<T>>, key: keyof T, value: Partial<T>[keyof T]): Partial<T>;
}

function statMtimeOrZero(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function readConfigSource(path: string | null): { bytes: string | null; hash: string | null; cacheable: boolean } {
  if (path === null) return { bytes: null, hash: null, cacheable: true };
  try {
    const bytes = readFileSync(path);
    return { bytes: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex'), cacheable: true };
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: null, hash: null, cacheable: true };
    console.warn(`[agon] warning: failed to read config ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return { bytes: null, hash: null, cacheable: false };
  }
}

function parseConfigSource<T>(path: string | null, bytes: string | null): T | null {
  if (bytes === null) return null;
  try { return JSON.parse(bytes) as T; }
  catch (err) {
    console.warn(`[agon] warning: failed to parse config ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function readConfigForWrite<T extends object>(path: string): Partial<T> {
  let bytes: Buffer;
  try { bytes = readFileSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch {
    // Parser messages can include configuration values. Keep them private.
    throw new Error(`Cannot update invalid JSON configuration at ${path}; repair the file before writing.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Cannot update non-object configuration at ${path}; repair the file before writing.`);
  }
  return value as Partial<T>;
}

/** Store mechanics only. This does not grant trust or activate executable mods. */
export function createScopedConfigStore<T extends object>(options: ScopedConfigStoreOptions<T>) {
  const cache = new Map<string, ConfigMemoEntry<T>>();
  function invalidate(): void { cache.clear(); }

  function load(cwd?: string): T {
    const globalPath = options.globalPath();
    const localPath = cwd ? join(cwd, options.localName) : null;
    const privatePath = cwd ? join(cwd, options.privateLocalName) : null;
    // Dynamic home paths must not share cache entries.
    const paths = [globalPath, localPath, privatePath];
    const key = JSON.stringify(paths);
    const sources = paths.map(readConfigSource);
    const contentHashes = sources.map(source => source.hash);
    const cacheable = sources.every(source => source.cacheable);
    const memo = cache.get(key);
    const memoHashes = memo?.contentHashes;
    if (cacheable && memo && memoHashes?.length === contentHashes.length
      && contentHashes.every((hash, index) => hash === memoHashes[index])) {
      return structuredClone(memo.result);
    }
    const [global, local, privateLocal] = sources.map((source, index) => parseConfigSource<Partial<T>>(paths[index], source.bytes) ?? {});
    const result = options.merge(global, local, privateLocal);
    const globalMtime = statMtimeOrZero(globalPath);
    const localMtime = localPath ? statMtimeOrZero(localPath) : 0;
    const localPrivateMtime = privatePath ? statMtimeOrZero(privatePath) : 0;
    if (cacheable) cache.set(key, { globalMtime, localMtime, localPrivateMtime, contentHashes, result });
    else cache.delete(key);
    // Clone on misses too, so callers cannot mutate the cached merge.
    return structuredClone(result);
  }

  function set(key: keyof T, value: Partial<T>[keyof T]): void {
    const globalPath = options.globalPath();
    options.withLock(globalPath + '.lock', () => {
      const existing = readConfigForWrite<T>(globalPath);
      const updated = options.prepareWrite ? options.prepareWrite(existing, key, value) : { ...existing, [key]: value };
      mkdirSync(dirname(globalPath), { recursive: true });
      const temporaryPath = globalPath + '.tmp';
      writeFileSync(temporaryPath, JSON.stringify(updated, null, 2) + '\n');
      renameSync(temporaryPath, globalPath);
    });
    invalidate();
  }

  return { cache, load, set, invalidate };
}
