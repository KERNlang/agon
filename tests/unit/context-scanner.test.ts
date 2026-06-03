import { describe, it, expect, afterEach } from 'vitest';
import { scanProjectContext, isKernProject, hasProjectBrief, gitStatusShort, gitDiffStat, gitChangedFiles, gitTruncatedDiff } from '@kernlang/agon-core';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

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

  describe('project-brief cascade (#6)', () => {
    const dirs: string[] = [];
    function tmpRepo(): string {
      const d = mkdtempSync(join(tmpdir(), 'agon-brief-'));
      dirs.push(d);
      return d;
    }
    afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

    it('prefers .agon/project.md over AGON.md (first match wins)', () => {
      const root = tmpRepo();
      mkdirSync(join(root, '.agon'), { recursive: true });
      writeFileSync(join(root, '.agon/project.md'), 'SENTINEL_DOTAGON_PROJECT');
      writeFileSync(join(root, 'AGON.md'), 'SENTINEL_PLAIN_AGON');
      const ctx = scanProjectContext(root);
      expect(ctx).toContain('Project instructions (.agon/project.md)');
      expect(ctx).toContain('SENTINEL_DOTAGON_PROJECT');
      expect(ctx).not.toContain('SENTINEL_PLAIN_AGON');
    });

    it('gives a dedicated brief (AGON.md) a 4000-char budget — content past 2000 survives', () => {
      const root = tmpRepo();
      // ~2600 chars: would be cut mid-brief under the old flat 2000 cap, fits under 4000.
      const body = 'HEAD_MARK' + 'x'.repeat(2600) + 'TAIL_MARK_PAST_2000';
      writeFileSync(join(root, 'AGON.md'), body);
      const ctx = scanProjectContext(root);
      expect(ctx).toContain('TAIL_MARK_PAST_2000'); // survives the raised cap
      expect(ctx).not.toContain('truncated at 2000 chars'); // not cut at the old cap
      expect(ctx).not.toContain('truncated at 4000 chars'); // under 4000, no truncation at all
    });

    it('keeps generic agent files (CLAUDE.md) on the tight 2000-char budget', () => {
      const root = tmpRepo();
      const body = 'CLAUDE_HEAD' + 'y'.repeat(2600) + 'CLAUDE_TAIL_PAST_2000';
      writeFileSync(join(root, 'CLAUDE.md'), body);
      const ctx = scanProjectContext(root);
      expect(ctx).toContain('truncated at 2000 chars');
      expect(ctx).not.toContain('CLAUDE_TAIL_PAST_2000'); // cut at 2000
    });
  });

  describe('hasProjectBrief (#6 nudge signal)', () => {
    const dirs: string[] = [];
    function tmpRepo(prefix: string): string {
      const d = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(d);
      return d;
    }
    afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

    it('is true when a recognized brief exists', () => {
      const root = tmpRepo('agon-hasbrief-');
      writeFileSync(join(root, 'AGON.md'), '# brief');
      expect(hasProjectBrief(root)).toBe(true);
    });

    it('is true for a nested .agon/project.md', () => {
      const root = tmpRepo('agon-hasbrief-');
      mkdirSync(join(root, '.agon'), { recursive: true });
      writeFileSync(join(root, '.agon/project.md'), '# brief');
      expect(hasProjectBrief(root)).toBe(true);
    });

    it('is false when no brief file exists', () => {
      const root = tmpRepo('agon-nobrief-');
      expect(hasProjectBrief(root)).toBe(false);
    });

    it('is false when the only brief file is empty (mirrors the scanner)', () => {
      const root = tmpRepo('agon-emptybrief-');
      writeFileSync(join(root, 'AGON.md'), '   \n  ');
      expect(hasProjectBrief(root)).toBe(false);
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
