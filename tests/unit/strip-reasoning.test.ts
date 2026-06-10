import { describe, it, expect } from 'vitest';
import { stripReasoning, stripTuiChrome, formatDuration } from '../../packages/cli/src/generated/blocks/engine-helpers.js';

describe('formatDuration', () => {
  it('renders sub-second durations as milliseconds', () => {
    expect(formatDuration(420)).toBe('420ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('renders one-decimal seconds for 1s..<60s', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1400)).toBe('1.4s');
    expect(formatDuration(59_900)).toBe('59.9s');
  });

  it('renders minutes + whole seconds at >=60s', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(72_000)).toBe('1m 12s');
    expect(formatDuration(3_661_000)).toBe('61m 1s');
  });

  it('clamps negative/NaN to 0ms', () => {
    expect(formatDuration(-5)).toBe('0ms');
    expect(formatDuration(Number.NaN)).toBe('0ms');
  });
});

describe('stripReasoning', () => {
  it('removes a leaked <think> block (MiniMax)', () => {
    const out = stripReasoning('<think>Let me reason about this...</think>The real answer.');
    expect(out).toBe('The real answer.');
  });

  it('removes <thinking> and <reasoning> variants', () => {
    expect(stripReasoning('<thinking>x</thinking>A')).toBe('A');
    expect(stripReasoning('<reasoning>y</reasoning>B')).toBe('B');
  });

  it('is case-insensitive and handles multiline reasoning', () => {
    const out = stripReasoning('<THINK>\nline1\nline2\n</THINK>\n\nFinal.');
    expect(out).toBe('Final.');
  });

  it('strips multiple think blocks', () => {
    expect(stripReasoning('<think>a</think>one <think>b</think>two')).toBe('one two');
  });

  it('does not require a backreference mismatch to strip (think/think)', () => {
    // A <think> opened and </reasoning> closed should NOT be treated as a block
    // (mismatched tags) — left intact rather than greedily eating content.
    const mismatched = '<think>keep me</reasoning>answer';
    expect(stripReasoning(mismatched)).toBe(mismatched);
  });

  it('leaves ordinary review prose untouched', () => {
    const prose = 'The divide function lacks a zero guard. <!--AGON_REVIEW_FINDINGS_v1-->\n[]';
    expect(stripReasoning(prose)).toBe(prose);
  });
});

describe('stripTuiChrome', () => {
  it('cleans claude TUI spinner soup down to the real review (real-capture sample)', () => {
    const soup = '·✢✳✶✻✽✳✶✻✽✳✢·✻✶✳✢·This one needs a moment…✶✳✢·✽✳✢·✻✽✳✶✻✽✢Working through it…✶✻✶✳✢·8✻✶✳✢9·✽✻ 20✶✳✢·✻✽✢ 4Untangling some thoughts…✳✢· 5✢·7Weighing a few approaches…95%87 9125✻ 6✶ 89✳ 20✢ 1Review: This is a clean lift-and-shift.';
    const out = stripTuiChrome(soup);
    expect(out).toBe('Review: This is a clean lift-and-shift.');
  });

  it('strips inline ❯ prompt chars', () => {
    expect(stripTuiChrome('Findings ❯- File: a.ts ❯- problem')).toBe('Findings - File: a.ts - problem');
  });

  it('does NOT touch API-engine output (no glyphs → no label/counter stripping)', () => {
    // gemini/kimi/zai never emit spinner glyphs; a finding that legitimately
    // ends a phrase in … or starts with a number must survive intact.
    const apiReview = 'Consider edge cases…\n42 files changed. Looks fine.';
    expect(stripTuiChrome(apiReview)).toBe(apiReview);
  });

  it('is a no-op for clean text', () => {
    expect(stripTuiChrome('No blocking issues found.')).toBe('No blocking issues found.');
  });
});
