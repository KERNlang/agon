import { describe, expect, it } from 'vitest';
import { BrainstormStorm, CampfireFire, ForgeArena, STORM_BOLTS, TribunalCourt } from '../../packages/cli/src/blocks/arena.js';

describe('ForgeArena progress', () => {
  it('clamps negative elapsed time instead of passing a negative count to repeat()', () => {
    expect(() => ForgeArena({
      engines: [{ id: 'codex', status: 'building', elapsed: -30, done: false, failed: false }],
    })).not.toThrow();
  });

  it('keeps animation frame indexes valid for negative elapsed time', () => {
    expect(() => CampfireFire({
      engines: [{ id: 'codex', status: 'thinking', elapsed: -1, done: false, failed: false }],
    })).not.toThrow();
    expect(() => CampfireFire({
      engines: [{ id: 'codex', status: 'thinking', elapsed: Number.NaN, done: false, failed: false }],
    })).not.toThrow();
  });

  it('renders a defensive empty tribunal status without throwing', () => {
    expect(() => TribunalCourt({
      engines: [{ id: 'codex', elapsed: 0, done: false, failed: false } as any],
    })).not.toThrow();
  });
});

// Every leaf string in a returned Ink element tree, in order.
function textNodes(node: any, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) textNodes(n, out); return out; }
  if (node && node.props) textNodes(node.props.children, out);
  return out;
}

// The storm animation indexes its frame table with a DOUBLE modulo — the
// classic ((x % n) + n) % n — because `elapsed` can be fractional, huge, or
// negative. Drop the wrap and the index goes negative, STORM_BOLTS[i] is
// undefined, and the top line of the brainstorm banner renders as nothing.
describe('BrainstormStorm frame index', () => {
  const storm = (elapsed: number) =>
    textNodes(BrainstormStorm({ engines: [{ id: 'codex', status: 'thinking', elapsed, done: false, failed: false } as any] }));

  it('picks a real frame for each elapsed second', () => {
    for (const elapsed of [0, 1, 2, 3]) {
      expect(storm(elapsed)).toContain(STORM_BOLTS[elapsed]);
    }
  });

  it('wraps past the end of the frame table', () => {
    expect(storm(5)).toContain(STORM_BOLTS[1]);
    expect(storm(4 * 10 + 2)).toContain(STORM_BOLTS[2]);
  });

  it('wraps negative and fractional elapsed onto a real frame', () => {
    expect(storm(-1)).toContain(STORM_BOLTS[STORM_BOLTS.length - 1]);
    expect(storm(2.7)).toContain(STORM_BOLTS[2]);
    expect(storm(Number.NaN).filter((t) => STORM_BOLTS.includes(t))).toHaveLength(1);
  });
});
