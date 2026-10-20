import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamMatchResult, TeamSpec } from '@kernlang/agon-kernel';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

let home: string;
beforeEach(() => {
  home = setupTestAgonHome('team-ratings-owner');
  vi.resetModules();
});
afterEach(() => { vi.restoreAllMocks(); cleanupTestAgonHome(home); });

function team(teamId: string, engineId: string): TeamSpec {
  return { teamId, name: teamId, lineupKey: engineId, source: 'explicit',
    members: [{ engineId, role: 'captain', weight: 1 }], aggregateElo: 100 };
}
function match(winnerTeamId: string | null): TeamMatchResult {
  return { matchId: 'match', mode: 'brainstorm', task: 'Question',
    format: { membersPerSide: 1, label: '1v1' }, teams: [team('A', 'a'), team('B', 'b')],
    submissions: {}, scorecards: {}, winnerTeamId, timestamp: '2026-10-20T00:00:00Z' };
}

it('keeps Core team rating exports bound to their physical owner', async () => {
  const facade = await import('../../packages/core/src/teams/team-elo.js');
  const owner = await import('@kernlang/agon-mod-ratings');
  for (const key of Object.keys(facade) as Array<keyof typeof facade>) {
    expect(facade[key]).toBe(owner[key]);
  }
  const composition = await import('../../packages/core/src/teams/team.js');
  const panel = await import('@kernlang/agon-support-panel');
  expect(composition.computeContributionWeights).toBe(owner.computeContributionWeights);
  expect(composition.lineupKey).toBe(panel.lineupKey);
  expect(composition.makeFormat).toBe(panel.makeFormat);
  const source = readFileSync(new URL('../../packages/core/src/teams/team-elo.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/node:fs|function |withFileLock/);
  const policy = readFileSync(new URL('../../packages/core/src/teams/team.ts', import.meta.url), 'utf8');
  expect(policy).not.toMatch(/Math\.|randomUUID|\.sort\(|getRatings\(/);
});

it.each([
  { mode: 'auto-balanced' as const, expected: [['d', 'a'], ['a', 'b']] },
  { mode: 'adaptive' as const, expected: [['d', 'a'], ['b', 'c']] },
  { mode: 'explicit' as const, expected: [['d', 'b'], ['a', 'c']] },
])('preserves $mode composition and task-specific confidence ranking', async ({ mode, expected }) => {
  const { glicko } = await import('@kernlang/agon-mod-ratings');
  const record = glicko.getRatings();
  for (const [index, id] of ['a', 'b', 'c', 'd'].entries()) {
    record.global[id] = { ...glicko.defaultGlickoRating(), mu: 1000 - index * 100, phi: 100 };
  }
  record.byTaskClass.test = { d: { ...glicko.defaultGlickoRating(), mu: 2000, phi: 100 } };
  writeFileSync(join(home, 'ratings.json'), JSON.stringify(record));
  const { composeTeams } = await import('../../packages/core/src/teams/team.js');
  const teams = composeTeams(['a', 'b', 'c', 'd'], 2, mode, 'test', [['b', 'd'], ['c', 'a']]);
  expect(teams.map(value => value.members.map(member => member.engineId))).toEqual(expected);
  expect(teams.map(value => value.members.map(member => [member.role, member.weight])))
    .toEqual([[['architect', 0.6], ['implementer', 0.4]], [['architect', 0.6], ['implementer', 0.4]]]);
  expect(teams.map(value => value.source)).toEqual([mode, mode]);
  expect(teams.map(value => value.name)).toEqual(['Team Alpha', 'Team Beta']);
  expect(teams[0].teamId).toMatch(/^[a-f0-9]{8}$/);
  expect(teams[1].teamId).toMatch(/^[a-f0-9]{8}$/);
  expect(teams.map(value => value.aggregateElo)).toEqual(mode === 'explicit' ? [1250, 700]
    : mode === 'adaptive' ? [1300, 650] : [1300, 750]);
});

it('preserves composition and role ratings with atomic store publication', async () => {
  const owner = await import('../../packages/core/src/teams/team-elo.js');
  owner.updateTeamElo(match('A'));
  const record = owner.getTeamElo();
  expect(record.byFormat['1v1']).toEqual({
    compositions: {
      a: { lineupKey: 'a', rating: 1516, wins: 1, losses: 0, draws: 0, matches: 1 },
      b: { lineupKey: 'b', rating: 1484, wins: 0, losses: 1, draws: 0, matches: 1 },
    },
    roles: {
      'a:captain': { engineId: 'a', role: 'captain', rating: 1516, wins: 1, losses: 0, matches: 1 },
      'b:captain': { engineId: 'b', role: 'captain', rating: 1484, wins: 0, losses: 1, matches: 1 },
    },
  });
  const path = join(home, 'team-elo.json');
  expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(record, null, 2) + '\n');
  expect(existsSync(path + '.lock')).toBe(false);
  expect(existsSync(path + '.tmp')).toBe(false);
  expect(owner.predictTeamRating(match('A').teams[0].members, '1v1')).toBe(1516);
});

it('keeps a draw from creating a team ratings store', async () => {
  const owner = await import('../../packages/core/src/teams/team-elo.js');
  owner.updateTeamElo(match(null));
  expect(existsSync(join(home, 'team-elo.json'))).toBe(false);
  expect(owner.getTeamElo().byFormat).toEqual({});
});

it('preserves malformed historical bytes and reports their read failure', async () => {
  const owner = await import('../../packages/core/src/teams/team-elo.js');
  const path = join(home, 'team-elo.json');
  writeFileSync(path, '{broken');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(owner.getTeamElo().byFormat).toEqual({});
  expect(warn).toHaveBeenCalledTimes(1);
  expect(readFileSync(path, 'utf8')).toBe('{broken');
});

it('preserves contribution redistribution after a rejected implementation', async () => {
  const { computeContributionWeights } = await import('../../packages/core/src/teams/team.js');
  const value = team('A', 'a');
  value.members = [
    { engineId: 'a', role: 'architect', weight: 0.4 },
    { engineId: 'b', role: 'implementer', weight: 0.35 },
    { engineId: 'c', role: 'reviewer', weight: 0.25 },
  ];
  expect(computeContributionWeights(value, [
    { round: 1, actor: 'b', role: 'implementer', action: 'implemented', artifactSummary: '', durationMs: 1 },
    { round: 1, actor: 'c', role: 'reviewer', action: 'reviewed-reject', artifactSummary: '', durationMs: 1 },
  ])).toEqual({ a: 0.4, b: 0.3, c: 0.3 });
});
