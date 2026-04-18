import { describe, expect, it } from 'vitest';
import {
  isTerminalFocusReport,
  parseMouseChunk,
  parseMouseScrollChunk,
  stripBracketedPasteMarkers,
  stripTerminalInputMarkers,
} from '../../packages/cli/src/input-utils.js';

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

describe('terminal control markers', () => {
  it('strips focus and paste markers before input handling', () => {
    expect(stripTerminalInputMarkers('\x1b[I\x1b[200~hello\x1b[201~\x1b[O')).toBe('hello');
  });

  it('detects terminal focus reports', () => {
    expect(isTerminalFocusReport('\x1b[I')).toBe(true);
    expect(isTerminalFocusReport('[O')).toBe(true);
    expect(isTerminalFocusReport('hello')).toBe(false);
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

  it('counts wheel events even when xterm modifier bits are present', () => {
    expect(parseMouseScrollChunk('', '\x1b[<68;12;34M\x1b[<69;12;35M')).toEqual({
      nextBuffer: '',
      scrollUpEvents: 1,
      scrollDownEvents: 1,
    });
  });
});

describe('parseMouseChunk', () => {
  it('parses left-button drag gestures alongside wheel packets', () => {
    expect(
      parseMouseChunk(
        '',
        '\x1b[<0;10;7M\x1b[<32;10;8M\x1b[<32;10;9M\x1b[<0;10;9m\x1b[<64;10;10M',
      ),
    ).toEqual({
      nextBuffer: '',
      scrollUpEvents: 1,
      scrollDownEvents: 0,
      pointerEvents: [
        { kind: 'down', button: 'left', x: 10, y: 7 },
        { kind: 'drag', button: 'left', x: 10, y: 8 },
        { kind: 'drag', button: 'left', x: 10, y: 9 },
        { kind: 'up', button: 'left', x: 10, y: 9 },
      ],
    });
  });
});
