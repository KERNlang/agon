import { describe, expect, it } from 'vitest';

import { formatConfidenceToolLabel } from '../../packages/cli/src/generated/blocks/output-format.js';

describe('formatConfidenceToolLabel', () => {
  it('formats parsed confidence without losing the raw value binding', () => {
    expect(formatConfidenceToolLabel({ value: 0.92, reasoning: 'verified' }, '')).toBe(
      '92% confidence · verified',
    );
  });

  it('falls back to confidence embedded in raw tool input', () => {
    expect(formatConfidenceToolLabel({}, '{"value":75}')).toBe('75% confidence');
  });
});
