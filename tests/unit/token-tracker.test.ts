import { describe, it, expect, beforeEach } from 'vitest';
import { tracker, estimateTokens, estimateCost, estimateCostCacheAware, isFlatRateEngine } from '../../packages/core/src/generated/signals/token-tracker.js';
import type { TokenUsage } from '../../packages/core/src/generated/signals/token-tracker.js';

describe('TokenTracker', () => {
  beforeEach(() => {
    tracker.reset();
  });

  it('estimateTokens uses 4-char rule', () => {
    expect(estimateTokens('hello world!')).toBe(3);
  });

  it('record with text estimates tokens and marks source as estimated', () => {
    const usage = tracker.record('claude', { prompt: 'hello', response: 'world' });
    expect(usage.source).toBe('estimated');
    expect(usage.promptTokens).toBe(2);
    expect(usage.responseTokens).toBe(2);
  });

  it('record with real usage uses exact numbers and marks source', () => {
    const usage = tracker.record('claude', {
      usage: { promptTokens: 150, completionTokens: 80, totalTokens: 230, source: 'sdk' },
    });
    expect(usage.source).toBe('sdk');
    expect(usage.promptTokens).toBe(150);
    expect(usage.responseTokens).toBe(80);
    expect(usage.totalTokens).toBe(230);
  });

  it('record with model uses model-specific pricing', () => {
    const usage = tracker.record('claude', {
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, source: 'sdk' },
      model: 'claude-haiku-4-5',
    });
    expect(usage.costUsd).toBeLessThan(estimateCost('claude', 1500));
    expect(usage.model).toBe('claude-haiku-4-5');
  });

  it('getStats aggregates across mixed source types', () => {
    tracker.record('claude', { prompt: 'aaa', response: 'bbb' });
    tracker.record('codex', {
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, source: 'sdk' },
    });
    const stats = tracker.getStats();
    expect(stats.dispatches).toBe(2);
    expect(stats.byEngine['claude']).toBeDefined();
    expect(stats.byEngine['codex']).toBeDefined();
    expect(stats.byEngine['codex'].promptTokens).toBe(100);
  });

  it('getStats splits metered (sdk) cost from unmetered (cli/estimated) recordings', () => {
    tracker.record('claude', { prompt: 'aaa', response: 'bbb' }); // estimated → unmetered
    const sdk = tracker.record('codex', {
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, source: 'sdk' },
    });
    tracker.record('claude', {
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, source: 'cli-reported' },
    }); // cli-reported → real tokens, but still not metered billing
    const stats = tracker.getStats();
    expect(stats.meteredDispatches).toBe(1);
    expect(stats.unmeteredDispatches).toBe(2);
    expect(stats.meteredCostUsd).toBeCloseTo(sdk.costUsd, 10);
    expect(stats.totalCostUsd).toBeGreaterThan(stats.meteredCostUsd);
  });

  it('getStats reports zero metered cost for a CLI-only session (cost not countable)', () => {
    tracker.record('claude', { prompt: 'long prompt text here', response: 'a long response' });
    const stats = tracker.getStats();
    expect(stats.meteredCostUsd).toBe(0);
    expect(stats.meteredDispatches).toBe(0);
    expect(stats.unmeteredDispatches).toBe(1);
    expect(stats.totalCostUsd).toBeGreaterThan(0); // ballpark exists but is not billing
  });

  it('estimateCost uses model pricing when available', () => {
    const haikuCost = estimateCost('claude', 1_000_000, 'claude-haiku-4-5');
    const defaultCost = estimateCost('claude', 1_000_000);
    expect(haikuCost).toBe(2.00);
    expect(defaultCost).toBe(9.00);
  });

  it('legacy 3-arg form still works', () => {
    const usage = tracker.record('claude', 'hello', 'world');
    expect(usage.source).toBe('estimated');
    expect(usage.promptTokens).toBe(2);
    expect(usage.responseTokens).toBe(2);
    expect(usage.engineId).toBe('claude');
  });

  describe('honest pricing (the $8.79-vs-$0.07 budget-warning incident)', () => {
    it('flat-rate coding-plan engines always cost $0 — real token counts, zero invented dollars', () => {
      expect(isFlatRateEngine('kimi-for-coding-k2p6')).toBe(true);
      expect(isFlatRateEngine('minimax-coding-plan-minimax-m3')).toBe(true);
      expect(isFlatRateEngine('zai-coding-plan-glm-5.1')).toBe(true);
      expect(isFlatRateEngine('claude')).toBe(false);
      expect(isFlatRateEngine('codex')).toBe(false);
      // 4.4M tokens on kimi used to price at the made-up $2/Mtok default → $8.79.
      expect(estimateCost('kimi-for-coding-k2p6', 4_400_000)).toBe(0);
      const usage = tracker.record('kimi-for-coding-k2p6', {
        usage: { promptTokens: 4_000_000, completionTokens: 400_000, totalTokens: 4_400_000, source: 'sdk' },
      });
      expect(usage.costUsd).toBe(0);
    });

    it('flat-rate sdk usage is excluded from meteredCostUsd (the budget-warning input)', () => {
      tracker.record('kimi-for-coding-k2p6', {
        usage: { promptTokens: 4_000_000, completionTokens: 400_000, totalTokens: 4_400_000, source: 'sdk' },
      });
      const stats = tracker.getStats();
      expect(stats.meteredCostUsd).toBe(0);
      expect(stats.meteredDispatches).toBe(0);
      expect(stats.unmeteredDispatches).toBe(1);
    });

    it('cache reads are priced at 10% of the base rate, not full input price', () => {
      // 950k prompt (900k cached) + 50k completion: 150k full + 900k at 10% = 240k effective… (190k of 1M)
      const cacheAware = estimateCostCacheAware('claude', 950_000, 50_000, 900_000);
      const fullPrice = estimateCost('claude', 1_000_000);
      expect(cacheAware).toBeCloseTo(fullPrice * 0.19, 5);
      // record() applies it when the usage carries cachedInputTokens.
      const usage = tracker.record('claude', {
        usage: { promptTokens: 950_000, completionTokens: 50_000, totalTokens: 1_000_000, cachedInputTokens: 900_000, source: 'sdk' },
      });
      expect(usage.costUsd).toBeCloseTo(fullPrice * 0.19, 5);
    });

    it('clamps a bogus cached count against promptTokens only — never discounts output tokens', () => {
      // cached 5000 > prompt 80 → clamp to 80; the 20 completion tokens stay full price.
      expect(estimateCostCacheAware('claude', 80, 20, 5_000))
        .toBeCloseTo(estimateCost('claude', 20) + 0.1 * estimateCost('claude', 80), 8);
      // negative cached → no discount at all.
      expect(estimateCostCacheAware('claude', 80, 20, -50)).toBeCloseTo(estimateCost('claude', 100), 8);
    });
  });
});
