import { describe, expect, it } from 'vitest';

import { DiffLine } from '../../packages/cli/src/blocks/rendering.js';

// DiffLine is a hook-free React.memo leaf: invoking it as a plain function
// yields the <Text> element whose color IS the behavior under test.
const colorOf = (line: string, maxWidth = 80): string | undefined =>
  ((DiffLine as any).type({ line, maxWidth }) as any).props.color;

// Green means "this line is being ADDED", red means "removed". Swapping the
// two — or letting the additions fall through to the plain branch — makes a
// patch preview lie about what a review is about to apply.
describe('DiffLine coloring', () => {
  it('paints added lines green and removed lines red', () => {
    expect(colorOf('+  const added = 1;')).toBe('#22c55e');
    expect(colorOf('-  const removed = 1;')).toBe('#ef4444');
    expect(colorOf('+')).toBe('#22c55e');
    expect(colorOf('-')).toBe('#ef4444');
  });

  it('paints hunk headers cyan', () => {
    expect(colorOf('@@ -1,4 +1,6 @@')).toBe('#22d3ee');
  });

  it('leaves context lines uncolored', () => {
    expect(colorOf('   const untouched = 1;')).toBeUndefined();
    expect(colorOf('')).toBeUndefined();
  });

  it('still truncates the line it colors', () => {
    const el = (DiffLine as any).type({ line: `+${'x'.repeat(200)}`, maxWidth: 20 }) as any;

    expect(el.props.color).toBe('#22c55e');
    expect(String(el.props.children).length).toBeLessThan(50);
  });
});
