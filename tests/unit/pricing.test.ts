import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRICING,
  getEnginePricing,
  tokensToCost,
  estimatedTokensToCost,
} from '../../packages/core/src/blocks/pricing.js';
import type { EngineDefinition } from '../../packages/core/src/models/types.js';

// Pins the per-engine pricing type guard. A partial/wrong-typed pricing block
// must fall back to the conservative default; a complete numeric one must be
// used verbatim (budget ceilings are computed from these numbers).

function engineWith(pricing: unknown): EngineDefinition {
  return { id: 'e1', displayName: 'E1', api: { pricing } } as unknown as EngineDefinition;
}

describe('pricing', () => {
  it('uses the engine pricing when BOTH input and output are numbers', () => {
    expect(getEnginePricing(engineWith({ input: 0.001, output: 0.002 }))).toEqual({
      inputPer1k: 0.001,
      outputPer1k: 0.002,
    });
  });

  it('accepts a zero rate (free tier) — 0 is a number, not "missing"', () => {
    expect(getEnginePricing(engineWith({ input: 0, output: 0 }))).toEqual({
      inputPer1k: 0,
      outputPer1k: 0,
    });
  });

  it('falls back to the default when input is missing or non-numeric', () => {
    expect(getEnginePricing(engineWith({ output: 0.002 }))).toBe(DEFAULT_PRICING);
    expect(getEnginePricing(engineWith({ input: '0.001', output: 0.002 }))).toBe(DEFAULT_PRICING);
  });

  it('falls back to the default when output is missing or non-numeric', () => {
    expect(getEnginePricing(engineWith({ input: 0.001 }))).toBe(DEFAULT_PRICING);
    expect(getEnginePricing(engineWith({ input: 0.001, output: null }))).toBe(DEFAULT_PRICING);
  });

  it('falls back to the default when there is no api/pricing block at all', () => {
    expect(getEnginePricing({ id: 'e1' } as unknown as EngineDefinition)).toBe(DEFAULT_PRICING);
  });

  it('tokensToCost uses the engine rates, not the default', () => {
    const engine = engineWith({ input: 0.001, output: 0.01 });
    // 2000 input @ 0.001/1k + 1000 output @ 0.01/1k = 0.002 + 0.01
    expect(tokensToCost(engine, 2000, 1000)).toBeCloseTo(0.012, 10);
  });

  it('estimatedTokensToCost splits 80/20 using the engine rates', () => {
    const engine = engineWith({ input: 0.001, output: 0.01 });
    // 1000 total → 800 in @0.001/1k + 200 out @0.01/1k = 0.0008 + 0.002
    expect(estimatedTokensToCost(engine, 1000)).toBeCloseTo(0.0028, 10);
  });
});
