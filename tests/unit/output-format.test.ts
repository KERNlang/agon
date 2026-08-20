import { describe, expect, it } from 'vitest';

import { formatConfidenceToolLabel, gradientText } from '../../packages/cli/src/blocks/output-format.js';

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

// The gradient walks a color ramp across a string. `step` is floor(len/colors),
// so the tail characters index PAST the ramp — the clamp to the last color is
// the only thing keeping `fg256(undefined, …)` (a literal "38;5;undefined"
// escape) out of the rendered banner.
describe('gradientText', () => {
  const ramp = [196, 202];

  it('clamps the tail to the last ramp color instead of running off the end', () => {
    // 5 chars over a 2-color ramp -> step 2 -> the last char asks for index 2.
    const out = gradientText('abcde', ramp);

    expect(out).not.toContain('undefined');
    expect(out).not.toContain('NaN');
    const used = [...out.matchAll(/\x1b\[38;5;(\d+)m/g)].map((m) => Number(m[1]));
    expect(used).toHaveLength(5);
    expect(new Set(used)).toEqual(new Set(ramp));
    expect(used[used.length - 1]).toBe(ramp[ramp.length - 1]);
  });

  it('keeps every character of the original text', () => {
    const out = gradientText('agon', ramp);

    expect(out.replace(/\x1b\[[0-9;]*m/g, '')).toBe('agon');
  });

  it('paints a single-color ramp entirely in that color', () => {
    const used = [...gradientText('abc', [51]).matchAll(/\x1b\[38;5;(\d+)m/g)].map((m) => Number(m[1]));

    expect(used).toEqual([51, 51, 51]);
  });
});
