import { describe, expect, it } from 'vitest';
import { CampfireFire, ForgeArena, TribunalCourt } from '../../packages/cli/src/generated/blocks/arena.js';

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
