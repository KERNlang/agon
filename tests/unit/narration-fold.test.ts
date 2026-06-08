import { describe, it, expect } from 'vitest';
import {
  foldNarration,
  foldNarrationLines,
  setLastFoldedRaw,
  getLastFoldedRaw,
  getFoldedRaw,
  getFoldedRawCount,
} from '../../packages/cli/src/generated/blocks/narration-fold.js';

// A condensed but faithful slice of a real agy (--print black-box agent)
// "wall of text": glued research narration followed by a real answer tail.
const AGY_WALL =
  'I will list the contents of the root workspace directory /Users/nicolascukas/KERN/Agon-AI to understand the project structure.' +
  'I will read the contents of AGON.md to understand the core concept of Agon.' +
  'I will view the contents of CLAUDE.md to see if there are build instructions.' +
  'I will search the codebase for the string openFiles across the application.' +
  'I will list the files in packages/cli/src/kern/blocks to locate the source code for the file rail.' +
  'I will view file-tracker.kern to see the exact structure of tracked files.' +
  'I will search intent.kern for any slash command matching open.' +
  'In Agon AI, open files refers to two complementary systems for managing files touched during a session. ' +
  'The File Rail is a visual sidebar panel that records the path, action type, and timestamps whenever an engine touches a file. ' +
  'The ContextThread tracks file reads to detect when an engine view has gone stale and must re-read before proceeding.';

describe('foldNarration', () => {
  it('folds the agy narration wall but keeps the full answer visible', () => {
    const r = foldNarration(AGY_WALL);
    expect(r.didFold).toBe(true);
    expect(r.foldedSteps).toBeGreaterThanOrEqual(5);
    // The answer tail must survive verbatim.
    expect(r.visible).toContain('In Agon AI, open files refers to two complementary systems');
    expect(r.visible).toContain('The File Rail is a visual sidebar panel');
    expect(r.visible).toContain('detect when an engine view has gone stale');
    // The research play-by-play must be gone from the visible text.
    expect(r.visible).not.toContain('I will list the contents of the root workspace');
    expect(r.visible).not.toContain('I will read the contents of AGON.md');
    // Raw is always preserved untouched.
    expect(r.raw).toBe(AGY_WALL);
    // Visible is much shorter than raw.
    expect(r.visible.length).toBeLessThan(r.raw.length);
  });

  it('never folds a clean structured answer (zero tax)', () => {
    const clean =
      'The bug is in the auth middleware. ' +
      'It validates the token signature but not its expiry, so stale tokens pass. ' +
      'The fix is to add an exp check before accepting the claim.';
    const r = foldNarration(clean);
    expect(r.didFold).toBe(false);
    expect(r.foldedSteps).toBe(0);
    expect(r.visible).toBe(clean);
  });

  it('does NOT fold an answer that merely starts like narration ("Let me explain…")', () => {
    const adversarial =
      'Let me explain why render-layer folding is risky. ' +
      'If the classifier is too eager it can hide a real answer behind a placeholder. ' +
      'Therefore the design must default to showing text whenever it is unsure.';
    const r = foldNarration(adversarial);
    // "Let me explain" carries answer/conclusion language (explain/therefore),
    // and there's no tool verb — it must stay fully visible.
    expect(r.visible).toContain('Let me explain why render-layer folding is risky');
    expect(r.visible).toContain('Therefore the design must default to showing text');
  });

  it('does not hide a pure-narration turn to nothing (no substance tail)', () => {
    const pure =
      'I will read the config file. ' +
      'I will check the package manifest. ' +
      'I will list the test directory.';
    const r = foldNarration(pure);
    // No answer to anchor on → show everything rather than fold to empty.
    expect(r.didFold).toBe(false);
    expect(r.visible).toBe(pure);
  });

  it('protects fenced code blocks even when surrounded by narration', () => {
    const withCode =
      'I will read the file to find the export.' +
      'I will check how it is used elsewhere.\n' +
      '```ts\nexport const FOLD_MIN_RUN = 2;\n```\n' +
      'This constant controls the minimum narration run length before folding.';
    const r = foldNarration(withCode);
    expect(r.visible).toContain('export const FOLD_MIN_RUN = 2;');
    expect(r.visible).toContain('This constant controls the minimum narration run length');
  });

  it('policy=off is a no-op', () => {
    const r = foldNarration(AGY_WALL, 'off');
    expect(r.didFold).toBe(false);
    expect(r.visible).toBe(AGY_WALL);
  });

  it('handles empty / whitespace input safely', () => {
    expect(foldNarration('').didFold).toBe(false);
    expect(foldNarration('   \n  ').visible.trim()).toBe('');
  });
});

describe('foldNarrationLines (live streaming)', () => {
  it('folds leading/all narration with NO substance tail (live is transient)', () => {
    // The pure-narration case foldNarration deliberately leaves alone — live
    // it must collapse, surfacing the latest step as a transient indicator.
    const liveWall =
      'I will list the test directory.\n' +
      'I will read the config file.\n' +
      'I will check the package manifest.';
    const r = foldNarrationLines(liveWall);
    expect(r.foldedSteps).toBe(3);
    expect(r.lastStep).toContain('check the package manifest');
    expect(r.visible.trim()).toBe('');
  });

  it('keeps substance lines visible and reports the latest step', () => {
    const mixed =
      'I will read the auth middleware.\n' +
      'The middleware validates the signature but not expiry.\n' +
      'I will check where tokens are issued.';
    const r = foldNarrationLines(mixed);
    expect(r.foldedSteps).toBe(2);
    expect(r.visible).toContain('The middleware validates the signature but not expiry');
    expect(r.visible).not.toContain('I will read the auth middleware');
    expect(r.lastStep).toContain('check where tokens are issued');
  });

  it('protects fenced code blocks line-wise', () => {
    const withCode =
      'I will inspect the constant.\n' +
      '```ts\nI will read X = 2;\n```\n' +
      'Done.';
    const r = foldNarrationLines(withCode);
    // The "I will read X = 2;" inside the fence must NOT be folded.
    expect(r.visible).toContain('I will read X = 2;');
    expect(r.visible).toContain('Done.');
  });

  it('policy=off is a no-op', () => {
    const r = foldNarrationLines('I will read the file.\nI will check it.', 'off');
    expect(r.foldedSteps).toBe(0);
  });
});

describe('folded-raw ring (/raw block-addressed replay)', () => {
  it('retains recent raws and pages back with getFoldedRaw(n)', () => {
    // Push more than the visible window to exercise ring behaviour.
    for (let i = 1; i <= 5; i++) setLastFoldedRaw(`raw-${i}`);
    const count = getFoldedRawCount();
    expect(count).toBeGreaterThanOrEqual(5);
    expect(getLastFoldedRaw()).toBe('raw-5');
    expect(getFoldedRaw(1)).toBe('raw-5'); // 1 = most recent
    expect(getFoldedRaw(2)).toBe('raw-4');
    // Out-of-range pages return '' rather than throwing.
    expect(getFoldedRaw(count + 100)).toBe('');
  });

  it('ignores empty raws', () => {
    const before = getFoldedRawCount();
    setLastFoldedRaw('');
    expect(getFoldedRawCount()).toBe(before);
  });
});
