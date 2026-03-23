import { describe, it, expect } from 'vitest';
import { parsePatch, patchSummary, invertPatch } from '@agon/core';

const SINGLE_FILE_PATCH = `diff --git a/src/auth.ts b/src/auth.ts
index abc1234..def5678 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,8 @@ function login(user: string) {
   const token = generateToken(user);
+  validateInput(user);
+  logAttempt(user);
   return token;
-  // old comment
 }`;

const MULTI_FILE_PATCH = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 import { hash } from 'crypto';
+import { validate } from './validate';

 function login() {
diff --git a/src/validate.ts b/src/validate.ts
new file mode 100644
--- /dev/null
+++ b/src/validate.ts
@@ -0,0 +1,5 @@
+export function validate(input: string): boolean {
+  if (!input) return false;
+  if (input.length > 100) return false;
+  return true;
+}`;

describe('patch-parser', () => {
  describe('parsePatch', () => {
    it('parses single-file patch', () => {
      const files = parsePatch(SINGLE_FILE_PATCH);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/auth.ts');
      expect(files[0].additions).toBe(2);
      expect(files[0].deletions).toBe(1);
      expect(files[0].hunks).toHaveLength(1);
    });

    it('parses multi-file patch', () => {
      const files = parsePatch(MULTI_FILE_PATCH);
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('src/auth.ts');
      expect(files[1].path).toBe('src/validate.ts');
    });

    it('counts additions and deletions per file', () => {
      const files = parsePatch(MULTI_FILE_PATCH);
      expect(files[0].additions).toBe(1);
      expect(files[0].deletions).toBe(0);
      expect(files[1].additions).toBe(5);
      expect(files[1].deletions).toBe(0);
    });

    it('counts additions and deletions per hunk', () => {
      const files = parsePatch(SINGLE_FILE_PATCH);
      const hunk = files[0].hunks[0];
      expect(hunk.additions).toBe(2);
      expect(hunk.deletions).toBe(1);
    });

    it('returns empty array for empty patch', () => {
      expect(parsePatch('')).toEqual([]);
    });

    it('returns empty array for non-patch content', () => {
      expect(parsePatch('This is not a patch')).toEqual([]);
    });
  });

  describe('patchSummary', () => {
    it('summarizes single-file patch', () => {
      const files = parsePatch(SINGLE_FILE_PATCH);
      const summary = patchSummary(files);
      expect(summary).toContain('1 file changed');
      expect(summary).toContain('+2');
      expect(summary).toContain('-1');
      expect(summary).toContain('src/auth.ts');
    });

    it('summarizes multi-file patch', () => {
      const files = parsePatch(MULTI_FILE_PATCH);
      const summary = patchSummary(files);
      expect(summary).toContain('2 files changed');
      expect(summary).toContain('src/auth.ts');
      expect(summary).toContain('src/validate.ts');
    });

    it('handles empty patch', () => {
      expect(patchSummary([])).toBe('(empty patch)');
    });
  });

  describe('invertPatch', () => {
    it('swaps + and - lines', () => {
      const inverted = invertPatch(SINGLE_FILE_PATCH);
      // Original additions become deletions
      expect(inverted).toContain('-  validateInput(user);');
      expect(inverted).toContain('-  logAttempt(user);');
      // Original deletion becomes addition
      expect(inverted).toContain('+  // old comment');
    });

    it('swaps --- and +++ headers', () => {
      const inverted = invertPatch(SINGLE_FILE_PATCH);
      expect(inverted).toContain('--- b/src/auth.ts');
      expect(inverted).toContain('+++ a/src/auth.ts');
    });

    it('swaps hunk header ranges', () => {
      const inverted = invertPatch(SINGLE_FILE_PATCH);
      // Original: @@ -10,6 +10,8 @@
      // Inverted: @@ -10,8 +10,6 @@
      expect(inverted).toContain('@@ -10,8 +10,6 @@');
    });

    it('preserves context lines', () => {
      const inverted = invertPatch(SINGLE_FILE_PATCH);
      expect(inverted).toContain('   const token = generateToken(user);');
      expect(inverted).toContain('   return token;');
    });

    it('round-trips: parsing inverted patch gives swapped counts', () => {
      const original = parsePatch(SINGLE_FILE_PATCH);
      const inverted = parsePatch(invertPatch(SINGLE_FILE_PATCH));
      expect(inverted[0].additions).toBe(original[0].deletions);
      expect(inverted[0].deletions).toBe(original[0].additions);
    });

    it('handles empty patch', () => {
      expect(invertPatch('')).toBe('');
    });
  });
});
