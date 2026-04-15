import { describe, expect, it } from 'vitest';

import {
  locatePromptCursor,
  selectPromptViewport,
  wrapPromptText,
} from '../../packages/cli/src/generated/blocks/prompt-input.js';

describe('prompt text input helpers', () => {
  it('wraps long input into visual lines', () => {
    expect(wrapPromptText('abcdefgh', 4)).toEqual(['abcd', 'efgh']);
    expect(wrapPromptText('ab\ncdef', 3)).toEqual(['ab', 'cde', 'f']);
  });

  it('tracks cursor position across wrapped lines and newline boundaries', () => {
    expect(locatePromptCursor('abcde', 4, 4)).toEqual({
      line: 1,
      column: 0,
      synthetic: false,
    });

    expect(locatePromptCursor('ab\ncd', 4, 2)).toEqual({
      line: 0,
      column: 2,
      synthetic: true,
    });
  });

  it('centers the viewport around the active visual line', () => {
    expect(selectPromptViewport(8, 5, 3)).toEqual({
      start: 4,
      end: 7,
      hiddenAbove: 4,
      hiddenBelow: 1,
    });

    expect(selectPromptViewport(2, 1, 4)).toEqual({
      start: 0,
      end: 2,
      hiddenAbove: 0,
      hiddenBelow: 0,
    });
  });
});
