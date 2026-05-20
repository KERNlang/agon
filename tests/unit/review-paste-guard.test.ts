import { describe, expect, it } from 'vitest';

import { isPastePlaceholderOnly } from '../../packages/cli/src/commands/review.js';

describe('review paste-placeholder guard', () => {
  it('flags a bare claude TUI paste placeholder', () => {
    expect(isPastePlaceholderOnly('[Pasted text #1 +34 lines]')).toBe(true);
  });

  it('flags a placeholder with only trivial trailing scaffolding', () => {
    expect(isPastePlaceholderOnly('[Pasted text #1 +34 lines]·PR#74')).toBe(true);
  });

  it('handles the no-index variant', () => {
    expect(isPastePlaceholderOnly('[Pasted text +12 lines]')).toBe(true);
  });

  it('flags a capture with MULTIPLE placeholder tokens (global strip)', () => {
    expect(isPastePlaceholderOnly('[Pasted text #1 +34 lines][Pasted text #2 +10 lines]')).toBe(true);
  });

  it('does NOT flag a real review that merely mentions a paste', () => {
    const realReview = [
      'The change in src/auth.ts looks good but the null guard on line 42 is missing.',
      'I also reviewed the [Pasted text +5 lines] block and found no issues.',
      '<!--AGON_REVIEW_FINDINGS_v1-->',
      '[{"file":"src/auth.ts","lines":"42","severity":"important","blocking":false}]',
    ].join('\n');
    expect(isPastePlaceholderOnly(realReview)).toBe(false);
  });

  it('does NOT flag ordinary review prose with no placeholder', () => {
    expect(isPastePlaceholderOnly('Looks good. No blocking issues found.')).toBe(false);
  });
});
