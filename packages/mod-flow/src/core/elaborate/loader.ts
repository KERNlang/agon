/**
 * Flow file resolution. Kept behind an interface so the elaborator is pure and
 * testable in memory — and so `agon flow validate` touches nothing but the
 * files a flow actually references.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';

export interface FlowLoader {
  /** Absolute, canonical key for `ref` interpreted relative to `fromFile`. */
  resolve(fromFile: string, ref: string): string;
  /** Absolute, canonical key for an ENTRY path (relative to the cwd). */
  resolveEntry(path: string): string;
  /** File text, or null when the file does not exist. */
  read(path: string): string | null;
}

export function createFsFlowLoader(): FlowLoader {
  return {
    resolve(fromFile, ref) {
      if (isAbsolute(ref)) return resolvePath(ref);
      return resolvePath(dirname(resolvePath(fromFile)), ref);
    },
    resolveEntry(path) {
      return resolvePath(path);
    },
    read(path) {
      if (!existsSync(path)) return null;
      try {
        return readFileSync(path, 'utf-8');
      } catch {
        return null;
      }
    },
  };
}

/**
 * In-memory loader for tests and for callers that already hold the flow text.
 * Keys are treated as POSIX-ish paths and resolved with the same semantics as
 * the fs loader (`./x.json` relative to the referring file's directory).
 */
export function createMemoryFlowLoader(files: Record<string, string>): FlowLoader {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(files)) {
    normalized.set(normalizeMemoryPath(key), value);
  }
  return {
    resolve(fromFile, ref) {
      if (ref.startsWith('/')) return normalizeMemoryPath(ref);
      const base = normalizeMemoryPath(fromFile);
      const dir = base.slice(0, base.lastIndexOf('/'));
      return normalizeMemoryPath(`${dir}/${ref}`);
    },
    resolveEntry(path) {
      return normalizeMemoryPath(path);
    },
    read(path) {
      return normalized.get(normalizeMemoryPath(path)) ?? null;
    },
  };
}

function normalizeMemoryPath(path: string): string {
  const absolute = path.startsWith('/') ? path : `/${path}`;
  const out: string[] = [];
  for (const segment of absolute.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join('/')}`;
}
