import { decodeGitPath } from './git-path.js';
import { parsePatch } from './patch-parser.js';

/**
 * Heuristic: a path is a test if it lives under a tests/ or __tests__ dir, or carries a .test/.spec suffix. Used to split WITNESS targets (tests) from MUTATION targets (source).
 */
export function isTestFile(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\//.test(path)
    || /\.(test|spec)\.[cm]?[tj]sx?$/.test(path);
}

/**
 * Map each file in a unified diff to the 1-based NEW-side line numbers it adds. Walks hunk headers (@@ -a,b +c,d @@) to track the new-side cursor; only '+' (added) lines are recorded — those are the lines mutation-witness perturbs.
 */
export function parseChangedLines(diff: string): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  let file = '';
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = decodeGitPath(raw.slice(4).replace(/\t.*$/, ''));
      file = p === '/dev/null' ? '' : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ')) continue;
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (!file || newLine === 0) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      (result[file] ??= []).push(newLine);
      newLine++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // removed line — no new-side advance
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — no advance
    } else {
      // context line (leading space, or empty trailing line)
      newLine++;
    }
  }
  return result;
}

/**
 * Files ADDED in this diff (old side is /dev/null). These are the candidate new tests WITNESS must prove fail-on-base.
 */
export function newFilesInDiff(diff: string): string[] {
  const files = new Set<string>();
  // Empty and binary additions can have only file metadata, without hunk headers.
  for (const block of diff.split(/(?=^diff --git )/m)) {
    if (!block.startsWith('diff --git ') || !/^new file mode /m.test(block)) continue;
    const file = parsePatch(block)[0];
    if (file) files.add(file.path);
  }
  const lines = diff.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('--- ') && lines[i].slice(4).trim().replace(/\t.*$/, '') === '/dev/null') {
      const next = lines[i + 1] ?? '';
      if (next.startsWith('+++ ')) {
        const p = decodeGitPath(next.slice(4).replace(/\t.*$/, ''));
        if (p !== '/dev/null') files.add(p.replace(/^b\//, ''));
      }
    }
  }
  return [...files];
}
