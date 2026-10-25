import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildGlobalInstructionsBlock, MAX_GLOBAL_INSTRUCTIONS_CHARS } from '@kernlang/agon-core';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MAX_PROJECT_BRIEF_BYTES } from '../../packages/core/src/blocks/context-scanner.js';
import { tmpdir } from 'node:os';

describe('buildGlobalInstructionsBlock', () => {
  let home: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agon-global-'));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    rmSync(home, { recursive: true, force: true });
  });

  it('returns empty string when the file is missing', () => {
    expect(buildGlobalInstructionsBlock(home)).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns empty string for whitespace-only content', () => {
    writeFileSync(join(home, 'AGENTS.md'), '  \n\n');
    expect(buildGlobalInstructionsBlock(home)).toBe('');
  });

  it('wraps content with a header naming the real path', () => {
    writeFileSync(join(home, 'AGENTS.md'), '# Rules\nBe nice.\n');
    const block = buildGlobalInstructionsBlock(home);
    expect(block.startsWith(`## GLOBAL INSTRUCTIONS (${join(home, 'AGENTS.md')})`)).toBe(true);
    expect(block).toContain('PROJECT CONTEXT below may refine them');
    expect(block).toContain('# Rules\nBe nice.');
  });

  it('follows a symlink to a regular file', () => {
    const real = join(home, 'real.md');
    writeFileSync(real, 'linked doctrine');
    symlinkSync(real, join(home, 'AGENTS.md'));
    expect(buildGlobalInstructionsBlock(home)).toContain('linked doctrine');
  });

  it('skips a dangling symlink with a warning', () => {
    symlinkSync(join(home, 'nowhere.md'), join(home, 'AGENTS.md'));
    expect(buildGlobalInstructionsBlock(home)).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('global instructions skipped: dangling symlink');
  });

  it('skips a directory named AGENTS.md', () => {
    mkdirSync(join(home, 'AGENTS.md'));
    expect(buildGlobalInstructionsBlock(home)).toBe('');
    expect(warn).toHaveBeenCalled();
  });

  it('warns on a non-ENOENT stat error', () => {
    if (process.getuid?.() === 0) return;
    const sub = join(home, 'locked');
    mkdirSync(sub);
    writeFileSync(join(sub, 'AGENTS.md'), 'x');
    chmodSync(sub, 0o000);
    try {
      expect(buildGlobalInstructionsBlock(sub)).toBe('');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('unreadable');
    } finally {
      chmodSync(sub, 0o755);
    }
  });

  it.skipIf(process.platform === 'win32')('skips a FIFO without blocking', () => {
    execFileSync('mkfifo', [join(home, 'AGENTS.md')]);
    const started = Date.now();
    expect(buildGlobalInstructionsBlock(home)).toBe('');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.getuid?.() === 0)('skips an unreadable file with a warning', () => {
    const file = join(home, 'AGENTS.md');
    writeFileSync(file, 'secret');
    chmodSync(file, 0o000);
    try {
      expect(buildGlobalInstructionsBlock(home)).toBe('');
      expect(String(warn.mock.calls[0][0])).toContain('unreadable');
    } finally {
      chmodSync(file, 0o644);
    }
  });

  it('skips a file larger than the brief byte limit', () => {
    writeFileSync(join(home, 'AGENTS.md'), 'a'.repeat(MAX_PROJECT_BRIEF_BYTES + 1));
    expect(buildGlobalInstructionsBlock(home)).toBe('');
    expect(String(warn.mock.calls[0][0])).toContain('file exceeds');
  });

  it('states that Cesar rules win on conflict', () => {
    writeFileSync(join(home, 'AGENTS.md'), 'x');
    expect(buildGlobalInstructionsBlock(home)).toContain('the Cesar rules win');
  });

  const contentOf = (block: string) => block.slice(block.indexOf('\n\n') + 2);
  const MAX = MAX_GLOBAL_INSTRUCTIONS_CHARS;

  it('truncates oversize content at a heading boundary within MAX', () => {
    const section = (n: number) => `# Section ${n}\n${'x'.repeat(990)}\n`;
    let body = '';
    for (let i = 0; body.length <= MAX + 2000; i++) body += section(i);
    writeFileSync(join(home, 'AGENTS.md'), body);
    const content = contentOf(buildGlobalInstructionsBlock(home));
    expect(content.length).toBeLessThanOrEqual(MAX);
    expect(content).toMatch(/\n\.\.\. \(truncated: showing \d+ of \d+ chars\)$/);
    const kept = Number(/showing (\d+) of/.exec(content)?.[1]);
    expect(body.slice(kept, kept + 2)).toBe('# ');
    expect(content).toContain(`of ${body.length} chars`);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores an early heading in favor of a newline cut', () => {
    const body = `# Early\n${('y'.repeat(99) + '\n').repeat(400)}`;
    writeFileSync(join(home, 'AGENTS.md'), body);
    const content = contentOf(buildGlobalInstructionsBlock(home));
    expect(content.length).toBeLessThanOrEqual(MAX);
    expect(content.startsWith('# Early')).toBe(true);
    expect(content.length).toBeGreaterThan(MAX / 2);
  });

  it('does not cut at a heading inside a code fence and closes an open fence', () => {
    const head = `# Top\n${('z'.repeat(99) + '\n').repeat(100)}`;
    const fenced = `\`\`\`\n${'# not a heading\n' + ('w'.repeat(99) + '\n').repeat(400)}`;
    writeFileSync(join(home, 'AGENTS.md'), head + fenced);
    const content = contentOf(buildGlobalInstructionsBlock(home));
    expect(content.length).toBeLessThanOrEqual(MAX);
    const kept = content.slice(0, content.lastIndexOf('\n... (truncated'));
    expect(kept.endsWith('\n```')).toBe(true);
    expect(kept).toContain('# not a heading');
  });

  it.each([
    ['~~~', '~~~'],
    ['````', '````'],
  ])('closes a truncated %s fence with a matching fence', (open, close) => {
    const head = `# Top\n${('z'.repeat(99) + '\n').repeat(100)}`;
    const fenced = `${open}\n\`\`\`\n${('w'.repeat(99) + '\n').repeat(400)}`;
    writeFileSync(join(home, 'AGENTS.md'), head + fenced);
    const content = contentOf(buildGlobalInstructionsBlock(home));
    expect(content.length).toBeLessThanOrEqual(MAX);
    const kept = content.slice(0, content.lastIndexOf('\n... (truncated'));
    expect(kept.endsWith(`\n${close}`)).toBe(true);
  });

  it('never leaves a lone surrogate when an emoji straddles the cut on a single line', () => {
    for (let offset = 0; offset < 80; offset++) {
      const body = 'a'.repeat(MAX - 120 + offset) + '😀'.repeat(200);
      writeFileSync(join(home, 'AGENTS.md'), body);
      const content = contentOf(buildGlobalInstructionsBlock(home));
      expect(content).toContain('... (truncated');
      expect(content.length).toBeLessThanOrEqual(MAX);
      expect(content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});
