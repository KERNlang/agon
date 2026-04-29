import { describe, expect, it } from 'vitest';

import { splitBracketedPasteInput, type BracketedPasteState } from '../../packages/cli/src/stable-input.js';

function consume(chunks: string[]) {
  let state: BracketedPasteState = { active: false, buffer: '' };
  const segments: Array<{ kind: 'keys' | 'paste'; value: string }> = [];
  for (const chunk of chunks) {
    const next = splitBracketedPasteInput(state, chunk);
    state = next.state;
    segments.push(...next.segments);
  }
  return { state, segments };
}

describe('stable input bracketed paste splitting', () => {
  it('emits pasted content without bracketed paste markers', () => {
    expect(consume(['\x1b[200~hello\nworld\x1b[201~'])).toEqual({
      state: { active: false, buffer: '' },
      segments: [{ kind: 'paste', value: 'hello\nworld' }],
    });
  });

  it('does not leak split paste markers into the composer', () => {
    expect(consume(['\x1b[200~', 'first\n', 'second', '\x1b[201~'])).toEqual({
      state: { active: false, buffer: '' },
      segments: [{ kind: 'paste', value: 'first\nsecond' }],
    });
  });

  it('resumes normal key handling after a paste in the same chunk', () => {
    expect(consume(['a\x1b[200~paste\x1b[201~b'])).toEqual({
      state: { active: false, buffer: '' },
      segments: [
        { kind: 'keys', value: 'a' },
        { kind: 'paste', value: 'paste' },
        { kind: 'keys', value: 'b' },
      ],
    });
  });
});
