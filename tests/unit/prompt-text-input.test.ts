import { describe, expect, it } from 'vitest';

import { isDelegatedCtrlShortcut } from '../../packages/cli/src/generated/blocks/prompt-input.js';

describe('prompt text input helpers', () => {
  it('delegates ctrl+g so the composer can toggle the live rail', () => {
    expect(isDelegatedCtrlShortcut('g')).toBe(true);
  });
});
