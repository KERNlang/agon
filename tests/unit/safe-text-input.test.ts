import { describe, expect, it } from 'vitest';

import {
  deleteWordBackward,
  findLineEnd,
  findLineStart,
  findWordBoundaryLeft,
  findWordBoundaryRight,
} from '../../packages/cli/src/safe-text-input.js';

describe('safe text input helpers', () => {
  it('moves to the previous word boundary', () => {
    expect(findWordBoundaryLeft('hello brave new world', 15)).toBe(12);
    expect(findWordBoundaryLeft('hello, brave', 7)).toBe(5);
    expect(findWordBoundaryLeft('src/kern/surfaces/app.kern', 26)).toBe(22);
  });

  it('moves to the next word boundary', () => {
    expect(findWordBoundaryRight('hello brave new world', 6)).toBe(11);
    expect(findWordBoundaryRight('hello, brave', 5)).toBe(6);
    expect(findWordBoundaryRight('src/kern/surfaces/app.kern', 3)).toBe(4);
  });

  it('deletes the previous word and keeps the cursor aligned', () => {
    expect(deleteWordBackward('hello brave new world', 11)).toEqual({
      value: 'hello new world',
      cursorOffset: 6,
    });
  });

  it('respects line-local home/end positions in multiline input', () => {
    const value = 'first line\nsecond line\nthird';
    expect(findLineStart(value, 18)).toBe(11);
    expect(findLineEnd(value, 18)).toBe(22);
  });
});
