import { describe, expect, it, vi } from 'vitest';

import { estimateBrainTokens } from '../../packages/cli/src/cesar/context-budget.js';
import type { SessionBudget } from '@kernlang/agon-core';

const budget: SessionBudget = { contextWindow: 200_000, estimator: 'message-history', charsPerToken: 4 };

// A tiny history on purpose: the chars/message estimate for it is orders of
// magnitude below the live anchor, so "which source did we use?" is decidable
// from the returned number alone.
const TINY_HISTORY = [{ role: 'user', content: 'hi' }];

function apiSession(live: { tokens: number; source: string } | null) {
  return {
    getContextUsage: vi.fn(() => live),
    getMessageHistory: vi.fn(() => TINY_HISTORY),
  } as any;
}

// The API brain has a REAL usage anchor (exact token counts returned by the
// last API response). Preferring it is the whole point of the branch: falling
// back to the chars estimate under-reports the window by a wide margin, which
// is what makes the context gauge lie and compaction fire too late.
describe('estimateBrainTokens — API live-usage anchor', () => {
  it('uses the session usage anchor for the API backend', () => {
    const session = apiSession({ tokens: 120_000, source: 'api' });

    const tokens = estimateBrainTokens({} as any, session, 'api', budget, '');

    expect(session.getContextUsage).toHaveBeenCalled();
    expect(tokens).toBe(120_000);
    expect(session.getMessageHistory).not.toHaveBeenCalled();
  });

  it('adds the pending user turn on top of the anchor', () => {
    const session = apiSession({ tokens: 120_000, source: 'api' });

    const withPending = estimateBrainTokens({} as any, session, 'api', budget, 'x'.repeat(4000));

    expect(withPending).toBeGreaterThan(120_000);
  });

  it('falls back to the message history when the anchor is only an estimate', () => {
    const session = apiSession({ tokens: 120_000, source: 'estimate' });

    const tokens = estimateBrainTokens({} as any, session, 'api', budget, '');

    expect(session.getMessageHistory).toHaveBeenCalled();
    expect(tokens).toBeLessThan(1_000);
  });

  it('never consults the API anchor for a non-API backend', () => {
    const session = apiSession({ tokens: 120_000, source: 'api' });

    const tokens = estimateBrainTokens({} as any, session, 'pty', budget, '');

    expect(session.getContextUsage).not.toHaveBeenCalled();
    expect(tokens).not.toBe(120_000);
    expect(tokens).toBeGreaterThan(0);
  });
});
