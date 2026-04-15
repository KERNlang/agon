import { describe, expect, it } from 'vitest';
import { parseMouseScrollChunk, stripBracketedPasteMarkers } from '../../packages/cli/src/input-utils.js';

describe('stripBracketedPasteMarkers', () => {
  it('removes ANSI bracketed paste markers', () => {
    expect(stripBracketedPasteMarkers('\x1b[200~const x = 1;\x1b[201~')).toBe('const x = 1;');
  });

  it('removes markers even when the leading escape was stripped', () => {
    expect(stripBracketedPasteMarkers('before[200~pasted\x1b[201~after')).toBe('beforepastedafter');
  });

  it('preserves tabs and newlines in pasted content', () => {
    expect(stripBracketedPasteMarkers('\x1b[200~\tif true:\n\t\tpass\x1b[201~')).toBe('\tif true:\n\t\tpass');
  });
});

describe('parseMouseScrollChunk', () => {
  it('parses complete wheel events from a single chunk', () => {
    expect(parseMouseScrollChunk('', '\x1b[<64;12;34M')).toEqual({
      nextBuffer: '',
      scrollUpEvents: 1,
      scrollDownEvents: 0,
    });
  });

  it('reassembles wheel events that arrive across multiple chunks', () => {
    const partial = parseMouseScrollChunk('', '\x1b[<65;12;3');
    expect(partial).toEqual({
      nextBuffer: '\x1b[<65;12;3',
      scrollUpEvents: 0,
      scrollDownEvents: 0,
    });

    expect(parseMouseScrollChunk(partial.nextBuffer, '4M')).toEqual({
      nextBuffer: '',
      scrollUpEvents: 0,
      scrollDownEvents: 1,
    });
  });
});
