import { describe, expect, it } from 'vitest';

// Source of truth: packages/forge/src/kern/team-forge.kern
import { decideTeamWinner } from '../../packages/forge/src/generated/team-forge.js';

type Result = Parameters<typeof decideTeamWinner>[0];

function result(overrides: Partial<Result> = {}): Result {
  return {
    engineId: 'x',
    pass: true,
    score: 73,
    diffLines: 120,
    filesChanged: 4,
    durationSec: 90,
    lintWarnings: 2,
    styleScore: 80,
    patchPath: '/tmp/p.patch',
    worktreePath: '/tmp/wt',
    ...overrides,
  } as Result;
}

describe('decideTeamWinner — team forge winner rule', () => {
  it('a passing team beats a failing team regardless of score', () => {
    expect(decideTeamWinner(result(), result({ pass: false, score: 90 }), 'alpha', 'beta')).toBe('alpha');
    expect(decideTeamWinner(result({ pass: false, score: 90 }), result(), 'alpha', 'beta')).toBe('beta');
  });

  it('higher composite score wins when both pass', () => {
    expect(decideTeamWinner(result({ score: 80 }), result({ score: 73 }), 'alpha', 'beta')).toBe('alpha');
    expect(decideTeamWinner(result({ score: 73 }), result({ score: 80 }), 'alpha', 'beta')).toBe('beta');
  });

  it('settles a passing score tie via the multi-axis tiebreak (the 73-vs-73 dead-end)', () => {
    // Identical scores, but Beta has fewer lint warnings — Beta must win, not draw.
    const winner = decideTeamWinner(
      result({ lintWarnings: 6 }),
      result({ lintWarnings: 0 }),
      'alpha',
      'beta',
    );
    expect(winner).toBe('beta');
  });

  it('prefers the smaller diff on an otherwise identical passing tie', () => {
    const winner = decideTeamWinner(
      result({ diffLines: 400 }),
      result({ diffLines: 40 }),
      'alpha',
      'beta',
    );
    expect(winner).toBe('beta');
  });

  it('stays a draw when both teams failed the gate — neither patch is safe to offer', () => {
    expect(
      decideTeamWinner(result({ pass: false, score: 0 }), result({ pass: false, score: 0 }), 'alpha', 'beta'),
    ).toBeNull();
    // Unequal scores must NOT elect a failing patch as "winner" for /apply.
    expect(
      decideTeamWinner(result({ pass: false, score: 40 }), result({ pass: false, score: 10 }), 'alpha', 'beta'),
    ).toBeNull();
  });

  it('stays a draw only on an absolute dead-heat across every axis', () => {
    expect(decideTeamWinner(result(), result(), 'alpha', 'beta')).toBeNull();
  });
});
