import { describe, it, expect } from 'vitest';
import {
  isTestFile, parseChangedLines, newFilesInDiff,
} from '../../packages/forge/src/generated/goal/diff.js';

describe('isTestFile', () => {
  it('matches test/spec suffixes and tests dirs', () => {
    for (const p of [
      'src/foo.test.ts', 'src/foo.spec.tsx', 'a/b.test.js',
      'tests/unit/x.ts', 'packages/core/test/y.ts', 'src/__tests__/z.ts',
    ]) expect(isTestFile(p)).toBe(true);
  });
  it('does not match plain source files', () => {
    for (const p of ['src/foo.ts', 'src/contest.ts', 'lib/spectrum.ts', 'src/latest.ts']) {
      expect(isTestFile(p)).toBe(false);
    }
  });
});

describe('parseChangedLines', () => {
  it('records new-side line numbers of added lines per file', () => {
    // Modify src/a.ts: at new-side line 10 add two lines; one context line between.
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -9,3 +9,5 @@ function f() {',
      ' const x = 1;',   // new line 9 (context)
      '+const y = 2;',   // new line 10 (added)
      '+const z = 3;',   // new line 11 (added)
      ' return x;',      // new line 12 (context)
      '-const old = 0;', // removed — no new-side advance
      ' }',              // new line 13 (context)
    ].join('\n');
    const changed = parseChangedLines(diff);
    expect(changed['src/a.ts']).toEqual([10, 11]);
  });

  it('handles multiple files and multiple hunks', () => {
    const diff = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',           // x.ts new line 2
      '--- a/y.ts',
      '+++ b/y.ts',
      '@@ -5,0 +6,1 @@',
      '+hello',       // y.ts new line 6
    ].join('\n');
    const changed = parseChangedLines(diff);
    expect(changed['x.ts']).toEqual([2]);
    expect(changed['y.ts']).toEqual([6]);
  });

  it('ignores the +++ header itself and quoted/dev-null paths', () => {
    const diff = ['--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,1 @@', '+created'].join('\n');
    expect(parseChangedLines(diff)['new.ts']).toEqual([1]);
  });
});

describe('newFilesInDiff', () => {
  it('returns only files whose old side is /dev/null', () => {
    const diff = [
      '--- a/edited.ts',
      '+++ b/edited.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '--- /dev/null',
      '+++ b/tests/added.test.ts',
      '@@ -0,0 +1,2 @@',
      '+import x',
      '+expect(x)',
    ].join('\n');
    expect(newFilesInDiff(diff)).toEqual(['tests/added.test.ts']);
  });
});
