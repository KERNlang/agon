import { describe, it, expect } from 'vitest';
import { generateMutants } from '../../packages/forge/src/generated/goal/mutation.js';
import type { Mutant } from '../../packages/forge/src/generated/goal/mutation.js';
import { mutationGateDecision, foldMutationVerdicts } from '../../packages/forge/src/generated/goal/policy.js';

// ── Mutation-gate calibration (tiered land / review / park) ──────────────
// The zero-tolerance mutation gate (any surviving mutant -> hard park) parked
// CORRECT contracts on real repos: a line-regex mutator inevitably produces
// EQUIVALENT mutants (boundary flips on guards, return-undefined on early-outs)
// that no correct test can kill. This calibrates the gate:
//   1. classify each mutant by operator: HIGH-SIGNAL (value/logic semantics —
//      the actual "answer encoded in the test" signatures) vs EQUIV-PRONE
//      (boundary / structural swaps that survive even strong tests).
//   2. decide on the HIGH-SIGNAL survivor count, not the raw count:
//        > max            -> park   (genuinely weak test)
//        1..max           -> review (ensemble adjudicates equivalent vs weak)
//        0, some generated-> land   (core semantics provably pinned)
//      with a ratio fallback for diffs that generated NO high-signal mutants
//      (relational/return-only) so "0 high-signal" can't fail OPEN.
// Witness stays a hard park elsewhere; only the mutation verdict is graded.

const mut = (
  cls: 'high-signal' | 'equiv-prone',
  operator = cls === 'high-signal' ? 'eq:===→!==' : 'rel:>→<=',
): Mutant => ({ id: `${operator}@L1`, operator, line: 1, before: 'x', after: 'y', class: cls });
const hi = (n: number) => Array.from({ length: n }, () => mut('high-signal'));
const eq = (n: number) => Array.from({ length: n }, () => mut('equiv-prone'));

describe('generateMutants — operator-class tagging', () => {
  const byOp = (src: string, op: string) => generateMutants(src, [1]).find((m) => m.operator === op);

  it('tags every generated mutant with a class', () => {
    const muts = generateMutants('const ok = a === b && a > 0;', [1]);
    expect(muts.length).toBeGreaterThan(0);
    for (const m of muts) expect(['high-signal', 'equiv-prone']).toContain(m.class);
  });

  it('classifies value/logic-semantics operators as HIGH-SIGNAL', () => {
    const src = 'const ok = a === b && a > 0;';
    expect(byOp(src, 'eq:===→!==')!.class).toBe('high-signal');
    expect(byOp(src, 'logic:&&→||')!.class).toBe('high-signal');
    expect(byOp('return a + b;', 'arith:+→-')!.class).toBe('high-signal');
    expect(byOp('const f = true;', 'bool:true→false')!.class).toBe('high-signal');
  });

  it('classifies boundary/structural operators as EQUIV-PRONE', () => {
    expect(byOp('const ok = a === b && a > 0;', 'rel:>→<=')!.class).toBe('equiv-prone');
    expect(byOp('return a + b;', 'ret:→undefined')!.class).toBe('equiv-prone');
    expect(byOp('const xs = [];', 'arr:[]→[0]')!.class).toBe('equiv-prone');
  });
});

describe('mutationGateDecision — tiered land / review / park', () => {
  it('lands when there are no survivors at all', () => {
    const r = mutationGateDecision([], [...hi(5), ...eq(5)]);
    expect(r.verdict).toBe('land');
    expect(r.highSignalSurvivors).toBe(0);
  });

  it('lands a correct contract: 0 high-signal survivors though high-signal mutants existed, even with many equivalent survivors (the kern-lang `let` case)', () => {
    const generated = [...hi(10), ...eq(40)]; // a `let`-binding diff: real semantics + lots of guards
    const survivors = eq(40); // every high-signal mutant died; only equivalent boundary/guard flips survive
    const r = mutationGateDecision(survivors, generated);
    expect(r.verdict).toBe('land');
    expect(r.highSignalSurvivors).toBe(0);
    expect(r.equivProneSurvivors).toBe(40);
  });

  it('reviews when 1..max high-signal mutants survive (default max 2)', () => {
    expect(mutationGateDecision(hi(1), hi(5)).verdict).toBe('review');
    expect(mutationGateDecision(hi(2), hi(5)).verdict).toBe('review');
  });

  it('parks when more than max high-signal mutants survive', () => {
    expect(mutationGateDecision(hi(3), hi(10)).verdict).toBe('park');
    expect(mutationGateDecision(hi(10), hi(10)).verdict).toBe('park');
  });

  it('does NOT auto-land when NO high-signal mutants were generated and equiv-prone survivors exceed the ratio (closes the fail-open hole)', () => {
    const generated = eq(40); // relational/return-only diff: zero high-signal information
    const survivors = eq(30); // 30/40 = 0.75 > 0.15 cap, and >= floor(3)
    const r = mutationGateDecision(survivors, generated);
    expect(r.verdict).toBe('review');
    expect(r.highSignalGenerated).toBe(0);
  });

  it('lands when no high-signal was generated but equiv-prone survivors stay within the ratio cap', () => {
    expect(mutationGateDecision(eq(2), eq(40)).verdict).toBe('land'); // 2/40 = 0.05 <= 0.15
  });

  it('does not trip the ratio fallback on tiny mutant counts (floor)', () => {
    expect(mutationGateDecision(eq(2), eq(4)).verdict).toBe('land'); // 2/4 = 0.5 > cap, but 2 < floor(3)
  });

  it('honors highSignalReviewMax=0 (any high-signal survivor parks)', () => {
    expect(mutationGateDecision(hi(1), hi(5), { highSignalReviewMax: 0 }).verdict).toBe('park');
  });

  it('honors a custom survivorRatioCap in the fallback band', () => {
    const generated = eq(40);
    const survivors = eq(30); // ratio 0.75
    expect(mutationGateDecision(survivors, generated, { survivorRatioCap: 0.9 }).verdict).toBe('land');
    expect(mutationGateDecision(survivors, generated, { survivorRatioCap: 0.5 }).verdict).toBe('review');
  });

  it('clamps out-of-range config defensively (exported fn must not corrupt the gate)', () => {
    // negative max -> 0 -> any high-signal survivor parks
    expect(mutationGateDecision(hi(1), hi(5), { highSignalReviewMax: -1 }).verdict).toBe('park');
    // ratio > 1 -> clamp to 1 -> fallback never trips on ratio alone
    expect(mutationGateDecision(eq(39), eq(40), { survivorRatioCap: 2 }).verdict).toBe('land');
    // ratio < 0 -> clamp to 0 -> any equiv survivors at/above floor trip review
    expect(mutationGateDecision(eq(5), eq(40), { survivorRatioCap: -1 }).verdict).toBe('review');
  });

  it('falls back to the policy default on NaN / Infinity config (must not fail OPEN)', () => {
    // NaN max must NOT disable the high-signal park: Math.max(0, NaN) is NaN and
    // every comparison with NaN is false, so an unguarded gate would never park.
    expect(mutationGateDecision(hi(5), hi(10), { highSignalReviewMax: NaN }).verdict).toBe('park'); // default 2 -> 5 > 2 parks
    expect(mutationGateDecision(hi(5), hi(10), { highSignalReviewMax: Infinity }).verdict).toBe('park');
    // NaN ratio cap must NOT disable the equiv-prone fallback (default 0.15).
    expect(mutationGateDecision(eq(30), eq(40), { survivorRatioCap: NaN }).verdict).toBe('review'); // 0.75 > 0.15
    // NaN floor falls back to default 3 — 2 survivors still land, 30 still review.
    expect(mutationGateDecision(eq(2), eq(40), { floor: NaN }).verdict).toBe('land');
    expect(mutationGateDecision(eq(30), eq(40), { floor: NaN }).verdict).toBe('review');
  });

  it('lands when no high-signal generated and there are no survivors at all (empty fallback)', () => {
    expect(mutationGateDecision([], eq(5)).verdict).toBe('land'); // 0 survivors < floor -> land
  });
});

describe('foldMutationVerdicts — per-file verdicts fold park > review > land', () => {
  it('lands only when every file lands (or there are none)', () => {
    expect(foldMutationVerdicts([])).toBe('land');
    expect(foldMutationVerdicts(['land', 'land'])).toBe('land');
  });
  it('reviews when any file reviews and none park', () => {
    expect(foldMutationVerdicts(['land', 'review', 'land'])).toBe('review');
  });
  it('parks when any file parks, regardless of the rest (worst file decides)', () => {
    expect(foldMutationVerdicts(['land', 'review', 'park'])).toBe('park');
    expect(foldMutationVerdicts(['park', 'land'])).toBe('park');
  });

  it('exposes survivor/generated counts and a reason for logging + the journal', () => {
    const r = mutationGateDecision([...hi(1), ...eq(3)], [...hi(5), ...eq(10)]);
    expect(r.highSignalSurvivors).toBe(1);
    expect(r.equivProneSurvivors).toBe(3);
    expect(r.highSignalGenerated).toBe(5);
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
