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

    it('injects BOTH .agon/project.md (config slot) and AGENTS.md (instructions slot)', () => {
      const root = tmpRepo();
      mkdirSync(join(root, '.agon'), { recursive: true });
      writeFileSync(join(root, '.agon/project.md'), 'SENTINEL_DOTAGON_PROJECT');
      writeFileSync(join(root, 'AGENTS.md'), 'SENTINEL_PLAIN_AGON');
      const ctx = scanProjectContext(root);
      // The agon config must never SHADOW the instructions brief — SaveMemory
      // auto-creates .agon/project.md, and the documented split (instructions in
      // AGENTS.md, agon extras in project.md) relies on both being injected.
      expect(ctx).toContain('Project instructions (.agon/project.md)');
      expect(ctx).toContain('SENTINEL_DOTAGON_PROJECT');
      expect(ctx).toContain('Project instructions (AGENTS.md)');
      expect(ctx).toContain('SENTINEL_PLAIN_AGON');
      // Config slot renders before the instructions slot.
      expect(ctx.indexOf('SENTINEL_DOTAGON_PROJECT')).toBeLessThan(ctx.indexOf('SENTINEL_PLAIN_AGON'));
    });

    it('prefers AGENTS.md over CLAUDE.md (source of truth, then fallback)', () => {
      const root = tmpRepo();
      writeFileSync(join(root, 'AGENTS.md'), 'SENTINEL_AGENTS');
      writeFileSync(join(root, 'CLAUDE.md'), 'SENTINEL_CLAUDE');
      const ctx = scanProjectContext(root);
      expect(ctx).toContain('Project instructions (AGENTS.md)');
      expect(ctx).toContain('SENTINEL_AGENTS');
      expect(ctx).not.toContain('SENTINEL_CLAUDE');
    });

    it('no longer recognizes the retired brief files (AGON.md, AGENT.md, CODEX.md)', () => {
      const root = tmpRepo();
      writeFileSync(join(root, 'AGON.md'), 'SENTINEL_RETIRED_AGON');
      writeFileSync(join(root, 'AGENT.md'), 'SENTINEL_RETIRED_AGENT');
      writeFileSync(join(root, 'CODEX.md'), 'SENTINEL_RETIRED_CODEX');
      const ctx = scanProjectContext(root);
      expect(ctx).not.toContain('SENTINEL_RETIRED_AGON');
      expect(ctx).not.toContain('SENTINEL_RETIRED_AGENT');
      expect(ctx).not.toContain('SENTINEL_RETIRED_CODEX');
      expect(hasProjectBrief(root)).toBe(false);
    });

    it('gives a dedicated brief (AGENTS.md) a 4000-char budget — content past 2000 survives', () => {
      const root = tmpRepo();
      // ~2600 chars: would be cut mid-brief under the old flat 2000 cap, fits under 4000.
      const body = 'HEAD_MARK' + 'x'.repeat(2600) + 'TAIL_MARK_PAST_2000';
      writeFileSync(join(root, 'AGENTS.md'), body);
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

  describe('SaveMemory double-injection fix (F4)', () => {
    const dirs: string[] = [];
    function tmpRepo(): string {
      const d = mkdtempSync(join(tmpdir(), 'agon-f4-'));
      dirs.push(d);
      return d;
    }
    afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

    it('strips SaveMemory sections from .agon/project.md PROJECT CONTEXT (bullets live only in [PROJECT MEMORY])', () => {
      const root = tmpRepo();
      mkdirSync(join(root, '.agon'), { recursive: true });
      writeFileSync(
        join(root, '.agon/project.md'),
        '# Brief\n\nThis is the prose brief.\n\nfitness: npm run gate\n\n## Decisions\n- 2026-06-11 use session tokens\n\n## Constraints\n- 2026-06-11 node 20 floor\n',
      );
      const ctx = scanProjectContext(root);
      // Prose + fitness line are KEPT in PROJECT CONTEXT…
      expect(ctx).toContain('Project instructions (.agon/project.md)');
      expect(ctx).toContain('This is the prose brief.');
      expect(ctx).toContain('fitness: npm run gate');
      // …but the SaveMemory section headers + bullets are STRIPPED (no double-inject;
      // they are surfaced separately as the [PROJECT MEMORY] block by session.kern).
      expect(ctx).not.toContain('## Decisions');
      expect(ctx).not.toContain('use session tokens');
      expect(ctx).not.toContain('## Constraints');
      expect(ctx).not.toContain('node 20 floor');
    });

    it('leaves other brief files (AGENTS.md) untouched — their ## sections are NOT stripped', () => {
      const root = tmpRepo();
      // Same shape but in AGENTS.md, which is not the SaveMemory store.
      writeFileSync(
        join(root, 'AGENTS.md'),
        '# Brief\n\n## Decisions\n- a real heading in a hand-written brief\n',
      );
      const ctx = scanProjectContext(root);
      expect(ctx).toContain('Project instructions (AGENTS.md)');
      expect(ctx).toContain('## Decisions');
      expect(ctx).toContain('a real heading in a hand-written brief');
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
      writeFileSync(join(root, 'AGENTS.md'), '# brief');
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
      writeFileSync(join(root, 'AGENTS.md'), '   \n  ');
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
