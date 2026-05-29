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
  ESCAPING_OPS,
  type StuckSignals,
} from '@agon/forge';

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
