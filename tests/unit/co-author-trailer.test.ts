import { describe, expect, it } from 'vitest';

import { coAuthorTrailer } from '../../packages/core/src/git.js';

describe('coAuthorTrailer', () => {
  it('returns empty string when commitCoAuthor is unset', () => {
    expect(coAuthorTrailer({})).toBe('');
  });

  it('returns empty string when commitCoAuthor is blank/whitespace', () => {
    expect(coAuthorTrailer({ commitCoAuthor: '' })).toBe('');
    expect(coAuthorTrailer({ commitCoAuthor: '   ' })).toBe('');
  });

  it('returns a leading-blank-line Co-Authored-By paragraph when set', () => {
    const id = 'Cesar (agon) <12345+cesar-agon@users.noreply.github.com>';
    expect(coAuthorTrailer({ commitCoAuthor: id })).toBe(`\n\nCo-Authored-By: ${id}`);
  });

  it('trims surrounding whitespace from the configured value', () => {
    expect(coAuthorTrailer({ commitCoAuthor: '  Cesar <x@y.z>  ' })).toBe('\n\nCo-Authored-By: Cesar <x@y.z>');
  });
});
