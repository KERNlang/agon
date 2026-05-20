import { describe, it, expect } from 'vitest';
import {
  buildConsensus, inferConfidence, normSeverity, clusterKey, clampConfidence,
} from '../../packages/cli/src/generated/blocks/consensus.js';
import type { RawFinding, EngineOutcome } from '../../packages/cli/src/generated/blocks/consensus.js';

const f = (over: Partial<RawFinding> = {}): RawFinding => ({
  engine: 'claude', severity: 'blocking', problem: 'null deref on user', file: 'src/a.ts', lines: '42', ...over,
});
const ok = (engine: string, findings: RawFinding[]): EngineOutcome => ({ engine, status: 'ok', findings });

describe('clampConfidence', () => {
  it('clamps into [0,1] and rejects NaN', () => {
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(-3)).toBe(0);
    expect(clampConfidence(9)).toBe(1);
    expect(clampConfidence(NaN)).toBe(0);
  });
});

describe('inferConfidence', () => {
  it('uses the self-rated number when finite, clamped', () => {
    expect(inferConfidence(f({ confidence: 0.91 }))).toBe(0.91);
    expect(inferConfidence(f({ confidence: 2 }))).toBe(1);
  });
  it('infers from severity when confidence absent', () => {
    expect(inferConfidence(f({ confidence: undefined, severity: 'blocking' }))).toBe(0.8);
    expect(inferConfidence(f({ confidence: undefined, severity: 'important' }))).toBe(0.6);
    expect(inferConfidence(f({ confidence: undefined, severity: 'nit' }))).toBe(0.3);
  });
  it('treats blocking:true as blocking severity', () => {
    expect(inferConfidence({ engine: 'x', blocking: true, problem: 'p' })).toBe(0.8);
  });
});

describe('normSeverity', () => {
  it('normalizes major→important and unknown→nit; blocking:true wins', () => {
    expect(normSeverity(f({ severity: 'major' }))).toBe('important');
    expect(normSeverity(f({ severity: 'whatever' }))).toBe('nit');
    expect(normSeverity({ engine: 'x', blocking: true, problem: 'p', severity: 'nit' })).toBe('blocking');
  });
});

describe('clusterKey', () => {
  it('collapses same file + nearby lines + similar wording', () => {
    expect(clusterKey(f({ lines: '42' }))).toBe(clusterKey(f({ lines: '45' }))); // same 10-line bucket
    expect(clusterKey(f({ problem: 'Null deref on user!' }))).toBe(clusterKey(f({ problem: 'null deref on user' })));
  });
  it('keeps distinct issues apart', () => {
    expect(clusterKey(f({ problem: 'null deref' }))).not.toBe(clusterKey(f({ problem: 'sql injection' })));
  });
});

describe('buildConsensus — block rules', () => {
  it('solo-blocks a blocking finding at >= 0.85', () => {
    const r = buildConsensus([ok('claude', [f({ confidence: 0.9 })])]);
    expect(r.autoBlock).toBe(true);
    expect(r.blockers).toHaveLength(1);
    expect(r.verified[0].tier).toBe('verified');
  });

  it('does NOT solo-block a blocking finding below 0.85 — routes to needs-check', () => {
    const r = buildConsensus([ok('claude', [f({ confidence: 0.8 })])]);
    expect(r.autoBlock).toBe(false);
    expect(r.needsJudge).toBe(true);
    expect(r.needsCheck).toHaveLength(1);
    expect(r.blockers).toHaveLength(0);
  });

  it('NEVER blocks a nit, even at confidence 0.99', () => {
    const r = buildConsensus([ok('claude', [f({ severity: 'nit', confidence: 0.99 })])]);
    expect(r.autoBlock).toBe(false);
    expect(r.needsJudge).toBe(false);
    expect(r.nits).toHaveLength(1);
    expect(r.nits[0].blocks).toBe(false);
  });

  it('does NOT solo-block a high-confidence IMPORTANT finding (only blocking-severity solo-blocks)', () => {
    const r = buildConsensus([ok('claude', [f({ severity: 'important', confidence: 0.95 })])]);
    expect(r.autoBlock).toBe(false);
    expect(r.needsCheck).toHaveLength(1);
  });

  it('pair-blocks two engines on the same issue, each >= 0.70', () => {
    const r = buildConsensus([
      ok('claude', [f({ confidence: 0.72 })]),
      ok('codex', [f({ engine: 'codex', confidence: 0.75 })]),
    ]);
    expect(r.autoBlock).toBe(true);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0].pairVotes).toBe(2);
    expect(r.blockers[0].engines.sort()).toEqual(['claude', 'codex']);
  });

  it('pair-blocks on IMPORTANT severity too', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'important', confidence: 0.71 })]),
      ok('codex', [f({ engine: 'codex', severity: 'important', confidence: 0.7 })]),
    ]);
    expect(r.autoBlock).toBe(true);
  });

  it('does NOT pair-block when one of the two is below 0.70', () => {
    const r = buildConsensus([
      ok('claude', [f({ confidence: 0.72 })]),
      ok('codex', [f({ engine: 'codex', confidence: 0.65 })]),
    ]);
    expect(r.autoBlock).toBe(false);
    expect(r.needsCheck).toHaveLength(1); // still surfaced for the judge
  });
});

describe('buildConsensus — tiering', () => {
  it('routes a lone sub-0.60 finding to speculative', () => {
    const r = buildConsensus([ok('claude', [f({ confidence: 0.4 })])]);
    expect(r.speculative).toHaveLength(1);
    expect(r.needsJudge).toBe(false);
  });

  it('promotes independent sub-0.60 agreement from speculative to needs-check', () => {
    const r = buildConsensus([
      ok('claude', [f({ confidence: 0.4 })]),
      ok('codex', [f({ engine: 'codex', confidence: 0.5 })]),
    ]);
    expect(r.speculative).toHaveLength(0);
    expect(r.needsCheck).toHaveLength(1);
    expect(r.needsCheck[0].engines).toHaveLength(2);
  });
});

describe('buildConsensus — failures lane', () => {
  it('puts timeouts/parse-failures in engineFailures, not findings', () => {
    const r = buildConsensus([
      ok('claude', [f({ confidence: 0.9 })]),
      { engine: 'gemini', status: 'timeout', findings: [], note: 'hard 420s cap' },
      { engine: 'zai', status: 'parse-failed', findings: [] },
    ]);
    expect(r.panelSize).toBe(3);
    expect(r.okCount).toBe(1);
    expect(r.engineFailures.map((e) => e.engine).sort()).toEqual(['gemini', 'zai']);
    expect(r.summary).toContain('2 failed');
    // the one OK engine still solo-blocks
    expect(r.autoBlock).toBe(true);
  });

  it('fail-closes when NO engine produced a verdict', () => {
    const r = buildConsensus([
      { engine: 'claude', status: 'timeout', findings: [] },
      { engine: 'codex', status: 'error', findings: [] },
    ]);
    expect(r.okCount).toBe(0);
    expect(r.autoBlock).toBe(true);
    expect(r.summary).toContain('fail-closed');
  });

  it('an all-clear panel does not block', () => {
    const r = buildConsensus([ok('claude', []), ok('codex', [])]);
    expect(r.autoBlock).toBe(false);
    expect(r.needsJudge).toBe(false);
    expect(r.findings).toHaveLength(0);
    expect(r.summary).toContain('2/2 engines reviewed');
  });
});

describe('buildConsensus — dedup & ordering', () => {
  it('counts one vote per engine even if it reports the cluster twice', () => {
    const r = buildConsensus([ok('claude', [f({ confidence: 0.72 }), f({ confidence: 0.71 })])]);
    // a single engine reporting twice is NOT two signals
    expect(r.autoBlock).toBe(false);
    expect(r.findings[0].engines).toEqual(['claude']);
    expect(r.findings[0].pairVotes).toBe(1);
  });

  it('sorts blockers first', () => {
    const r = buildConsensus([
      ok('claude', [f({ confidence: 0.3, severity: 'nit', problem: 'style nit', lines: '5' })]),
      ok('codex', [f({ engine: 'codex', confidence: 0.95, problem: 'crash', lines: '90' })]),
    ]);
    expect(r.findings[0].blocks).toBe(true);
  });

  it('honors custom thresholds', () => {
    const r = buildConsensus([ok('claude', [f({ confidence: 0.8 })])], 0.75, 0.6);
    expect(r.autoBlock).toBe(true); // 0.8 >= custom 0.75
  });
});
