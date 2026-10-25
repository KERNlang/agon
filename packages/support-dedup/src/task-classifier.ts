import { spawnSync } from 'node:child_process';

import { resolveDedupSidecar, resolveSidecarPython } from './dedup-resolver.js';

export function classifyTaskRegex(description: string) {
  const PATTERNS = [
    [/\b(doc|readme|comment|changelog)\b/i, 'docs'],
    [/\b(tests?|spec|coverage|assert)\b/i, 'test'],
    [/\b(fix|bug|error|crash|broken|regression)\b/i, 'bugfix'],
    [/\b(refactor|rename|extract|simplify|reorganize|clean)\b/i, 'refactor'],
    [/\b(algorithm|sort|search|scoring|math|compute|calculate)\b/i, 'algorithm'],
    [/\b(add|implement|create|build|feature|new)\b/i, 'feature'],
  ] as const;
  for (const [pattern, taskClass] of PATTERNS) {
    if (pattern.test(description)) return taskClass;
  }
  return 'other';
}

export const CLASSIFIER_CACHE: Map<string, ReturnType<typeof classifyTaskRegex>> = new Map();

/**
 * Hard cap on the synchronous Python sidecar call. If exceeded, fall back to 'other'. ~500ms cold, ~50ms warm in normal cases.
 */
export const CLASSIFIER_TIMEOUT_MS: number = 2000;

/**
 * Set this env var to any non-empty value to skip the Python escalation entirely (regex-only mode). Useful for tests or when Python is unavailable.
 */
export const CLASSIFIER_DISABLE_ENV: string = "AGON_DISABLE_CLASSIFIER_SIDECAR";

/**
 * Upper bound on text sent to the sidecar. The embedding model truncates far below this, and an unbounded paste must not be able to time out the call and latch the sidecar off for the whole process.
 */
export const CLASSIFIER_MAX_INPUT_CHARS: number = 4000;

const UNCLASSIFIABLE: Set<string> = new Set();

function boundSidecarInput(text: string): string {
  if (text.length <= CLASSIFIER_MAX_INPUT_CHARS) return text;
  const end = /[\uD800-\uDBFF]/.test(text[CLASSIFIER_MAX_INPUT_CHARS - 1]) ? CLASSIFIER_MAX_INPUT_CHARS - 1 : CLASSIFIER_MAX_INPUT_CHARS;
  return text.slice(0, end);
}

/**
 * Process-wide: set on the first spawn failure, timeout, non-zero exit or empty output so a broken sidecar costs at most one blocking call.
 */
let sidecarUnavailable = false;

/**
 * Synchronous Python sidecar escalation. Returns null on any failure — caller falls back to 'other'.
 */
export function classifyTaskSemantic(description: string): ReturnType<typeof classifyTaskRegex> | null {
  if (process.env[CLASSIFIER_DISABLE_ENV]) return null;

  const cached = CLASSIFIER_CACHE.get(description);
  if (cached !== undefined) return cached;
  if (sidecarUnavailable || UNCLASSIFIABLE.has(description) || !description.trim()) return null;

  const sidecar = resolveDedupSidecar('classifier.py');
  if (!sidecar) return null;

  const python = resolveSidecarPython();

  let result;
  try {
    result = spawnSync(python, [sidecar], {
      input: JSON.stringify({ text: boundSidecarInput(description) }),
      timeout: CLASSIFIER_TIMEOUT_MS,
      encoding: 'utf-8',
    });
  } catch {
    sidecarUnavailable = true;
    return null;
  }

  if (result.error || result.signal || result.status !== 0 || !result.stdout) {
    sidecarUnavailable = true;
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const cls = parsed?.class;
    const valid = ['algorithm', 'refactor', 'bugfix', 'test', 'docs', 'feature', 'other'];
    if (typeof cls !== 'string' || !valid.includes(cls)) {
      UNCLASSIFIABLE.add(description);
      return null;
    }
    const taskClass = cls as ReturnType<typeof classifyTaskRegex>;
    CLASSIFIER_CACHE.set(description, taskClass);
    return taskClass;
  } catch {
    UNCLASSIFIABLE.add(description);
    return null;
  }
}

export function resetClassifierSidecarState(): void {
  CLASSIFIER_CACHE.clear();
  UNCLASSIFIABLE.clear();
  sidecarUnavailable = false;
}

/**
 * Layered task classifier. Regex fast-path catches most cases instantly; Python sidecar escalation catches paraphrased / unusual phrasings. Result cached per session.
 */
export function classifyTask(description: string): ReturnType<typeof classifyTaskRegex> {
  const fast = classifyTaskRegex(description);
  if (fast !== 'other') return fast;

  const semantic = classifyTaskSemantic(description);
  return semantic ?? 'other';
}
