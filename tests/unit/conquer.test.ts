// Unit tests for `agon conquer` phase-1 decision logic — the escalation ladder,
// stuck classifier, escalation gate, worktree auto-approve guard, and the compact
// consult-feedback formatter. All pure; no engine dispatch.
import { describe, expect, it } from 'vitest';
import {
  pickEscalationMode,
  classifyStuck,
  shouldEscalate,
  shouldAutoApprove,
  summarizeConsultForBuilder,
  capBreached,
  parseBuilderSignals,
  classifyAsk,
  buildConquerSystemPrompt,
  doneOracleDecision,
  runConquer,
  ESCAPING_OPS,
  type StuckSignals,
  type ConquerState,
  type ConquerCaps,
  type DoneOracleInput,
} from '@agon/forge';
import { tmpdir } from 'node:os';

const signals = (over: Partial<StuckSignals> = {}): StuckSignals => ({
  costVelocityFlat: false,
  diffEntropyLow: false,
  outputRepetition: false,
  sameFailureSignature: false,
  noPlanProgress: false,
  ...over,
});

describe('pickEscalationMode — the cost ladder', () => {
  it('high-stakes → council', () => {
    expect(pickEscalationMode({ kind: 'high-stakes' })).toBe('council');
  });
  it('explicitly irreversible → council, regardless of kind', () => {
    expect(pickEscalationMode({ kind: 'approach-doubt', reversible: false })).toBe('council');
  });
  it('a concrete choice → tribunal', () => {
    expect(pickEscalationMode({ kind: 'choice' })).toBe('tribunal');
  });
  it('>=2 options → tribunal even when kind is unset-ish', () => {
    expect(pickEscalationMode({ kind: 'approach-doubt', optionCount: 3 })).toBe('tribunal');
  });
  it('open-ended ideation → brainstorm', () => {
    expect(pickEscalationMode({ kind: 'ideation' })).toBe('brainstorm');
  });
  it('default quick approach-doubt → nero (cheapest)', () => {
    expect(pickEscalationMode({ kind: 'approach-doubt' })).toBe('nero');
    expect(pickEscalationMode({ kind: 'approach-doubt', optionCount: 1 })).toBe('nero');
  });
  it('high-stakes wins over a choice', () => {
    expect(pickEscalationMode({ kind: 'high-stakes', optionCount: 5 })).toBe('council');
  });
});

describe('classifyStuck — corroboration required', () => {
  it('zero or one signal is NOT stuck (default threshold 2)', () => {
    expect(classifyStuck(signals())).toBe(false);
    expect(classifyStuck(signals({ diffEntropyLow: true }))).toBe(false);
  });
  it('two signals → stuck', () => {
    expect(classifyStuck(signals({ diffEntropyLow: true, outputRepetition: true }))).toBe(true);
  });
  it('all five → stuck', () => {
    expect(classifyStuck(signals({
      costVelocityFlat: true, diffEntropyLow: true, outputRepetition: true,
      sameFailureSignature: true, noPlanProgress: true,
    }))).toBe(true);
  });
  it('honors a custom threshold', () => {
    expect(classifyStuck(signals({ diffEntropyLow: true, outputRepetition: true }), 3)).toBe(false);
    expect(classifyStuck(signals({ outputRepetition: true }), 1)).toBe(true);
  });
});

describe('shouldEscalate — stuck AND plan-diverged', () => {
  it('only escalates when both are true', () => {
    expect(shouldEscalate(true, true)).toBe(true);
    expect(shouldEscalate(true, false)).toBe(false);
    expect(shouldEscalate(false, true)).toBe(false);
    expect(shouldEscalate(false, false)).toBe(false);
  });
});

describe('shouldAutoApprove — worktree-gated', () => {
  it('never auto-approves outside an isolated worktree', () => {
    expect(shouldAutoApprove({ kind: 'edit-file' }, false)).toBe(false);
    expect(shouldAutoApprove({ kind: 'run-command' }, false)).toBe(false);
  });
  it('auto-approves safe ops inside isolation', () => {
    expect(shouldAutoApprove({ kind: 'edit-file' }, true)).toBe(true);
    expect(shouldAutoApprove({ kind: 'run-command' }, true)).toBe(true);
    expect(shouldAutoApprove({ kind: 'read' }, true)).toBe(true);
  });
  it('never auto-approves escaping ops, even inside isolation', () => {
    for (const op of ESCAPING_OPS) {
      expect(shouldAutoApprove({ kind: op }, true)).toBe(false);
    }
    expect(shouldAutoApprove({ kind: 'push' }, true)).toBe(false);
    expect(shouldAutoApprove({ kind: 'network-install' }, true)).toBe(false);
  });
});

describe('summarizeConsultForBuilder — compact feedback', () => {
  it('labels the mode and appends confidence when present', () => {
    const s = summarizeConsultForBuilder({ mode: 'nero', verdict: 'Use a streaming parser.', confidence: 80 });
    expect(s).toContain('[Cesar consulted nero]');
    expect(s).toContain('(confidence 80%)');
    expect(s).toContain('Use a streaming parser.');
  });
  it('omits confidence when null/absent', () => {
    const s = summarizeConsultForBuilder({ mode: 'tribunal', verdict: 'Go with option B.' });
    expect(s).not.toContain('confidence');
    expect(s).toContain('Go with option B.');
  });
  it('collapses whitespace and truncates to maxChars with an ellipsis', () => {
    const long = 'word '.repeat(400); // 2000 chars, whitespace-heavy
    const s = summarizeConsultForBuilder({ mode: 'council', verdict: long }, 100);
    expect(s.length).toBeLessThan(160); // prefix + 100 + ellipsis
    expect(s.endsWith('…')).toBe(true);
    expect(s).not.toMatch(/ {2,}/); // whitespace collapsed
  });
  it('does not truncate when under the cap', () => {
    const s = summarizeConsultForBuilder({ mode: 'brainstorm', verdict: 'short', confidence: null });
    expect(s.endsWith('…')).toBe(false);
    expect(s).toContain('short');
  });
});

const capState = (over: Partial<ConquerState> = {}): ConquerState => ({ turn: 0, spentUsd: 0, startedAtMs: 1000, consults: 0, ...over });

describe('capBreached', () => {
  const caps: ConquerCaps = { maxTurns: 5, maxWallClockMs: 10_000 };
  it('not breached under limits', () => {
    expect(capBreached(capState({ turn: 3 }), caps, 1000 + 5000)).toBe('');
  });
  it('turn cap', () => {
    expect(capBreached(capState({ turn: 5 }), caps, 1000)).toBe('cap-turns');
  });
  it('wall-clock cap', () => {
    expect(capBreached(capState({ turn: 1 }), caps, 1000 + 10_000)).toBe('cap-time');
  });
  it('wall-clock disabled when maxWallClockMs is 0', () => {
    expect(capBreached(capState({ turn: 1 }), { maxTurns: 5, maxWallClockMs: 0 }, 1000 + 999_999)).toBe('');
  });
});

describe('parseBuilderSignals', () => {
  it('extracts a done claim from the sentinel line', () => {
    const r = parseBuilderSignals('did stuff\nCONQUER_DONE: the CSV import handles quoted commas');
    expect(r.claimedDone).toBe(true);
    expect(r.claim).toBe('the CSV import handles quoted commas');
    expect(r.ask).toBeNull();
  });
  it('extracts an ask question', () => {
    const r = parseBuilderSignals('thinking…\nCONQUER_ASK: sync or async API?');
    expect(r.ask).toBe('sync or async API?');
    expect(r.claimedDone).toBe(false);
  });
  it('returns neither for plain output', () => {
    const r = parseBuilderSignals('still working on the parser');
    expect(r.claimedDone).toBe(false);
    expect(r.ask).toBeNull();
  });
  it('bare CONQUER_DONE with no claim', () => {
    const r = parseBuilderSignals('CONQUER_DONE');
    expect(r.claimedDone).toBe(true);
    expect(r.claim).toBe('');
  });
});

describe('classifyAsk', () => {
  it('high-stakes cues → high-stakes', () => {
    expect(classifyAsk('should I change the DB schema?').kind).toBe('high-stakes');
    expect(classifyAsk('this is irreversible, proceed?').kind).toBe('high-stakes');
  });
  it('enumerated options → choice', () => {
    expect(classifyAsk('which: 1. polling 2. websockets 3. SSE').kind).toBe('choice');
  });
  it('open how/where → ideation', () => {
    expect(classifyAsk('how do I structure the cache layer?').kind).toBe('ideation');
  });
  it('default → approach-doubt', () => {
    expect(classifyAsk('is this the right name').kind).toBe('approach-doubt');
  });
});

describe('buildConquerSystemPrompt', () => {
  it('teaches both sentinels and forbids weakening tests', () => {
    const p = buildConquerSystemPrompt();
    expect(p).toContain('CONQUER_ASK');
    expect(p).toContain('CONQUER_DONE');
    expect(p).toMatch(/weaken/i);
  });
});

describe('doneOracleDecision — mechanical layers', () => {
  const ok: DoneOracleInput = { gateOk: true, oracleTampered: false, weakenedTests: false, claim: 'X works', neroFalsified: false };
  it('passes when all layers clean', () => {
    expect(doneOracleDecision(ok).passed).toBe(true);
  });
  it('blocks on tampered frozen oracle', () => {
    expect(doneOracleDecision({ ...ok, oracleTampered: true }).passed).toBe(false);
  });
  it('blocks on weakened existing tests (acceptance drift)', () => {
    const d = doneOracleDecision({ ...ok, weakenedTests: true });
    expect(d.passed).toBe(false);
    expect(d.reason).toMatch(/drift/i);
  });
  it('blocks on a red gate', () => {
    expect(doneOracleDecision({ ...ok, gateOk: false }).passed).toBe(false);
  });
  it('blocks on an empty claim', () => {
    expect(doneOracleDecision({ ...ok, claim: '  ' }).passed).toBe(false);
  });
  it('blocks on a nero counterexample', () => {
    const d = doneOracleDecision({ ...ok, neroFalsified: true });
    expect(d.passed).toBe(false);
    expect(d.reason).toMatch(/nero/i);
  });
});

describe('runConquer — supervisory loop', () => {
  const registry = { get: (id: string) => ({ id }) } as any;
  const turn = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', durationMs: 1, timedOut: false });
  // advisorEngines: [] short-circuits the real nero round in the done-oracle, keeping the loop unit-testable.
  const base = (over: Record<string, unknown>) => ({
    task: 'build a thing', builderEngine: 'codex', advisorEngines: [] as string[],
    registry, timeout: 30, outputDir: tmpdir(), cwd: tmpdir(),
    evaluateDone: async () => ({ diff: '', gateOk: true, oracleTampered: false }),
    ...over,
  } as any);

  it('finishes when the builder claims done and the oracle passes', async () => {
    const adapter = { dispatch: async () => turn('working\nCONQUER_DONE: it works') } as any;
    const res = await runConquer(base({ adapter, caps: { maxTurns: 5, maxWallClockMs: 0 } }));
    expect(res.done).toBe(true);
    expect(res.stopReason).toBe('done');
    expect(res.turnsUsed).toBe(1);
    expect(res.lastClaim).toBe('it works');
  });

  it('stops at the turn cap when the builder never finishes', async () => {
    const adapter = { dispatch: async () => turn('still grinding, no sentinel') } as any;
    const res = await runConquer(base({ adapter, caps: { maxTurns: 3, maxWallClockMs: 0 } }));
    expect(res.done).toBe(false);
    expect(res.stopReason).toBe('cap-turns');
    expect(res.turnsUsed).toBe(3);
  });

  it('stops on builder failure (non-zero exit, no output)', async () => {
    const adapter = { dispatch: async () => turn('', 1) } as any;
    const res = await runConquer(base({ adapter, caps: { maxTurns: 5, maxWallClockMs: 0 } }));
    expect(res.stopReason).toBe('builder-failed');
    expect(res.turnsUsed).toBe(1);
  });

  it('rejects a done-claim on a red gate, then accepts once green', async () => {
    const adapter = { dispatch: async () => turn('CONQUER_DONE: done now') } as any;
    let calls = 0;
    const evaluateDone = async () => { calls += 1; return { diff: '', gateOk: calls >= 2, oracleTampered: false }; };
    const res = await runConquer(base({ adapter, evaluateDone, caps: { maxTurns: 5, maxWallClockMs: 0 } }));
    expect(res.done).toBe(true);
    expect(res.turnsUsed).toBe(2);
  });

  it('respects an already-aborted signal', async () => {
    const adapter = { dispatch: async () => turn('CONQUER_DONE: x') } as any;
    const res = await runConquer(base({ adapter, signal: AbortSignal.abort(), caps: { maxTurns: 5, maxWallClockMs: 0 } }));
    expect(res.stopReason).toBe('aborted');
    expect(res.turnsUsed).toBe(0);
  });
});
