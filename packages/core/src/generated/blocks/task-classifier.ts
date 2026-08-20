import type { TaskClass } from '../models/types.js';

import { spawnSync } from 'node:child_process';

import { resolveDedupSidecar, resolveSidecarPython } from './dedup-resolver.js';

export function classifyTaskRegex(description: string): TaskClass {
  const PATTERNS: [RegExp, TaskClass][] = [
    [/\b(doc|readme|comment|changelog)\b/i, 'docs'],
    [/\b(tests?|spec|coverage|assert)\b/i, 'test'],
    [/\b(fix|bug|error|crash|broken|regression)\b/i, 'bugfix'],
    [/\b(refactor|rename|extract|simplify|reorganize|clean)\b/i, 'refactor'],
    [/\b(algorithm|sort|search|scoring|math|compute|calculate)\b/i, 'algorithm'],
    [/\b(add|implement|create|build|feature|new)\b/i, 'feature'],
  ];
  for (const [pattern, taskClass] of PATTERNS) {
    if (pattern.test(description)) return taskClass;
  }
  return 'other';
}

export const CLASSIFIER_CACHE: Map<string, TaskClass> = new Map();

/**
 * Hard cap on the synchronous Python sidecar call. If exceeded, fall back to 'other'. ~500ms cold, ~50ms warm in normal cases.
 */
export const CLASSIFIER_TIMEOUT_MS: number = 2000;

/**
 * Set this env var to any non-empty value to skip the Python escalation entirely (regex-only mode). Useful for tests or when Python is unavailable.
 */
export const CLASSIFIER_DISABLE_ENV: string = "AGON_DISABLE_CLASSIFIER_SIDECAR";

/**
 * Synchronous Python sidecar escalation. Returns null on any failure — caller falls back to 'other'.
 */
export function classifyTaskSemantic(description: string): TaskClass | null {
  if (process.env[CLASSIFIER_DISABLE_ENV]) return null;

  const cached = CLASSIFIER_CACHE.get(description);
  if (cached !== undefined) return cached;

  const sidecar = resolveDedupSidecar('classifier.py');
  if (!sidecar) return null;

  const python = resolveSidecarPython();

  let result;
  try {
    result = spawnSync(python, [sidecar], {
      input: JSON.stringify({ text: description }),
      timeout: CLASSIFIER_TIMEOUT_MS,
      encoding: 'utf-8',
    });
  } catch {
    return null;
  }

  if (result.status !== 0 || !result.stdout) {
    // Silent degrade. Regex fast-path handles the call. `agon doctor` surfaces
    // the install hint for users who want the semantic classifier. The
    // postinstall script attempts the install automatically when Python is
    // available, so the previous startup warning was redundant noise.
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const cls = parsed?.class;
    const valid = ['algorithm', 'refactor', 'bugfix', 'test', 'docs', 'feature', 'other'];
    if (typeof cls !== 'string' || !valid.includes(cls)) return null;
    const taskClass = cls as TaskClass;
    CLASSIFIER_CACHE.set(description, taskClass);
    return taskClass;
  } catch {
    return null;
  }
}

/**
 * Layered task classifier. Regex fast-path catches most cases instantly; Python sidecar escalation catches paraphrased / unusual phrasings. Result cached per session.
 */
export function classifyTask(description: string): TaskClass {
  const fast = classifyTaskRegex(description);
  if (fast !== 'other') return fast;

  const semantic = classifyTaskSemantic(description);
  return semantic ?? 'other';
}
