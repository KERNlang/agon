import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, IntentContribution, InvocationContext, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';
import { withForgeHost } from '../../../tests/helpers/forge-host.js';
import { composePanelTeams } from '@kernlang/agon-support-panel';
import { runPhysicalTuiContribution } from '../../cli/src/signals/dispatch/intent-session.js';

function repo(): string { const cwd = mkdtempSync(join(tmpdir(), 'agon-team-forge-')); execFileSync('git', ['init'], { cwd }); execFileSync('git', ['config', 'user.email', 'team@example.invalid'], { cwd }); execFileSync('git', ['config', 'user.name', 'Team Test'], { cwd }); writeFileSync(join(cwd, 'README.md'), 'fixture\n'); execFileSync('git', ['add', '.'], { cwd }); execFileSync('git', ['commit', '-m', 'base'], { cwd }); return cwd; }

describe('physical Team Forge mod', () => {
  it('accepts the public parser result through the TUI schema boundary', async () => {
    let intent: IntentContribution | undefined;
    const registrar = {
      command: () => () => {},
      planStep: () => () => {},
      intent: (value: IntentContribution) => { intent = value; return () => {}; },
    } as unknown as Registrar;
    const services = {} as ModServices;
    await createMod(services).activate(registrar, services);
    const parsed = await intent!.parse('/team-forge 3v3 fix it test with test -f solved.txt');
    expect(parsed).toEqual({ task: 'fix it', fitnessCmd: 'test -f solved.txt', membersPerSide: 3 });
    const run = vi.fn(async () => ({ exitCode: 0 }));
    await runPhysicalTuiContribution(
      { owner: { id: 'agon.team-forge' }, payload: { ...intent!, run } },
      parsed!,
      'team-forge',
      { ctx: { config: {} }, dispatch: vi.fn() } as never,
      new AbortController().signal,
    );
    expect(run).toHaveBeenCalledWith(parsed, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    run.mockClear();
    await expect(runPhysicalTuiContribution(
      { owner: { id: 'agon.team-forge' }, payload: { ...intent!, run } },
      { fitnessCmd: 'true' },
      'team-forge',
      { ctx: { config: {} }, dispatch: vi.fn() } as never,
      new AbortController().signal,
    )).rejects.toThrow('$.task: required property is missing');
    expect(run).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -Infinity])('rejects a non-finite team size %s', size => {
    expect(() => composePanelTeams(['a', 'b'], size)).toThrow('Team size must be a finite number');
  });
  it.each([
    { size: 1, roles: ['architect'] },
    { size: 2, roles: ['architect', 'implementer'] },
    { size: 3, roles: ['architect', 'implementer', 'reviewer'] },
    { size: 4, roles: ['architect', 'implementer', 'implementer', 'reviewer'] },
  ])('assigns roles by position within each $size-member team', ({ size, roles }) => {
    const engines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const teams = composePanelTeams(engines, size);
    for (const [side, team] of teams.entries()) {
      expect(team.members.map(member => member.engineId)).toEqual(
        Array.from({ length: size }, (_, position) => engines[(position * 2 + side) % engines.length]),
      );
      expect(team.members.map(member => member.role)).toEqual(roles);
    }
  });

  it.each([0, -2, 1.8])('preserves finite-size normalization for %s', size => {
    expect(composePanelTeams(['a', 'b', 'c'], size)).toEqual([
      { teamId: 'ALPHA', members: [{ engineId: 'a', role: 'architect' }] },
      { teamId: 'BETA', members: [{ engineId: 'b', role: 'architect' }] },
    ]);
  });

  it('wraps an odd roster without changing team role positions', () => {
    const teams = composePanelTeams(['a', 'b', 'c'], 3);
    expect(teams.map(team => team.members.map(member => member.engineId)))
      .toEqual([['a', 'c', 'b'], ['b', 'a', 'c']]);
    for (const team of teams) expect(team.members.map(member => member.role))
      .toEqual(['architect', 'implementer', 'reviewer']);
  });

  it.each([
    { engines: ['alpha', 'beta'], fromIntent: false },
    { engines: ['architect-a', 'architect-b', 'alpha', 'beta'], fromIntent: false },
    { engines: ['architect-a', 'architect-b', 'alpha', 'beta', 'reviewer-a', 'reviewer-b'], fromIntent: true },
  ])('runs architect-to-implementer teams with $engines, intent=$fromIntent', async ({ engines, fromIntent }) => {
    const cwd = repo();
    const dispatch = vi.fn(async (engineId: string, prompt: string, context: InvocationContext, options: { mode?: string }) => {
      if (prompt.includes('AGON_FORGE_HEALTHY')) return { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false };
      if (options.mode === 'agent' && engineId === 'alpha') writeFileSync(join(context.cwd, 'solved.txt'), 'yes\n');
      if (options.mode === 'agent' && engineId === 'beta') writeFileSync(join(context.cwd, 'attempt.txt'), 'no\n');
      return { engineId, exitCode: 0, stdout: prompt.includes('architect') ? 'Create solved.txt and verify it.' : 'ok', stderr: '', timedOut: false };
    });
    const record = vi.fn(async () => 'team-receipt');
    const services = { identity: { id: 'agon.team-forge', version: '1', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => engines), rank: vi.fn(async (ids: readonly string[]) => ids.map((engineId) => ({ engineId, reason: 'none', scope: null }))), dispatch } } as unknown as ModServices;
    let command: CommandContribution | undefined;
    let intent: IntentContribution | undefined;
    const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: (value: IntentContribution) => { intent = value; return () => {}; }, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar;
    const mod = await createMod(withForgeHost(services)); await mod.activate(registrar, services);
    const context = { invocationId: 'team', cwd, platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
    const output = await (fromIntent
      ? intent!.run((await intent!.parse('/team-forge 3v3 make solved.txt test with test -f solved.txt'))!, context)
      : command!.run({ task: 'make solved.txt', test: 'test -f solved.txt', engines: engines.join(','), members: '2' }, context)) as { exitCode: number; stdout: string };
    const result = JSON.parse(output.stdout);
    expect(result.fitness).toBe('test -f solved.txt');
    expect(result.membersPerTeam).toBe(fromIntent ? 3 : 2);
    expect(output.exitCode).toBe(0);
    expect(result).toMatchObject({ winnerTeamId: 'ALPHA', winningEngineId: 'alpha', receiptId: 'team-receipt' });
    expect(result.submissions).toHaveLength(2);
    expect(result.submissions.map((submission: { teamId: string; pass: boolean }) => [submission.teamId, submission.pass]))
      .toEqual([['ALPHA', true], ['BETA', false]]);
    const builders = dispatch.mock.calls.filter(call => call[3]?.mode === 'agent');
    const worktrees = new Set(builders.map(call => call[2].cwd));
    expect(worktrees.size).toBe(2);
    expect(worktrees.has(cwd)).toBe(false);
    expect(existsSync(join(cwd, 'solved.txt'))).toBe(false);
    expect(existsSync(join(cwd, 'attempt.txt'))).toBe(false);
    expect(result.winningPatch).toContain('diff --git a/solved.txt b/solved.txt');
    expect([...new Set(dispatch.mock.calls.filter(call => call[3]?.mode === 'agent').map(call => call[0]))].sort())
      .toEqual(['alpha', 'beta']);
    expect(dispatch.mock.calls.filter(call => call[1].includes('As architect, inspect')).map(call => call[0]).sort())
      .toEqual(engines.slice(0, 2).sort());
  });
});
