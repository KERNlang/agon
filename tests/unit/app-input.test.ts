import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanInputValue, cleanSubmitValue, findInputChange } from '../../packages/cli/src/generated/app-input.js';
import { processPasteContent } from '../../packages/cli/src/generated/paste-handler.js';
import { pasteStore } from '@agon/core';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('app input helpers', () => {
  it('preserves pasted tabs and newlines while stripping bracketed paste markers', () => {
    expect(cleanInputValue('\x1b[200~\tif true:\n\t\tpass\x1b[201~')).toBe('\tif true:\n\t\tpass');
  });

  it('strips bracketed paste markers before submission and trims outer whitespace', () => {
    expect(cleanSubmitValue('\x1b[200~  hello world  \x1b[201~')).toBe('hello world');
  });

  it('finds the inserted segment for a paste in the middle of the input', () => {
    expect(findInputChange('hello world', 'hello brave new world')).toEqual({
      start: 6,
      removed: '',
      inserted: 'brave new ',
    });
  });
});

describe('processPasteContent', () => {
  it('preserves direct pasted formatting', () => {
    expect(processPasteContent('\tline1\n\tline2\n')).toEqual({
      type: 'direct',
      content: '\tline1\n\tline2\n',
    });
  });

  it('stores very long pastes instead of inlining them', () => {
    vi.spyOn(pasteStore, 'store').mockReturnValue({
      hash: '0123456789abcdef',
      preview: 'x',
      lineCount: 1,
    });
    const longLine = 'x'.repeat(501);
    expect(processPasteContent(longLine, 2)).toMatchObject({
      type: 'stored',
      placeholder: '[Pasted text #2 +1 lines]',
    });
  });
});
