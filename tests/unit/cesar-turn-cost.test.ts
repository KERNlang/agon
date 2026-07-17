import { describe, expect, it } from 'vitest';

// Source of truth: packages/cli/src/kern/cesar/brain-helpers.kern +
// packages/core/src/kern/signals/token-tracker.kern
import { recordCesarTurn } from '../../packages/cli/src/generated/cesar/brain-helpers.js';
import { estimateCost, estimateCostCacheAware } from '../../packages/core/src/generated/signals/token-tracker.js';

function ctxWithTurnUsage(usage: Record<string, unknown> | null) {
  return { cesarSession: { getTurnUsage: () => usage } } as any;
}

describe('recordCesarTurn — cached prompt tokens reach the cost model', () => {
  it('forwards cachedInputTokens from getTurnUsage so cache reads are NOT priced as full input', () => {
    // 950k prompt of which 900k cached + 50k completion (metered engine).
    const recorded = recordCesarTurn(
      ctxWithTurnUsage({ promptTokens: 950_000, completionTokens: 50_000, totalTokens: 1_000_000, cachedInputTokens: 900_000, source: 'sdk' }),
      'claude',
      'input',
      'response',
    );
    const cacheAware = estimateCostCacheAware('claude', 950_000, 50_000, 900_000);
    const fullPrice = estimateCost('claude', 1_000_000);
    expect(recorded.costUsd).toBeCloseTo(cacheAware, 8);
    // The regression this pins: dropping cachedInputTokens silently billed
    // the full uncached rate for the whole prompt.
    expect(recorded.costUsd).toBeLessThan(fullPrice);
  });

  it('still records uncached sdk usage when no cachedInputTokens are reported', () => {
    const recorded = recordCesarTurn(
      ctxWithTurnUsage({ promptTokens: 100_000, completionTokens: 10_000, totalTokens: 110_000, source: 'sdk' }),
      'claude',
      'input',
      'response',
    );
    expect(recorded.totalTokens).toBe(110_000);
    expect(recorded.source).toBe('sdk');
  });
});
