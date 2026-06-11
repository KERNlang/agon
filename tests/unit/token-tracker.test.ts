import { describe, it, expect, beforeEach } from 'vitest';
import { tracker, estimateTokens, estimateCost } from '../../packages/core/src/generated/signals/token-tracker.js';
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
});
