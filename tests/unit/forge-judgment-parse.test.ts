import { describe, expect, it } from 'vitest';

import { parseForgeJudgment } from '../../packages/cli/src/cesar/judge.js';
import type { ForgeManifest } from '@kernlang/agon-core';

const manifest = { winner: 'codex' } as unknown as ForgeManifest;

const judgment = (body: string) => parseForgeJudgment(body, manifest)!;

// shouldConverge is OPT-IN: it only becomes true when the judge writes
// "CONVERGE: yes". Defaulting it to true means a judgment that never mentions
// convergence (or one that says no, but in a garbled line) kicks off a whole
// extra convergence pass — real engine spend the user never asked for.
describe('parseForgeJudgment — convergence flag', () => {
  it('stays off when the response says nothing about converging', () => {
    const j = judgment('WINNER: codex\nSUMMARY: cleanest diff of the three.');

    expect(j.winner).toBe('codex');
    expect(j.summary).toBe('cleanest diff of the three.');
    expect(j.shouldConverge).toBe(false);
  });

  it('stays off on an explicit CONVERGE: no', () => {
    expect(judgment('WINNER: codex\nCONVERGE: no').shouldConverge).toBe(false);
  });

  it('turns on only for an explicit CONVERGE: yes', () => {
    const j = judgment('WINNER: claude\nCONVERGE: yes\nSUMMARY: two good halves.');

    expect(j.winner).toBe('claude');
    expect(j.shouldConverge).toBe(true);
  });

  it('ignores convergence prose that is not the structured line', () => {
    const j = judgment('WINNER: codex\nSUMMARY: we could converge these later, but not now.');

    expect(j.shouldConverge).toBe(false);
    expect(j.convergencePlan).toEqual([]);
  });

  it('collects the structured convergence plan and strengths', () => {
    const j = judgment([
      'WINNER: codex',
      'CONVERGE: yes',
      '- claude: tests — covers the retry path',
      '- file:src/a.ts fn:retry from:claude reason:handles the 429 case',
    ].join('\n'));

    expect(j.strengths).toEqual([{ engineId: 'claude', category: 'tests', reason: 'covers the retry path' }]);
    expect(j.convergencePlan).toEqual([
      { file: 'src/a.ts', fn: 'retry', from: 'claude', reason: 'handles the 429 case' },
    ]);
  });

  it('returns null when no winner can be resolved', () => {
    expect(parseForgeJudgment('CONVERGE: yes', {} as unknown as ForgeManifest)).toBeNull();
  });
});
