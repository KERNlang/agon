import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamMatchResult, TeamSpec } from '@kernlang/agon-kernel';
import type { CommandContribution } from '@kernlang/agon-mod-api';
import { manifest } from '../helpers/modular-agon.js';
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

it.each([false, true])('blocks disabled team rating updates before locking (existing=%s)', async existing => {
  const owner = await import('@kernlang/agon-mod-ratings');
  const persistence = await import('@kernlang/agon-support-persistence');
  const { ModRegistry } = await import('@kernlang/agon-kernel');
  const path = join(home, 'team-elo.json');
  if (existing) owner.updateTeamElo(match('A'));
  const before = existing ? readFileSync(path, 'utf8') : undefined;
  const lock = vi.spyOn(persistence, 'withFileLock');
  new ModRegistry({ generation: 'without-ratings', activeOwners: [] }).runWithInvocationScope(() => {
    owner.updateTeamElo(match('B'));
    expect(lock).not.toHaveBeenCalled();
    expect(owner.getTeamElo().byFormat['1v1']?.compositions.a.rating).toBe(existing ? 1516 : undefined);
    expect(owner.predictTeamRating(match('A').teams[0].members, '1v1')).toBe(existing ? 1516 : 1500);
  });
  expect(existsSync(path)).toBe(existing);
  if (existing) expect(readFileSync(path, 'utf8')).toBe(before);
  expect(existsSync(path + '.lock')).toBe(false);
  expect(existsSync(path + '.tmp')).toBe(false);
});

it.each([
  { mode: 'auto-balanced' as const, expected: [['a', 'b'], ['b', 'c']] },
  { mode: 'adaptive' as const, expected: [['a', 'b'], ['c', 'b']] },
  { mode: 'explicit' as const, expected: [['c', 'a'], ['a', 'b']] },
])('uses roster order without rating reads when Ratings is disabled ($mode)', async ({ mode, expected }) => {
  const owner = await import('@kernlang/agon-mod-ratings');
  const glicko = await import('../../packages/mod-ratings/src/glicko.js');
  const { ModRegistry } = await import('@kernlang/agon-kernel');
  const { composeTeams } = await import('../../packages/core/src/teams/team.js');
  const record = glicko.getRatings();
  record.global.b = { ...glicko.defaultGlickoRating(), mu: 3000, phi: 10 };
  writeFileSync(join(home, 'ratings.json'), JSON.stringify(record));
  const reads = vi.spyOn(glicko, 'getRatings');
  const random = vi.spyOn(Math, 'random');
  new ModRegistry({ generation: 'without-ratings', activeOwners: [] }).runWithInvocationScope(() => {
    expect(owner.loadTeamConfidenceFloor('test')).toBeUndefined();
    const teams = composeTeams(['a', 'b', 'c'], 2, mode, 'test', [['c', 'a'], ['a', 'b']]);
    expect(teams.map(value => value.members.map(member => member.engineId))).toEqual(expected);
    expect(teams.map(value => value.aggregateElo)).toEqual([100, 100]);
    expect(reads).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });
});

it('keeps rating selection and updates available in an enabled invocation', async () => {
  const owner = await import('@kernlang/agon-mod-ratings');
  const { ModRegistry } = await import('@kernlang/agon-kernel');
  const record = owner.glicko.getRatings();
  record.global.b = { ...owner.glicko.defaultGlickoRating(), mu: 3000, phi: 10 };
  writeFileSync(join(home, 'ratings.json'), JSON.stringify(record));
  const { assignTeamRoles } = await import('../../packages/core/src/teams/team.js');
  new ModRegistry({ generation: 'with-ratings', activeOwners: [
    { id: 'agon.ratings', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
  ] }).runWithInvocationScope(() => {
    expect(assignTeamRoles(['a', 'b'], 'test').map(member => member.engineId)).toEqual(['b', 'a']);
    owner.updateTeamElo(match('A'));
    expect(owner.getTeamElo().byFormat['1v1'].compositions.a.rating).toBe(1516);
  });
});

it.each([
  { mode: 'brainstorm', physical: false }, { mode: 'tribunal', physical: false },
  { mode: 'brainstorm', physical: true },
] as const)('runs team $mode without disabled Ratings effects (physical=$physical)', async ({ mode, physical }) => {
  const { EngineRegistry, loadConfig, classifyTask } = await import('@kernlang/agon-core');
  const { ModRegistry } = await import('@kernlang/agon-kernel');
  const owner = await import('@kernlang/agon-mod-ratings');
  const persistence = await import('@kernlang/agon-support-persistence');
  const { runTeamBrainstorm, runTeamTribunal } = await import('../../packages/forge/src/index.js');
  const { createTeamBrainstormRuntime } = await import('../../packages/mod-team-brainstorm/src/runtime.js');
  const { buildKernDraftPrompt, parseKernDraft } = await import('@kernlang/protocol');
  const readRatings = vi.fn(owner.glicko.getRatings);
  const loadConfidenceFloor = vi.fn(owner.loadTeamConfidenceFloor);
  const updateTeamElo = vi.fn(owner.updateTeamElo);
  const runtime = createTeamBrainstormRuntime({
    loadConfig, classifyTask, readRatings, loadConfidenceFloor, updateTeamElo,
    buildKernDraftPrompt, parseKernDraft,
    partitionRoster: (value: InstanceType<typeof EngineRegistry>, requested, config) => value.partitionRoster(requested, config),
  });
  const registry = new EngineRegistry();
  for (const id of ['a', 'b']) {
    registry.register({ schemaVersion: 3, id, displayName: id, binary: process.execPath,
      exec: { args: ['{prompt}'] }, review: { args: ['{prompt}'] } });
  }
  writeFileSync(join(home, 'config.json'), JSON.stringify({ ratingsEnabled: true }));
  owner.updateTeamElo(match('A'));
  const path = join(home, 'team-elo.json');
  const before = readFileSync(path, 'utf8');
  const lock = vi.spyOn(persistence, 'withFileLock');
  const dispatch = vi.fn(async () => ({ exitCode: 0, timedOut: false, stderr: '', durationMs: 1,
    stdout: 'Proposal\nSCORE_ALPHA: 70\nSCORE_BETA: 30\nWINNER: ALPHA' }));
  const options = { question: 'migration?', membersPerSide: 2, rounds: 1,
    engines: ['a', 'b'], registry, adapter: { dispatch }, timeout: 10, outputDir: home };
  const workflowOwner = { id: `agon.team-${mode}`, version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` as const };
  const host = new ModRegistry({ generation: 'without-ratings', activeOwners: [workflowOwner] });
  const registration = host.beginRegistration(manifest(workflowOwner.id, workflowOwner.version, {
    contributes: { cliCommands: [{ id: 'team-fixture', aliases: [] }], tuiActions: [],
      mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] },
  }));
  const output: { match?: TeamMatchResult } = {};
  registration.registrar.command('cli', { id: 'team-fixture', description: 'Team workflow probe', run: async () => {
    await Promise.resolve();
    output.match = physical ? await runtime.runTeamBrainstorm(options as Parameters<typeof runtime.runTeamBrainstorm>[0])
      : mode === 'brainstorm' ? await runTeamBrainstorm(options) : await runTeamTribunal(options);
    return { exitCode: 0 };
  } });
  registration.commit();
  const command = host.resolve('cli-command', 'team-fixture')!.payload as CommandContribution;
  await command.run({}, { invocationId: 'team-fixture', cwd: home, platform: 'darwin-arm64',
    signal: new AbortController().signal, config: {} });
  const result = output.match;
  expect(result).toBeDefined();
  if (!result) throw new Error('Team workflow did not return a match');
  expect(dispatch.mock.calls.length).toBeGreaterThanOrEqual(5);
  expect(result.winnerTeamId).toBe(result.teams[0].teamId);
  expect(result.teams[0].members.map(member => member.engineId)).toEqual(['a', 'b']);
  expect(result.scorecards[result.teams[0].teamId].score).toBe(70);
  expect(lock).not.toHaveBeenCalled();
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(readRatings).not.toHaveBeenCalled();
  expect(loadConfidenceFloor).not.toHaveBeenCalled();
  expect(updateTeamElo).not.toHaveBeenCalled();
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
