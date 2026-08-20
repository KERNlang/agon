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

  it('does not opt in on prose that merely STARTS with yes/no', () => {
    expect(judgment('WINNER: codex\nCONVERGE: yesterday we merged the two halves').shouldConverge).toBe(false);
    expect(judgment('WINNER: codex\nCONVERGE: nonetheless keep them separate').shouldConverge).toBe(false);
  });

  it('still accepts the flag with trailing punctuation or case', () => {
    expect(judgment('WINNER: codex\nCONVERGE: YES.').shouldConverge).toBe(true);
    expect(judgment('WINNER: codex\nCONVERGE: yes — take the retry loop from claude').shouldConverge).toBe(true);
  });
});

// The registered roster is mostly hyphenated (kimi-code,
// minimax-coding-plan-minimax-m3) and some ids carry a dot
// (zai-coding-plan-glm-5.2). A word-character-only id capture matched NONE of
// them, so those engines' strengths were dropped from the judgment in silence.
describe('parseForgeJudgment — engine ids in strength lines', () => {
  it('keeps strengths attributed to hyphenated and dotted engine ids', () => {
    const j = judgment([
      'WINNER: codex',
      '- kimi-code: tests — covers the retry path',
      '- minimax-coding-plan-minimax-m3: perf — avoids the second pass',
      '- zai-coding-plan-glm-5.2: style — cleanest diff',
      '- codex: correctness — handles the 429 case',
    ].join('\n'));

    expect(j.strengths.map((s) => s.engineId)).toEqual([
      'kimi-code',
      'minimax-coding-plan-minimax-m3',
      'zai-coding-plan-glm-5.2',
      'codex',
    ]);
    expect(j.strengths[0]).toEqual({ engineId: 'kimi-code', category: 'tests', reason: 'covers the retry path' });
  });

  it('still excludes the structured convergence lines from strengths', () => {
    const j = judgment([
      'WINNER: codex',
      '- kimi-code: tests — covers the retry path',
      '- file:src/a.ts fn:retry from:kimi-code reason:handles the 429 case',
    ].join('\n'));

    expect(j.strengths).toHaveLength(1);
    expect(j.convergencePlan).toEqual([
      { file: 'src/a.ts', fn: 'retry', from: 'kimi-code', reason: 'handles the 429 case' },
    ]);
  });
});
