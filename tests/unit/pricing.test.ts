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

  // ── Non-finite rates: documented current behaviour, NOT a live bug ──
  // The type guard is `typeof === 'number'`, which NaN and Infinity both
  // satisfy. That is deliberate to leave here rather than tighten, because
  // `api.pricing` has exactly one supply path — engine definition JSON
  // (built-in engines/*.json and user ~/.agon/engines/*.json) — and JSON
  // cannot express either value directly: `JSON.parse('{"a":NaN}')` and
  // `…Infinity}` are both SyntaxErrors, and nothing in the codebase builds an
  // api.pricing object programmatically (verified: no `pricing:` assignment
  // outside this module). The one reachable non-finite is an overflowing
  // literal (1e999 → Infinity), whose effect is fail-SAFE: every budget
  // comparison trips immediately and the run stops early, which is the
  // direction DEFAULT_PRICING is already tuned for.
  //
  // These cases pin that behaviour so the sharp edge is visible if pricing
  // ever becomes programmatic — at which point the guard should become
  // Number.isFinite.
  it('accepts a NaN rate (typeof NaN === "number") — unreachable from JSON', () => {
    expect(getEnginePricing(engineWith({ input: NaN, output: 0.002 }))).toEqual({
      inputPer1k: NaN,
      outputPer1k: 0.002,
    });
    expect(tokensToCost(engineWith({ input: NaN, output: 0.002 }), 1000, 1000)).toBeNaN();
  });

  it('accepts an overflowing literal rate (1e999 → Infinity) and fails safe (cost → Infinity)', () => {
    const parsed = JSON.parse('{"input": 1e999, "output": 0.002}');
    expect(parsed.input).toBe(Infinity);
    expect(getEnginePricing(engineWith(parsed)).inputPer1k).toBe(Infinity);
    expect(tokensToCost(engineWith(parsed), 1000, 1000)).toBe(Infinity);
  });

  it('rejects the string forms JSON CAN express', () => {
    expect(getEnginePricing(engineWith(JSON.parse('{"input": "NaN", "output": 0.002}')))).toBe(DEFAULT_PRICING);
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
