import type { TaskClass } from './types.js';

const PATTERNS: [RegExp, TaskClass][] = [
  [/\b(tests?|spec|coverage|assert)\b/i, 'test'],
  [/\b(fix|bug|error|crash|broken|regression)\b/i, 'bugfix'],
  [/\b(refactor|rename|extract|simplify|reorganize|clean)\b/i, 'refactor'],
  [/\b(algorithm|sort|search|scoring|math|compute|calculate)\b/i, 'algorithm'],
  [/\b(doc|readme|comment|changelog)\b/i, 'docs'],
  [/\b(add|implement|create|build|feature|new)\b/i, 'feature'],
];

/**
 * Detect task class from a task description using keyword matching.
 * Returns the first matching class, or 'other' if none match.
 */
export function classifyTask(description: string): TaskClass {
  for (const [pattern, taskClass] of PATTERNS) {
    if (pattern.test(description)) {
      return taskClass;
    }
  }
  return 'other';
}
