import { describe, it, expect } from 'vitest';
import {
  checkSessionBudget,
  resolveThresholds,
  budgetRatioPct,
  effectiveWindow,
} from '@kernlang/agon-core';
import type { SessionBudget } from '@kernlang/agon-core';

const budget = (over: Partial<SessionBudget> = {}): SessionBudget =>
  ({ contextWindow: 100_000, ...over } as SessionBudget);

// With contextWindow 100k and no reserveTokens: reserve = max(15k, 8k) = 15k.
// effectiveWindow = 85_000. We size token counts off that.
const EFF = 85_000;

describe('effectiveWindow sanity for these fixtures', () => {
  it('is 85k for the test budget', () => {
    expect(effectiveWindow(budget())).toBe(EFF);
  });
});

describe('resolveThresholds', () => {
  it('applies defaults 0.70 / 0.82 / 0.92', () => {
    const t = resolveThresholds(budget());
    expect(t.warnAt).toBeCloseTo(0.70);
    expect(t.compactAt).toBeCloseTo(0.82);
    expect(t.hardStopAt).toBeCloseTo(0.92);
  });
  it('honors explicit fractions', () => {
    const t = resolveThresholds(budget({ warnAt: 0.5, compactAt: 0.6, hardStopAt: 0.7 }));
    expect(t.warnAt).toBeCloseTo(0.5);
    expect(t.compactAt).toBeCloseTo(0.6);
    expect(t.hardStopAt).toBeCloseTo(0.7);
  });
  it('falls back on out-of-range / inverted config and enforces monotonic order', () => {
    // compactAt below warnAt → raised to warnAt; hardStopAt below compactAt → raised
    const t = resolveThresholds(budget({ warnAt: 0.8, compactAt: 0.5, hardStopAt: 0.4 }));
    expect(t.warnAt).toBeCloseTo(0.8);
    expect(t.compactAt).toBeCloseTo(0.8);
    expect(t.hardStopAt).toBeCloseTo(0.8);
  });
  it('rejects >1 and <=0 fractions, using defaults', () => {
    const t = resolveThresholds(budget({ warnAt: 1.5 as any, compactAt: 0 as any, hardStopAt: -0.2 as any }));
    expect(t.warnAt).toBeCloseTo(0.70);
    expect(t.compactAt).toBeCloseTo(0.82);
    expect(t.hardStopAt).toBeCloseTo(0.92);
  });
});

describe('checkSessionBudget levels', () => {
  it('ok well below warn', () => {
    const r = checkSessionBudget(Math.round(EFF * 0.5), budget());
    expect(r.level).toBe('ok');
    expect(r.ratio).toBeCloseTo(0.5, 2);
    expect(r.effectiveWindow).toBe(EFF);
  });
  it('warn at >=0.70 and <0.82', () => {
    expect(checkSessionBudget(Math.round(EFF * 0.71), budget()).level).toBe('warn');
    expect(checkSessionBudget(Math.round(EFF * 0.81), budget()).level).toBe('warn');
  });
  it('compact at >=0.82 and <0.92', () => {
    expect(checkSessionBudget(Math.round(EFF * 0.82) + 1, budget()).level).toBe('compact');
    expect(checkSessionBudget(Math.round(EFF * 0.91), budget()).level).toBe('compact');
  });
  it('hard-stop at >=0.92 (incl over 100%)', () => {
    expect(checkSessionBudget(Math.round(EFF * 0.92) + 1, budget()).level).toBe('hard-stop');
    expect(checkSessionBudget(EFF * 2, budget()).level).toBe('hard-stop');
  });
  it('exactly-on-threshold is inclusive (>=)', () => {
    // ratio exactly 0.70 → warn
    expect(checkSessionBudget(Math.round(EFF * 0.70), budget()).level).toBe('warn');
  });
  it('treats negative/NaN estimates as 0 → ok', () => {
    expect(checkSessionBudget(-5, budget()).level).toBe('ok');
    expect(checkSessionBudget(NaN, budget()).level).toBe('ok');
    expect(checkSessionBudget(-5, budget()).estimated).toBe(0);
  });
  it('respects custom thresholds', () => {
    const b = budget({ warnAt: 0.4, compactAt: 0.5, hardStopAt: 0.6 });
    expect(checkSessionBudget(Math.round(EFF * 0.45), b).level).toBe('warn');
    expect(checkSessionBudget(Math.round(EFF * 0.55), b).level).toBe('compact');
    expect(checkSessionBudget(Math.round(EFF * 0.65), b).level).toBe('hard-stop');
  });
});

describe('reserveTokens affects the gate', () => {
  it('a larger reserve shrinks the effective window, raising the ratio', () => {
    const tight = budget({ reserveTokens: 50_000 }); // eff = 50k
    // 40k tokens → 0.80 of 50k → warn; but only 0.40 of the default 100k window
    expect(checkSessionBudget(40_000, tight).level).toBe('warn');
    expect(checkSessionBudget(40_000, budget()).level).toBe('ok');
  });
});

describe('budgetRatioPct', () => {
  it('rounds to a percent', () => {
    expect(budgetRatioPct(0.704)).toBe(70);
    expect(budgetRatioPct(0.706)).toBe(71);
    expect(budgetRatioPct(1.23)).toBe(123);
  });
  it('clamps negatives/NaN to 0', () => {
    expect(budgetRatioPct(-0.5)).toBe(0);
    expect(budgetRatioPct(NaN)).toBe(0);
  });
});
