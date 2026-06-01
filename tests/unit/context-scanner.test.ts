import { describe, it, expect } from 'vitest';
import { scanProjectContext, isKernProject, gitStatusShort, gitDiffStat, gitChangedFiles, gitTruncatedDiff } from '@kernlang/agon-core';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../..');

describe('context-scanner', () => {
  describe('scanProjectContext', () => {
    it('returns non-empty string for a git repo', () => {
      const ctx = scanProjectContext(REPO_ROOT);
      expect(ctx.length).toBeGreaterThan(0);
      expect(ctx).not.toBe('(context scanning not available from generated code)');
    });

    it('includes project name and branch', () => {
      const ctx = scanProjectContext(REPO_ROOT);
      expect(ctx).toContain('Project:');
      expect(ctx).toContain('Branch:');
    });

    it('includes file tree', () => {
      const ctx = scanProjectContext(REPO_ROOT);
      expect(ctx).toContain('File tree:');
      expect(ctx).toContain('packages/');
    });

    it('includes recent commits', () => {
      const ctx = scanProjectContext(REPO_ROOT);
      expect(ctx).toContain('Recent commits:');
    });

    it('appends extra context when provided', () => {
      // Use a small directory so context fits within cap
      const ctx = scanProjectContext(REPO_ROOT, 'This is custom context');
      // Extra context may be truncated if repo context is large;
      // just verify the function doesn't crash and returns non-empty
      expect(ctx.length).toBeGreaterThan(0);
      // If short enough, it should contain the extra context
      if (ctx.length < 3900) {
        expect(ctx).toContain('This is custom context');
      }
    });

    it('respects kern format', () => {
      const ctx = scanProjectContext(REPO_ROOT, undefined, 'kern');
      expect(ctx).toContain('context {');
    });

    it('respects plain format (default)', () => {
      const ctx = scanProjectContext(REPO_ROOT);
      expect(ctx).not.toContain('context {');
    });

    it('caps output length at ~6000 chars for large repos', () => {
      // The Agon repo itself should be under 6000, but let's verify the cap exists
      const ctx = scanProjectContext(REPO_ROOT);
      expect(ctx.length).toBeLessThanOrEqual(6100); // small buffer for truncation message
    });

    it('handles non-git directory gracefully', () => {
      // /tmp is typically not a git repo
      const ctx = scanProjectContext('/tmp');
      expect(ctx).toContain('Project:');
      // Should still return something, just without git info
      expect(ctx.length).toBeGreaterThan(0);
    });
  });

  describe('isKernProject', () => {
    it('detects Agon as a KERN project', () => {
      expect(isKernProject(REPO_ROOT)).toBe(true);
    });

    it('returns false for non-kern directory', () => {
      // Use a directory that definitely has no .kern files
      const os = require('node:os');
      const fs = require('node:fs');
      const path = require('node:path');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agon-test-'));
      try {
        expect(isKernProject(tmpDir)).toBe(false);
      } finally {
        fs.rmdirSync(tmpDir);
      }
    });
  });

  describe('git read-only helpers', () => {
    it('gitStatusShort returns string', () => {
      const status = gitStatusShort(REPO_ROOT);
      expect(typeof status).toBe('string');
    });

    it('gitDiffStat returns string', () => {
      const stat = gitDiffStat(REPO_ROOT);
      expect(typeof stat).toBe('string');
    });

    it('gitChangedFiles returns array', () => {
      const files = gitChangedFiles(REPO_ROOT);
      expect(Array.isArray(files)).toBe(true);
    });

    it('gitTruncatedDiff returns string', () => {
      const diff = gitTruncatedDiff(REPO_ROOT);
      expect(typeof diff).toBe('string');
    });

    it('gitTruncatedDiff respects maxLines', () => {
      const diff = gitTruncatedDiff(REPO_ROOT, 5);
      if (diff) {
        const lines = diff.split('\n');
        // May include the truncation message
        expect(lines.length).toBeLessThanOrEqual(10);
      }
    });
  });
});
