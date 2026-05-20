import { describe, it, expect } from 'vitest';
import { stripReasoning } from '../../packages/cli/src/generated/blocks/engine-helpers.js';

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
