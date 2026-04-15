import { describe, expect, it } from 'vitest';

import {
  applyInlineInputEdits,
  classifyDeleteInput,
  deleteWordBackward,
  findLineEnd,
  findLineStart,
  findWordBoundaryLeft,
  findWordBoundaryRight,
  syncControlledInputCursor,
} from '../../packages/cli/src/safe-text-input.js';

describe('safe text input helpers', () => {
  it('classifies delete keys even when Ink emits an empty input string', () => {
    expect(classifyDeleteInput('', { delete: true })).toBe('backward');
    expect(classifyDeleteInput('', { backspace: true })).toBe('backward');
    expect(classifyDeleteInput('\x1b[3~', {})).toBe('forward');
  });

  it('applies buffered inline deletions inside a multi-character chunk', () => {
    expect(applyInlineInputEdits('', 0, 'abc\x7f')).toEqual({
      value: 'ab',
      cursorOffset: 2,
      cursorWidth: 3,
    });
  });

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

  it('keeps the cursor stable for internal echoes but snaps to end for external changes', () => {
    expect(
      syncControlledInputCursor(
        { cursorOffset: 3, cursorWidth: 1 },
        'abc',
        { focus: true, showCursor: true, lastCommittedValue: 'abc' },
      ),
    ).toEqual({
      cursorOffset: 3,
      cursorWidth: 0,
    });

    expect(
      syncControlledInputCursor(
        { cursorOffset: 3, cursorWidth: 0 },
        '/forge fix this',
        { focus: true, showCursor: true, lastCommittedValue: 'abc' },
      ),
    ).toEqual({
      cursorOffset: 15,
      cursorWidth: 0,
    });
  });
});
