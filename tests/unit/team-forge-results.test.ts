import { describe, expect, it } from 'vitest';

import { buildTeamForgeResultView } from '../../packages/cli/src/commands/team-forge.js';

type View = ReturnType<typeof buildTeamForgeResultView>;
type Input = Parameters<typeof buildTeamForgeResultView>[0];

function team(teamId: string) {
  return {
    teamId,
    name: `Team ${teamId}`,
    lineupKey: teamId,
    source: 'auto-balanced' as const,
    members: [
      { engineId: 'claude', role: 'architect' as const, weight: 1 },
      { engineId: 'codex', role: 'implementer' as const, weight: 1 },
    ],
    aggregateElo: 1500,
  };
}

function fullMatch(): Input {
  return {
    teams: [team('alpha'), team('beta')],
    submissions: { alpha: { finalOutput: {} }, beta: { finalOutput: {} } },
    scorecards: { alpha: { score: 80 }, beta: { score: 73 } },
    winnerTeamId: 'alpha',
  };
}

function ids(view: View): string[] {
  return view.rows.map((row) => row.teamId);
}

describe('buildTeamForgeResultView — team forge results renderer', () => {
  it('renders both teams with score, members and the winner flag on a complete match', () => {
    const view = buildTeamForgeResultView(fullMatch());
    expect(ids(view)).toEqual(['alpha', 'beta']);
    expect(view.warning).toBeNull();
    expect(view.rows[0]).toMatchObject({
      isWinner: true,
      score: '80',
      members: 'claude(architect), codex(implementer)',
    });
    expect(view.rows[1]).toMatchObject({ isWinner: false, score: '73' });
  });

  it('renders the surviving team + a warning when only ONE team reported (the [1] TypeError case)', () => {
    const view = buildTeamForgeResultView({
      teams: [team('alpha')],
      submissions: { alpha: { finalOutput: {} } },
      scorecards: { alpha: { score: 80 } },
      winnerTeamId: 'alpha',
    });
    expect(ids(view)).toEqual(['alpha']);
    expect(view.rows[0]?.isWinner).toBe(true);
    expect(view.warning).toBe('Only 1 of 2 teams reported — showing the partial match.');
  });

  it('warns instead of crashing when NO team reported', () => {
    const view = buildTeamForgeResultView({ teams: [], submissions: {}, scorecards: {}, winnerTeamId: null });
    expect(view.rows).toEqual([]);
    expect(view.warning).toMatch(/no teams/i);
  });

  it('tolerates a hole in the teams array — a partial run can leave one slot empty', () => {
    const view = buildTeamForgeResultView({
      teams: [undefined, team('beta')],
      submissions: { beta: { finalOutput: {} } },
      scorecards: { beta: { score: 41 } },
      winnerTeamId: null,
    });
    expect(ids(view)).toEqual(['beta']);
    expect(view.rows[0]?.isWinner).toBe(false);
    expect(view.warning).toBe('Only 1 of 2 teams reported — showing the partial match.');
  });

  it('tolerates a result with no teams/submissions/scorecards fields at all', () => {
    const view = buildTeamForgeResultView({});
    expect(view.rows).toEqual([]);
    expect(view.warning).toMatch(/no teams/i);
  });

  it('omits score and members when the team never submitted and has no scorecard', () => {
    const view = buildTeamForgeResultView({
      teams: [team('alpha'), team('beta')],
      submissions: {},
      scorecards: { alpha: { score: 12 } },
      winnerTeamId: null,
    });
    expect(view.rows[0]).toMatchObject({ score: '12', members: null });
    expect(view.rows[1]).toMatchObject({ score: null, members: null });
    expect(view.warning).toBeNull();
  });
});
