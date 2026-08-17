import { describe, expect, it } from 'vitest';
import {
  CESAR_READ_REPEAT_DEFAULT,
  CESAR_READ_SPIRAL_DEFAULT,
  CESAR_SEARCH_NUDGE_DEFAULT,
  cesarReadRepeatThreshold,
  cesarReadSpiralThreshold,
  cesarSearchNudgeThreshold,
  readSpiralIntentFor,
  readSpiralNote,
  refundContinuationForSteeringYield,
  resolveGuardThreshold,
  shouldNoteReadSpiral,
} from '../../packages/cli/src/generated/cesar/step-guards.js';

const EDIT_INTAKES = ['quick-fix', 'bug', 'feature', 'big-feature', 'spec'];
const INVESTIGATE_INTAKES = ['chat', 'review', 'decision', 'exploration', '', 'something-new'];

function spiral(overrides: Partial<Parameters<typeof shouldNoteReadSpiral>[0]> = {}) {
  return shouldNoteReadSpiral({
    intent: 'feature',
    readSteps: 0,
    readRepeats: 0,
    effectfulSteps: 0,
    spiralThreshold: CESAR_READ_SPIRAL_DEFAULT,
    repeatThreshold: CESAR_READ_REPEAT_DEFAULT,
    alreadyNoted: false,
    ...overrides,
  });
}

describe('read-spiral intent mapping', () => {
  it('treats change-shaped intakes as edit intent', () => {
    for (const kind of EDIT_INTAKES) expect(readSpiralIntentFor(kind)).toBe('edit');
    expect(readSpiralIntentFor('QUICK-FIX')).toBe('edit');
  });

  it('treats everything else — including unknown/missing — as investigate', () => {
    for (const kind of INVESTIGATE_INTAKES) expect(readSpiralIntentFor(kind)).toBe('investigate');
    expect(readSpiralIntentFor(undefined)).toBe('investigate');
  });
});

describe('shouldNoteReadSpiral', () => {
  it('fires once on an edit turn with the read threshold reached and nothing effectful', () => {
    expect(spiral({ readSteps: 24 })).toBe(false);
    expect(spiral({ readSteps: 25 })).toBe(true);
    expect(spiral({ readSteps: 40 })).toBe(true);
    // Latched after the first note.
    expect(spiral({ readSteps: 40, alreadyNoted: true })).toBe(false);
  });

  it('never fires on an edit turn that already mutated or verified something', () => {
    expect(spiral({ readSteps: 40, effectfulSteps: 1 })).toBe(false);
    expect(spiral({ readSteps: 200, effectfulSteps: 3 })).toBe(false);
  });

  // ── Shell work is work (codex review N3) ──
  // `sed -i`, `git commit`, `mkdir -p`, a codegen script: all classify as `other`
  // (Bash we could not prove read-only, not gate-matching), so effectfulSteps
  // stays 0 and the edit-intent note used to tell an engine that had just
  // rewritten files "no edit or verification yet".
  it('never fires on an edit turn that did its work through the shell', () => {
    expect(spiral({ readSteps: 40, effectfulSteps: 0, shellWorkSteps: 1 })).toBe(false);
    expect(spiral({ readSteps: 200, effectfulSteps: 0, shellWorkSteps: 9 })).toBe(false);
    // …and it still fires when the turn really did nothing but read.
    expect(spiral({ readSteps: 40, effectfulSteps: 0, shellWorkSteps: 0 })).toBe(true);
  });

  it('leaves the investigate branch untouched by shell work (repeats still trip it)', () => {
    expect(spiral({ intent: 'exploration', readSteps: 30, readRepeats: 12, shellWorkSteps: 5 })).toBe(true);
    expect(spiral({ intent: 'exploration', readSteps: 300, shellWorkSteps: 0 })).toBe(false);
  });

  it('never fires on an investigate turn from read VOLUME alone', () => {
    expect(spiral({ intent: 'exploration', readSteps: 25 })).toBe(false);
    expect(spiral({ intent: 'review', readSteps: 300 })).toBe(false);
    expect(spiral({ intent: 'chat', readSteps: 300, effectfulSteps: 0 })).toBe(false);
  });

  it('fires on an investigate turn once read-REPEATS pile up', () => {
    expect(spiral({ intent: 'exploration', readSteps: 30, readRepeats: 11 })).toBe(false);
    expect(spiral({ intent: 'exploration', readSteps: 30, readRepeats: 12 })).toBe(true);
    expect(spiral({ intent: 'exploration', readSteps: 30, readRepeats: 12, alreadyNoted: true })).toBe(false);
  });

  it('honors caller-supplied thresholds (config policy, not hardcoded)', () => {
    expect(spiral({ readSteps: 5, spiralThreshold: 5 })).toBe(true);
    expect(spiral({ readSteps: 5, spiralThreshold: 6 })).toBe(false);
    expect(spiral({ intent: 'chat', readRepeats: 2, repeatThreshold: 2 })).toBe(true);
    expect(spiral({ intent: 'chat', readRepeats: 2, repeatThreshold: 3 })).toBe(false);
  });
});

describe('readSpiralNote wording', () => {
  it('asks an edit turn to summarize and then implement or ask ONE question', () => {
    const note = readSpiralNote('feature', 25, 0);
    expect(note).toContain('[NOTE]');
    expect(note).toContain('25 read/search calls');
    expect(note).toMatch(/make the change or ask me ONE question/);
  });

  it('asks an investigate turn to summarize and ANSWER — never to implement', () => {
    const note = readSpiralNote('exploration', 30, 12);
    expect(note).toContain('[NOTE]');
    expect(note).toContain('12 of your 30 read/search calls');
    expect(note).toMatch(/summarize what you found and answer/);
    expect(note.toLowerCase()).not.toContain('implement');
    expect(note.toLowerCase()).not.toContain('make the change');
  });
});

describe('steering-yield continuation accounting', () => {
  it('refunds the continuation slot a steering-yield round consumed', () => {
    expect(refundContinuationForSteeringYield(1)).toBe(0);
    expect(refundContinuationForSteeringYield(3)).toBe(2);
  });

  it('never drops below zero', () => {
    expect(refundContinuationForSteeringYield(0)).toBe(0);
    expect(refundContinuationForSteeringYield(-2)).toBe(0);
    expect(refundContinuationForSteeringYield(undefined as unknown as number)).toBe(0);
  });
});

describe('config thresholds', () => {
  it('defaults to 40 / 25 / 12 when unset', () => {
    expect(CESAR_SEARCH_NUDGE_DEFAULT).toBe(40);
    expect(CESAR_READ_SPIRAL_DEFAULT).toBe(25);
    expect(CESAR_READ_REPEAT_DEFAULT).toBe(12);
    expect(cesarSearchNudgeThreshold(undefined)).toBe(40);
    expect(cesarReadSpiralThreshold({} as any)).toBe(25);
    expect(cesarReadRepeatThreshold({} as any)).toBe(12);
  });

  it('reads configured values', () => {
    expect(cesarSearchNudgeThreshold({ cesarSearchNudgeThreshold: 12 } as any)).toBe(12);
    expect(cesarReadSpiralThreshold({ cesarReadSpiralThreshold: 3 } as any)).toBe(3);
    expect(cesarReadRepeatThreshold({ cesarReadRepeatThreshold: 2 } as any)).toBe(2);
  });

  it('falls back to the default on a value that would disable the guard', () => {
    expect(resolveGuardThreshold(0, 40)).toBe(40);
    expect(resolveGuardThreshold(-5, 40)).toBe(40);
    expect(resolveGuardThreshold(Number.NaN, 40)).toBe(40);
    expect(resolveGuardThreshold('nope', 40)).toBe(40);
    expect(resolveGuardThreshold(undefined, 40)).toBe(40);
    expect(resolveGuardThreshold(7.9, 40)).toBe(7);
    expect(cesarSearchNudgeThreshold({ cesarSearchNudgeThreshold: 0 } as any)).toBe(40);
  });
});
