import { describe, expect, it } from 'vitest';

// Source of truth: packages/cli/src/kern/cesar/brain-helpers.kern
import { forwardContinuationStatus } from '../../packages/cli/src/generated/cesar/brain-helpers.js';

describe('forwardContinuationStatus — continuation sends are not a black box', () => {
  it('forwards a plain status chunk as a spinner update (live activity)', () => {
    const events: any[] = [];
    const consumed = forwardContinuationStatus(
      { type: 'status', content: 'executing Read…' },
      (e: any) => events.push(e),
    );
    expect(consumed).toBe(true);
    expect(events).toEqual([{ type: 'spinner-update', message: 'Cesar executing Read…' }]);
  });

  it('forwards a context-usage status as the live gauge event', () => {
    const events: any[] = [];
    const consumed = forwardContinuationStatus(
      { type: 'status', content: '', metadata: { kind: 'context-usage', pct: 21, used: 42000, limit: 200000, compacted: 1, cached: 30000, source: 'api' } },
      (e: any) => events.push(e),
    );
    expect(consumed).toBe(true);
    expect(events).toEqual([{
      type: 'context-usage', pct: 21, used: 42000, limit: 200000, compacted: 1, cached: 30000, source: 'api',
    }]);
  });

  it('leaves non-status chunks to the caller untouched', () => {
    const events: any[] = [];
    for (const chunk of [{ type: 'text', content: 'hi' }, { type: 'done' }, { type: 'error', content: 'x' }, null]) {
      expect(forwardContinuationStatus(chunk, (e: any) => events.push(e))).toBe(false);
    }
    expect(events).toEqual([]);
  });
});
