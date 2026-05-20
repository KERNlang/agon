import { describe, it, expect } from 'vitest';
import { planSynthesis } from '../../packages/forge/src/lib/synth-plan.js';
import type { SynthCandidate } from '../../packages/forge/src/lib/synth-plan.js';

// planSynthesis is the PURE decision layer for forge's always-on synthesis pass:
// given the forge winner, every candidate (pass/score/whether its patch adds a
// test), an optionally-configured synthesizer engine (goal -> judge; interactive
// -> cesar), and whether tests are required, decide:
//   - run: should synthesis run at all?
//   - synthEngine: which engine performs the synthesis/refine
//   - basePatchEngine: whose patch synthesis refines (the constraint-aware base)
// It must never invent an engine that is not among the candidates (except the
// explicitly configured synthEngine, which may be external e.g. cesar/judge).

const panel: SynthCandidate[] = [
  { engine: 'zai', pass: true, score: 89, addsTest: false },
  { engine: 'codex', pass: true, score: 79, addsTest: true },
  { engine: 'gemini', pass: true, score: 79, addsTest: true },
  { engine: 'minimax', pass: false, score: 0, addsTest: true },
  { engine: 'kimi', pass: false, score: 0, addsTest: false },
];

describe('planSynthesis — synthEngine selection', () => {
  it('uses the configured synthesizer engine when provided', () => {
    const p = planSynthesis({ forgeWinner: 'zai', candidates: panel, configuredSynthEngine: 'cesar', requireTests: false, alwaysSynthesize: true });
    expect(p.synthEngine).toBe('cesar');
  });

  it('falls back to the base patch engine when no synthesizer is configured', () => {
    const p = planSynthesis({ forgeWinner: 'zai', candidates: panel, requireTests: false, alwaysSynthesize: true });
    expect(p.synthEngine).toBe(p.basePatchEngine);
    expect(p.synthEngine).toBe('zai'); // requireTests off -> base is the forge winner
  });
});

describe('planSynthesis — constraint-aware base patch', () => {
  it('refines the forge winner when requireTests is off', () => {
    const p = planSynthesis({ forgeWinner: 'zai', candidates: panel, requireTests: false, alwaysSynthesize: true });
    expect(p.basePatchEngine).toBe('zai');
  });

  it('refines a passing test-bearing candidate when requireTests is on and the winner has no test', () => {
    const p = planSynthesis({ forgeWinner: 'zai', candidates: panel, requireTests: true, alwaysSynthesize: true });
    expect(p.basePatchEngine).toBe('codex'); // highest-scoring passing candidate that adds a test
    expect(p.run).toBe(true);
  });

  it('keeps the forge winner as base when it already adds a test', () => {
    const withTestWinner: SynthCandidate[] = [
      { engine: 'codex', pass: true, score: 90, addsTest: true },
      { engine: 'gemini', pass: true, score: 80, addsTest: true },
    ];
    const p = planSynthesis({ forgeWinner: 'codex', candidates: withTestWinner, requireTests: true, alwaysSynthesize: true });
    expect(p.basePatchEngine).toBe('codex');
  });

  it('keeps the forge winner as base when no passing candidate has a test (witness will park it)', () => {
    const noTests: SynthCandidate[] = [
      { engine: 'zai', pass: true, score: 89, addsTest: false },
      { engine: 'codex', pass: true, score: 79, addsTest: false },
    ];
    const p = planSynthesis({ forgeWinner: 'zai', candidates: noTests, requireTests: true, alwaysSynthesize: true });
    expect(p.basePatchEngine).toBe('zai');
  });
});

describe('planSynthesis — whether to run', () => {
  it('runs when alwaysSynthesize is on and there is a passing base patch', () => {
    const p = planSynthesis({ forgeWinner: 'zai', candidates: panel, requireTests: false, alwaysSynthesize: true });
    expect(p.run).toBe(true);
  });

  it('does not run when there is no passing candidate', () => {
    const allFail: SynthCandidate[] = [
      { engine: 'zai', pass: false, score: 0, addsTest: false },
      { engine: 'codex', pass: false, score: 0, addsTest: true },
    ];
    const p = planSynthesis({ forgeWinner: 'zai', candidates: allFail, requireTests: false, alwaysSynthesize: true });
    expect(p.run).toBe(false);
  });

  it('does not run when alwaysSynthesize is off and only one candidate passed (nothing to synthesize across)', () => {
    const single: SynthCandidate[] = [
      { engine: 'zai', pass: true, score: 89, addsTest: true },
      { engine: 'codex', pass: false, score: 0, addsTest: false },
    ];
    const p = planSynthesis({ forgeWinner: 'zai', candidates: single, requireTests: false, alwaysSynthesize: false });
    expect(p.run).toBe(false);
  });

  it('always provides a non-empty reason', () => {
    const p = planSynthesis({ forgeWinner: 'zai', candidates: panel, requireTests: true, alwaysSynthesize: true });
    expect(typeof p.reason).toBe('string');
    expect(p.reason.length).toBeGreaterThan(0);
  });
});
