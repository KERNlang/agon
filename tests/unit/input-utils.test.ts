import { describe, expect, it } from 'vitest';
import { stripBracketedPasteMarkers } from '../../packages/cli/src/input-utils.js';

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
