import { describe, expect, it } from 'vitest';

import { CodeBlockBuffer } from '../../packages/cli/src/blocks/code-buffer.js';

// The buffer hands the user a REFERENCE ("/copy 2"), so the index it returns is
// part of the UI contract: 1-based, monotonic, and a working key for get().
// A 0-based (or length-1) numbering would print "/copy 0" — or "/copy -1" for
// the first block ever pushed — and get() would miss.
describe('CodeBlockBuffer indexing', () => {
  it('numbers blocks 1..N in push order', () => {
    const buf = new CodeBlockBuffer();

    const first = buf.push('ts', 'const a = 1;');
    const second = buf.push('py', 'a = 1');

    expect(first).toBe(1);
    expect(second).toBe(first + 1);
    expect(buf.blocks.map((b) => b.index)).toEqual([1, 2]);
  });

  it('returns an index that get() can resolve back to the same block', () => {
    const buf = new CodeBlockBuffer();

    const idx = buf.push('ts', 'const a = 1;');

    expect(idx).toBeGreaterThan(0);
    expect(buf.get(idx)).toEqual({ index: idx, language: 'ts', code: 'const a = 1;' });
    expect(buf.get(idx + 1)).toBeNull();
  });

  it('keeps numbering 1-based after a clear', () => {
    const buf = new CodeBlockBuffer();
    buf.push('ts', 'one');
    buf.push('ts', 'two');

    buf.clear();

    expect(buf.push('ts', 'three')).toBe(1);
  });

  it('records code segments through recordFromSegments with the same numbering', () => {
    const buf = new CodeBlockBuffer();

    buf.recordFromSegments([
      { type: 'text' },
      { type: 'code', language: 'ts', code: 'a' },
      { type: 'code', code: 'b' },
    ]);

    expect(buf.blocks.map((b) => b.index)).toEqual([1, 2]);
    expect(buf.get(2)?.code).toBe('b');
  });
});
