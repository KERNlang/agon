import { describe, it, expect } from 'vitest';
import {
  buildConsensus, inferConfidence, normSeverity, clusterKey, clampConfidence,
  engineBadges, formatConsensusRow,
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

describe('buildConsensus — anchor-gated pair-block (review finding: phantom pairs)', () => {
  it('does NOT pair-block sparse low-information findings that collapse to the same key', () => {
    // two engines, each a vague finding with no file/lines and a 2-word problem
    const sparse = (engine: string): EngineOutcome => ({
      engine, status: 'ok',
      findings: [{ engine, severity: 'blocking', confidence: 0.8, problem: 'looks wrong', file: '', lines: '' }],
    });
    const r = buildConsensus([sparse('claude'), sparse('codex')]);
    expect(r.autoBlock).toBe(false);          // no phantom verified blocker
    expect(r.verified).toHaveLength(0);
    expect(r.needsCheck).toHaveLength(1);      // still surfaced for the judge
  });

  it('still pair-blocks when the cluster has a concrete file+line anchor', () => {
    const anchored = (engine: string): EngineOutcome => ({
      engine, status: 'ok',
      findings: [{ engine, severity: 'blocking', confidence: 0.75, problem: 'x', file: 'src/a.ts', lines: '42' }],
    });
    const r = buildConsensus([anchored('claude'), anchored('codex')]);
    expect(r.autoBlock).toBe(true);
  });

  it('still pair-blocks when the problem text is specific enough (>=3 words) even without file/lines', () => {
    const f = (engine: string): EngineOutcome => ({
      engine, status: 'ok',
      findings: [{ engine, severity: 'blocking', confidence: 0.72, problem: 'unbounded recursion on cyclic input', file: '', lines: '' }],
    });
    const r = buildConsensus([f('claude'), f('codex')]);
    expect(r.autoBlock).toBe(true);
  });
});

describe('inferConfidence — numeric-string coercion (review finding: quoted confidence)', () => {
  it('coerces a quoted numeric confidence', () => {
    expect(inferConfidence(f({ confidence: '0.72' as any }))).toBe(0.72);
  });
  it('falls back to severity default for a non-numeric string', () => {
    expect(inferConfidence(f({ confidence: 'high' as any, severity: 'important' }))).toBe(0.6);
  });
  it('a quoted-confidence blocking finding can solo-block', () => {
    const r = buildConsensus([ok('claude', [f({ confidence: '0.9' as any })])]);
    expect(r.autoBlock).toBe(true);
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
});

describe('buildConsensus — degraded (below-quorum) honesty', () => {
  // Build a 6-engine panel where `okN` engines return a clean verdict and the
  // rest time out. quorum = ceil(6/2) = 3.
  const panel = (okN: number) => {
    const outcomes: EngineOutcome[] = [];
    for (let i = 0; i < 6; i++) {
      outcomes.push(i < okN
        ? ok(`eng${i}`, [])
        : { engine: `eng${i}`, status: 'timeout', findings: [] });
    }
    return buildConsensus(outcomes);
  };

  it('0/6 — no verdict at all → no degraded marker (fail-closed path owns it)', () => {
    const r = panel(0);
    expect(r.okCount).toBe(0);
    expect(r.degraded).toBeUndefined();
  });

  it('1/6 — below quorum → degraded banner naming the 1/6 ratio', () => {
    const r = panel(1);
    expect(r.okCount).toBe(1);
    expect(r.degraded).toBeDefined();
    expect(r.degraded!.belowQuorum).toBe(true);
    expect(r.degraded!.warning).toContain('degraded consensus');
    expect(r.degraded!.warning).toContain('only 1/6 engines reviewed');
    expect(r.degraded!.warning).toContain('single-engine opinion');
  });

  it('2/6 — still below quorum (3) → degraded', () => {
    const r = panel(2);
    expect(r.okCount).toBe(2);
    expect(r.degraded).toBeDefined();
    expect(r.degraded!.warning).toContain('only 2/6 engines reviewed');
  });

  it('3/6 — AT quorum (ceil(6/2)=3) → NOT degraded', () => {
    const r = panel(3);
    expect(r.okCount).toBe(3);
    expect(r.degraded).toBeUndefined();
  });

  it('6/6 — full panel → NOT degraded', () => {
    const r = panel(6);
    expect(r.okCount).toBe(6);
    expect(r.degraded).toBeUndefined();
  });

  it('a single-engine review (panelSize 1, okCount 1) is NOT degraded', () => {
    const r = buildConsensus([ok('claude', [])]);
    expect(r.panelSize).toBe(1);
    expect(r.okCount).toBe(1);
    expect(r.degraded).toBeUndefined();
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

describe('buildConsensus — per-engine severity reconciliation', () => {
  it('reconciledSeverity is the MAX over per-engine stances (blocking wins over important)', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'important', confidence: 0.72 })]),
      ok('codex', [f({ engine: 'codex', severity: 'blocking', confidence: 0.75 })]),
    ]);
    const cluster = r.findings[0];
    expect(cluster.reconciledSeverity).toBe('blocking');
    expect(cluster.severity).toBe('blocking'); // legacy field stays in lockstep
  });

  it('carries each contributing engine\'s reported severity in perEngineSeverity', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'important', confidence: 0.72 })]),
      ok('codex', [f({ engine: 'codex', severity: 'blocking', confidence: 0.75 })]),
    ]);
    const byEngine = Object.fromEntries(r.findings[0].perEngineSeverity.map((s) => [s.engine, s.stance]));
    expect(byEngine).toEqual({ claude: 'important', codex: 'blocking' });
  });

  it('keeps an engine\'s WORST stance when it reports the same cluster twice', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'nit', confidence: 0.3 }), f({ severity: 'blocking', confidence: 0.9 })]),
    ]);
    const claude = r.findings[0].perEngineSeverity.find((s) => s.engine === 'claude');
    expect(claude?.stance).toBe('blocking');
  });
});

describe('buildConsensus — dispute detection', () => {
  it('marks a cluster DISPUTED when engines materially disagree (blocking vs nit on the SAME finding)', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'blocking', confidence: 0.9 })]),
      ok('codex', [f({ engine: 'codex', severity: 'nit', confidence: 0.4 })]),
    ]);
    const cluster = r.findings[0];
    expect(cluster.consensusLevel).toBe('disputed');
    expect(cluster.conflictDetails.map((c) => `${c.engine}:${c.stance}`).sort())
      .toEqual(['claude:blocking', 'codex:nit']);
  });

  it('does NOT dispute when severities are uniform (agreed)', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'blocking', confidence: 0.72 })]),
      ok('codex', [f({ engine: 'codex', severity: 'blocking', confidence: 0.75 })]),
    ]);
    const cluster = r.findings[0];
    expect(cluster.consensusLevel).toBe('agreed');
    expect(cluster.conflictDetails).toEqual([]);
  });

  it('does NOT dispute a one-rank spread (blocking vs important is normal wobble)', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'blocking', confidence: 0.72 })]),
      ok('codex', [f({ engine: 'codex', severity: 'important', confidence: 0.75 })]),
    ]);
    expect(r.findings[0].consensusLevel).toBe('agreed');
  });

  it('never disputes a lone-engine cluster (silence is not a stance)', () => {
    const r = buildConsensus([ok('claude', [f({ severity: 'blocking', confidence: 0.9 })])]);
    expect(r.findings[0].consensusLevel).toBe('agreed');
    expect(r.findings[0].conflictDetails).toEqual([]);
  });
});

describe('engineBadges', () => {
  it('renders short-form badges from contributing engines', () => {
    expect(engineBadges(['codex', 'kimi-for-coding-k2p6'])).toBe('[codex][kimi]');
    expect(engineBadges(['minimax-coding-plan-minimax-m3'])).toBe('[minimax]');
  });
  it('returns empty string for an empty list (caller falls back to ×N)', () => {
    expect(engineBadges([])).toBe('');
  });
});

describe('formatConsensusRow', () => {
  it('renders compact engine badges and the reconciled severity instead of ×N', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'important', confidence: 0.72 })]),
      ok('codex', [f({ engine: 'codex', severity: 'blocking', confidence: 0.75 })]),
    ]);
    const out = formatConsensusRow(r.findings[0]);
    expect(out[0]).toContain('[claude]');
    expect(out[0]).toContain('[codex]');
    // reconciled severity is 'blocking'; confidence is the cluster max (0.75 here,
    // but assert on shape not the exact value so the test survives data reshuffling).
    expect(out[0]).toMatch(/\[blocking 0\.\d{2} \[claude\]\[codex\]/);
    expect(out[0]).not.toContain('×');
  });

  it('renders each disputing engine\'s own wording on the stance line when it differs', () => {
    // Same file+line + same first-8 problem words → one cluster; the engines'
    // FULL wordings differ past word 8, so each stance line shows its own detail.
    // clusterKey uses the first 8 normalized problem words, so keep those eight
    // identical and let the wording DIVERGE only from word 9 onward — the two
    // findings then merge into one cluster but carry distinct per-engine detail.
    const prefix = 'null deref on user object in handler before guard'; // 8 words
    const r = buildConsensus([
      ok('claude', [f({ severity: 'blocking', confidence: 0.9, problem: `${prefix} causes a real crash` })]),
      ok('codex', [f({ engine: 'codex', severity: 'nit', confidence: 0.4, problem: `${prefix} but it is dead code` })]),
    ]);
    const cluster = r.findings[0];
    expect(cluster.consensusLevel).toBe('disputed');
    const stances = formatConsensusRow(cluster).slice(1).join('\n');
    expect(stances).toMatch(/↳ codex: nit — .*dead code/); // codex's differing wording is shown
  });

  it('honors a custom indent for the row and stance lines', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'blocking', confidence: 0.9 })]),
      ok('codex', [f({ engine: 'codex', severity: 'nit', confidence: 0.4 })]),
    ]);
    const out = formatConsensusRow(r.findings[0], '    '); // 4-space pad
    expect(out[0].startsWith('    • ')).toBe(true);
    expect(out[1].startsWith('        ↳ ')).toBe(true); // pad + 4 extra
  });

  it('prefixes disputed rows with ⚠ DISPUTED and lists per-engine stances underneath', () => {
    const r = buildConsensus([
      ok('claude', [f({ severity: 'blocking', confidence: 0.9 })]),
      ok('codex', [f({ engine: 'codex', severity: 'nit', confidence: 0.4 })]),
    ]);
    const out = formatConsensusRow(r.findings[0]);
    expect(out[0]).toContain('⚠ DISPUTED');
    const stanceLines = out.slice(1).join('\n');
    expect(stanceLines).toContain('↳ claude: blocking');
    expect(stanceLines).toContain('↳ codex: nit');
  });

  it('agreed rows have no DISPUTED prefix and no stance lines', () => {
    const r = buildConsensus([ok('claude', [f({ severity: 'blocking', confidence: 0.9 })])]);
    const out = formatConsensusRow(r.findings[0]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('DISPUTED');
  });
});
