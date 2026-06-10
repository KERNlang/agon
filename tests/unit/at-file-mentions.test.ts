import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stripMentionTrailingPunct,
  extractFileMentions,
  parseActiveAtMention,
  fuzzyFileScore,
  rankFileMatches,
} from '../../packages/cli/src/generated/signals/app-input.js';
import {
  buildMentionedFilesContext,
  MENTION_MAX_FILE_BYTES,
  MENTION_MAX_TOTAL_BYTES,
  MENTION_MAX_FILES,
} from '../../packages/cli/src/generated/surfaces/app-submit.js';

// Pins the @-file-mention contract (Claude-Code-style composer mentions):
//  1. extraction is email-safe and punctuation-aware,
//  2. the active-mention parser drives the inline picker,
//  3. fuzzy ranking is a stable subsequence scorer,
//  4. submit-time attachment reads real files, is path-confined, and respects
//     per-file / total / count caps.
// All four are pure helpers — no ink render harness.

describe('stripMentionTrailingPunct', () => {
  it('trims sentence/clause punctuation from the end of a path', () => {
    expect(stripMentionTrailingPunct('a.ts.')).toBe('a.ts');
    expect(stripMentionTrailingPunct('a.ts,')).toBe('a.ts');
    expect(stripMentionTrailingPunct('src/foo.ts);')).toBe('src/foo.ts');
  });
  it('leaves a clean path untouched', () => {
    expect(stripMentionTrailingPunct('src/foo.ts')).toBe('src/foo.ts');
  });
  it('does not strip interior dots (extensions)', () => {
    expect(stripMentionTrailingPunct('a.b.ts')).toBe('a.b.ts');
  });
});

describe('extractFileMentions', () => {
  it('extracts a single mention', () => {
    expect(extractFileMentions('look at @src/foo.ts please')).toEqual(['src/foo.ts']);
  });
  it('extracts multiple mentions in first-seen order, de-duplicated', () => {
    expect(extractFileMentions('@a.ts then @b/c.ts and @a.ts again')).toEqual(['a.ts', 'b/c.ts']);
  });
  it('matches a mention at the very start of the input', () => {
    expect(extractFileMentions('@README.md')).toEqual(['README.md']);
  });
  it('trims trailing prose punctuation', () => {
    expect(extractFileMentions('see @a.ts, and @b.ts.')).toEqual(['a.ts', 'b.ts']);
  });
  it('does NOT treat an email local-part @ as a mention', () => {
    expect(extractFileMentions('email me at user@host.com')).toEqual([]);
    expect(extractFileMentions('dev@company.com shipped it')).toEqual([]);
  });
  it('rejects fragments containing another @ (not a path)', () => {
    // "@a@b" -> raw token "a@b" contains '@', so it is dropped.
    expect(extractFileMentions('@a@b')).toEqual([]);
  });
  it('returns [] when there are no mentions', () => {
    expect(extractFileMentions('plain text with no at signs')).toEqual([]);
  });
  it('handles a mention after a newline boundary', () => {
    expect(extractFileMentions('line one\n@src/x.ts')).toEqual(['src/x.ts']);
  });
});

describe('parseActiveAtMention', () => {
  it('returns an empty query right after typing "@" at a boundary', () => {
    expect(parseActiveAtMention('hello @')).toEqual({ query: '' });
    expect(parseActiveAtMention('@')).toEqual({ query: '' });
  });
  it('returns the text typed after the active "@"', () => {
    expect(parseActiveAtMention('open @src/fo')).toEqual({ query: 'src/fo' });
  });
  it('returns null when the last "@" is not a boundary (email)', () => {
    expect(parseActiveAtMention('user@host')).toBeNull();
  });
  it('returns null once whitespace follows the "@" (mention finished)', () => {
    expect(parseActiveAtMention('@src/foo.ts and more')).toBeNull();
  });
  it('returns null when there is no "@" at all', () => {
    expect(parseActiveAtMention('plain text')).toBeNull();
  });
  it('tracks the LAST "@" when several are present', () => {
    expect(parseActiveAtMention('@done.ts now @next')).toEqual({ query: 'next' });
  });
});

describe('fuzzyFileScore', () => {
  it('returns 0 for an empty query (all candidates equal)', () => {
    expect(fuzzyFileScore('', 'anything.ts')).toBe(0);
  });
  it('returns -1 when the query is not a subsequence', () => {
    expect(fuzzyFileScore('xyz', 'src/foo.ts')).toBe(-1);
  });
  it('scores a contiguous substring higher than a scattered subsequence', () => {
    const contiguous = fuzzyFileScore('foo', 'src/foo.ts');
    const scattered = fuzzyFileScore('foo', 'f_o_o.ts');
    expect(contiguous).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThanOrEqual(0);
  });
  it('prefers a basename hit over a directory hit for the same query', () => {
    const basename = fuzzyFileScore('app', 'src/app.ts');
    const dirOnly = fuzzyFileScore('app', 'app/deep/nested/other.ts');
    expect(basename).toBeGreaterThan(dirOnly);
  });
  it('is case-insensitive', () => {
    expect(fuzzyFileScore('FOO', 'src/foo.ts')).toBeGreaterThanOrEqual(0);
  });
});

describe('rankFileMatches', () => {
  const files = [
    'src/app.ts',
    'src/app-input.ts',
    'src/blocks/composer.tsx',
    'tests/app.test.ts',
    'README.md',
  ];
  it('returns first N files in source order for an empty query', () => {
    expect(rankFileMatches('', files, 2)).toEqual(['src/app.ts', 'src/app-input.ts']);
  });
  it('drops non-matches and ranks by score', () => {
    const ranked = rankFileMatches('app', files);
    expect(ranked).toContain('src/app.ts');
    expect(ranked).toContain('src/app-input.ts');
    expect(ranked).not.toContain('README.md');
  });
  it('breaks ties on shorter path then lexicographically (deterministic)', () => {
    const ranked = rankFileMatches('app', ['src/app-input.ts', 'src/app.ts']);
    // Both contiguous basename hits; 'src/app.ts' is shorter -> ranks first.
    expect(ranked[0]).toBe('src/app.ts');
  });
  it('respects the limit cap', () => {
    expect(rankFileMatches('', files, 1)).toHaveLength(1);
  });
});

describe('buildMentionedFilesContext', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agon-mention-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns "" when there are no mentions', () => {
    expect(buildMentionedFilesContext('plain message', dir)).toBe('');
  });

  it('attaches the content of an existing mentioned file', () => {
    writeFileSync(join(dir, 'hello.ts'), 'export const x = 1;\n');
    const out = buildMentionedFilesContext('please read @hello.ts', dir);
    expect(out).toContain('@hello.ts');
    expect(out).toContain('export const x = 1;');
    expect(out).toContain('[Attached files referenced with @ in the message above]');
  });

  it('skips a non-existent path (mention stays plain text)', () => {
    expect(buildMentionedFilesContext('read @nope.ts', dir)).toBe('');
  });

  it('skips a directory mention (not a file)', () => {
    mkdirSync(join(dir, 'sub'));
    expect(buildMentionedFilesContext('read @sub', dir)).toBe('');
  });

  it('does NOT attach for an email-like @ token', () => {
    writeFileSync(join(dir, 'host.com'), 'secret');
    expect(buildMentionedFilesContext('mail me at user@host.com', dir)).toBe('');
  });

  it('refuses an absolute path (path confinement)', () => {
    const abs = join(dir, 'secret.txt');
    writeFileSync(abs, 'top secret');
    expect(buildMentionedFilesContext(`leak @${abs}`, dir)).toBe('');
  });

  it('refuses a path escaping the project root via ../', () => {
    const outside = mkdtempSync(join(tmpdir(), 'agon-outside-'));
    try {
      writeFileSync(join(outside, 'escape.txt'), 'outside');
      // Reference the outside file relative to dir.
      const rel = join('..', outside.split('/').pop()!, 'escape.txt');
      expect(buildMentionedFilesContext(`read @${rel}`, dir)).toBe('');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('truncates a file larger than the per-file cap with an explicit marker', () => {
    const big = 'a'.repeat(MENTION_MAX_FILE_BYTES + 5000);
    writeFileSync(join(dir, 'big.txt'), big);
    const out = buildMentionedFilesContext('read @big.txt', dir);
    expect(out).toContain('truncated to');
    // The attached body never exceeds the per-file cap.
    expect(out.length).toBeLessThan(MENTION_MAX_FILE_BYTES + 2000);
  });

  it('stops attaching once the total byte cap is exceeded', () => {
    // Each file is just under the per-file cap; a handful blows the total cap.
    const chunk = 'b'.repeat(MENTION_MAX_FILE_BYTES - 1);
    const names: string[] = [];
    const count = Math.ceil(MENTION_MAX_TOTAL_BYTES / MENTION_MAX_FILE_BYTES) + 3;
    for (let i = 0; i < count; i++) {
      const name = `f${i}.txt`;
      writeFileSync(join(dir, name), chunk);
      names.push(name);
    }
    const text = names.map((n) => `@${n}`).join(' ');
    const out = buildMentionedFilesContext(text, dir);
    // Total injected content is bounded by the total cap (plus block framing).
    expect(out.length).toBeLessThan(MENTION_MAX_TOTAL_BYTES + 4000);
    // Not every file made it in.
    const attached = (out.match(/truncated|@f\d+\.txt/g) ?? []).length;
    expect(attached).toBeLessThan(count);
  });

  it('honors the max file count cap', () => {
    for (let i = 0; i < MENTION_MAX_FILES + 5; i++) {
      writeFileSync(join(dir, `g${i}.txt`), 'x');
    }
    const text = Array.from({ length: MENTION_MAX_FILES + 5 }, (_, i) => `@g${i}.txt`).join(' ');
    const out = buildMentionedFilesContext(text, dir);
    const blocks = (out.match(/@g\d+\.txt/g) ?? []).length;
    expect(blocks).toBeLessThanOrEqual(MENTION_MAX_FILES);
  });
});
