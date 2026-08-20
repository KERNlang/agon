import { spawnSync } from 'node:child_process';

import { resolveDedupSidecar, resolveSidecarPython } from '../blocks/dedup-resolver.js';

export interface HistorySearchItem {
  id: string;
  text: string;
}

export interface HistorySearchHit {
  id: string;
  similarity: number;
}

/**
 * Hard cap on the synchronous Python call. Embedding ~50 manifests is ~700ms warm; cap at 5s to cover cold start safely.
 */
export const HISTORY_SEARCH_TIMEOUT_MS: number = 5000;

/**
 * Set this env var to skip the Python sidecar (forces substring fallback). Useful for tests and CI.
 */
export const HISTORY_SEARCH_DISABLE_ENV: string = "AGON_DISABLE_HISTORY_SEARCH_SIDECAR";

/**
 * Synchronous Python sidecar call. Returns null ONLY on sidecar unavailability/failure (caller should fall back to substring). Returns [] when the sidecar ran cleanly but had no above-threshold matches, or when there's nothing to search.
 */
export function searchHistorySemantic(query: string, items: HistorySearchItem[], topK: number): HistorySearchHit[] | null {
  if (process.env[HISTORY_SEARCH_DISABLE_ENV]) return null;
  // No query / no items: nothing to do, but distinguish this from sidecar
  // failure so the caller doesn't mislabel UX as "sidecar unavailable".
  if (!query || !query.trim()) return [];
  if (!items || items.length === 0) return [];

  const sidecar = resolveDedupSidecar('history-search.py');
  if (!sidecar) return null;

  const python = resolveSidecarPython();

  let result;
  try {
    result = spawnSync(python, [sidecar], {
      input: JSON.stringify({ query, items, top_k: topK }),
      timeout: HISTORY_SEARCH_TIMEOUT_MS,
      encoding: 'utf-8',
    });
  } catch {
    return null;
  }

  if (result.status !== 0 || !result.stdout) {
    // Silent degrade — chronological listing still works. `agon doctor` shows
    // the install hint; postinstall script attempts auto-install when Python
    // is available.
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const hits = parsed?.results;
    if (!Array.isArray(hits)) return null;
    return hits.filter((h: any) =>
      h && typeof h.id === 'string' && typeof h.similarity === 'number'
    ) as HistorySearchHit[];
  } catch {
    return null;
  }
}
