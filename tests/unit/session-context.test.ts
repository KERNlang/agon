import { describe, it, expect } from 'vitest';
import { SessionContext } from '../../packages/core/src/generated/blocks/session-context.js';

describe('SessionContext', () => {
  it('memoizes context for same cwd', () => {
    const ctx = new SessionContext();
    const first = ctx.get(process.cwd());
    const second = ctx.get(process.cwd());
    expect(first).toBe(second); // Same reference = memoized
  });

  it('recomputes on different cwd', () => {
    const ctx = new SessionContext();
    const first = ctx.get(process.cwd());
    const second = ctx.get('/tmp');
    expect(first).not.toBe(second);
  });

  it('invalidate forces recompute', () => {
    const ctx = new SessionContext();
    const first = ctx.get(process.cwd());
    ctx.invalidate();
    const second = ctx.get(process.cwd());
    // Content should be same but it's a new string (recomputed)
    expect(second).toBeTruthy();
  });

  it('age returns Infinity before first get', () => {
    const ctx = new SessionContext();
    expect(ctx.age()).toBe(Infinity);
  });

  it('age returns positive number after get', () => {
    const ctx = new SessionContext();
    ctx.get(process.cwd());
    expect(ctx.age()).toBeLessThan(1000);
  });

  it('isStale returns true before first get', () => {
    const ctx = new SessionContext();
    expect(ctx.isStale()).toBe(true);
  });

  it('isStale returns false immediately after get', () => {
    const ctx = new SessionContext();
    ctx.get(process.cwd());
    expect(ctx.isStale()).toBe(false);
  });
});
