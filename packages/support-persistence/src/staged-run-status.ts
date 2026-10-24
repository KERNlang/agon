import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { join } from 'node:path';

const limit = 1024 * 1024;
const engineStatuses = new Set(['ok', 'unstructured', 'blocking', 'parse-failure', 'timeout', 'error', 'skipped']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Basic result-shape check only: it cannot establish provenance or correctness. */
function hasResultShape(value: unknown): boolean {
  if (!object(value) || typeof value.mode !== 'string' || !value.mode.trim()
    || typeof value.summary !== 'string' || typeof value.ok !== 'boolean'
    || typeof value.startedAt !== 'string' || typeof value.endedAt !== 'string'
    || !Array.isArray(value.engines)) return false;
  const start = Date.parse(value.startedAt), end = Date.parse(value.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  return value.engines.every(engine => object(engine) && typeof engine.id === 'string' && engine.id.length > 0
    && typeof engine.status === 'string' && engineStatuses.has(engine.status));
}

/** Bounded, read-only diagnostic. Never returns model text, promotes a file, or
 * treats a staged outcome as trusted. The digest identifies observed bytes only.
 */
export function describeStagedRunStatus(runPath: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(join(runPath, '.status.json.tmp'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) return 'Staging: cannot safely inspect candidate (file type or size).';
    const buffer = Buffer.alloc(limit + 1);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > limit) return 'Staging: cannot safely inspect candidate (size limit).';
    const bytes = buffer.subarray(0, length);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return 'Staging: invalid or incomplete candidate; retained unchanged.'; }
    if (!hasResultShape(value)) return 'Staging: invalid or incomplete result shape; retained unchanged.';
    const digest = createHash('sha256').update(bytes).digest('hex');
    return `Staging: unpublished candidate with basic result shape (${length} bytes, sha256:${digest}); not verified or authorized for recovery. No files changed.`;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'Staging: no staged candidate.' : 'Staging: cannot safely inspect candidate (unavailable or unsafe path).';
  } finally { if (fd !== undefined) closeSync(fd); }
}
