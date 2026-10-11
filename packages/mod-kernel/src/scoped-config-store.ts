import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ConfigMemoEntry<T> {
  globalMtime: number;
  localMtime: number;
  localPrivateMtime: number;
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

function readJsonSafe<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf-8')) as T; }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] warning: failed to parse config ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
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
    const key = `${globalPath}|${localPath ?? ''}|${privatePath ?? ''}`;
    const globalMtime = statMtimeOrZero(globalPath);
    const localMtime = localPath ? statMtimeOrZero(localPath) : 0;
    const localPrivateMtime = privatePath ? statMtimeOrZero(privatePath) : 0;
    const memo = cache.get(key);
    if (memo && memo.globalMtime === globalMtime && memo.localMtime === localMtime
      && memo.localPrivateMtime === localPrivateMtime) {
      return structuredClone(memo.result);
    }
    const global = readJsonSafe<Partial<T>>(globalPath) ?? {};
    const local = localPath ? readJsonSafe<Partial<T>>(localPath) ?? {} : {};
    const privateLocal = privatePath ? readJsonSafe<Partial<T>>(privatePath) ?? {} : {};
    const result = options.merge(global, local, privateLocal);
    cache.set(key, { globalMtime, localMtime, localPrivateMtime, result });
    // Clone on misses too, so callers cannot mutate the cached merge.
    return structuredClone(result);
  }

  function set(key: keyof T, value: Partial<T>[keyof T]): void {
    const globalPath = options.globalPath();
    options.withLock(globalPath + '.lock', () => {
      const existing: Partial<T> = readJsonSafe<Partial<T>>(globalPath) ?? {};
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
