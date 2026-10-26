import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => vi.fn());
vi.mock('../../packages/core/src/api/dispatch.js', () => ({ apiStreamDispatchWithHistory: stream }));
import { AgentTeam } from '../../packages/core/src/cesar/agent-team.js';
import { AgentSession } from '../../packages/core/src/cesar/agent-session.js';

let root: string;
let team: AgentTeam | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-team-authority-'));
  mkdirSync(join(root, 'workspace'));
  stream.mockReset();
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
});
afterEach(async () => { await team?.cleanup(); team = undefined; rmSync(root, { recursive: true, force: true }); });

it.each(['healthy', 'initialize', 'step', 'provider', 'approval', 'provider-error'])(
  'enforces authority through real team member sessions: %s', async boundary => {
    let refused = boundary === 'initialize';
    let calls = 0;
    const approve = vi.fn(async () => { refused = true; return true; });
    stream.mockImplementation(async function* () {
      calls++;
      if (boundary === 'provider-error') return { exitCode: 1, stderr: '401 unauthorized' };
      if (boundary === 'provider') refused = true;
      if (boundary === 'approval') yield '<tool name="Write">{"file_path":"../result.txt","content":"fixture"}</tool>';
      else yield 'done';
      return { exitCode: 0 };
    });
    team = new AgentTeam({
      members: ['one', 'two'].map(engineId => ({ engineId,
        api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' } })),
      cwd: join(root, 'workspace'), isolate: false, budget: { maxTurns: 1, maxDurationMs: 120_000 },
      permissionMode: 'ask', toolPermissions: { Write: 'ask' },
      onPermissionAsk: approve,
      executionRefusal: () => refused ? 'Owner disabled' : undefined,
    });
    if (boundary === 'initialize') {
      await expect(team.initialize()).rejects.toThrow('Owner disabled');
      expect(calls).toBe(0);
      return;
    }
    await team.initialize();
    if (boundary === 'step') {
      refused = true;
      await expect(team.step('fixture')).rejects.toThrow('Owner disabled');
      expect(calls).toBe(0);
      return;
    }
    const result = await team.step('fixture');
    expect(result.members).toHaveLength(2);
    expect(existsSync(join(root, 'result.txt'))).toBe(false);
    if (boundary === 'healthy') {
      expect(result).toMatchObject({ succeeded: 2, failed: 0 });
      expect(calls).toBe(2);
    } else {
      expect(result).toMatchObject({ succeeded: 0, failed: 2 });
      expect(result.members.every(member => member.error || member.stepResult?.stopReason === 'error')).toBe(true);
      for (const member of result.members) {
        expect(member.error?.message || member.stepResult?.error).toContain(
          boundary === 'provider-error' ? '401 unauthorized' : 'Owner disabled');
      }
      expect(calls).toBeLessThanOrEqual(2);
      if (boundary === 'approval') expect(approve).toHaveBeenCalled();
    }
  },
);

it.each([0, -1])('rejects %i semaphore permits without retaining worktrees', async permits => {
  const inventory = () => execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const baseline = inventory();
  team = new AgentTeam({
    members: [{ engineId: 'fixture', api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' } }],
    cwd: root, isolate: true, budget: { maxTurns: 1, maxDurationMs: 1000 },
    heavyToolSemaphorePermits: permits,
  });
  const memberPath = join(root, '.agon', 'agent-worktrees', team.getRunId(), 'fixture');
  await expect(team.initialize()).rejects.toThrow('Semaphore permits must be >= 1');
  expect(inventory()).toBe(baseline);
  expect(existsSync(memberPath)).toBe(false);
  expect(stream).not.toHaveBeenCalled();
});

it.each([1, 2])('initializes and cleans real worktrees with %i semaphore permits', async permits => {
  const inventory = () => execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const baseline = inventory();
  team = new AgentTeam({
    members: [{ engineId: 'fixture', api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' } }],
    cwd: root, isolate: true, budget: { maxTurns: 1, maxDurationMs: 1000 },
    heavyToolSemaphorePermits: permits,
  });
  await team.initialize();
  const memberPath = team.getWorktreePath('fixture');
  expect(memberPath).not.toBeNull();
  expect(existsSync(memberPath!)).toBe(true);
  expect(inventory()).not.toBe(baseline);
  await team.cleanup();
  expect(inventory()).toBe(baseline);
  expect(existsSync(memberPath!)).toBe(false);
  expect(stream).not.toHaveBeenCalled();
});

it.each([1, 2])('rolls back real isolated worktrees when authority is lost after %i creations', async threshold => {
  const registrations = () => execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const baseline = registrations();
  const created = new Set<string>();
  team = new AgentTeam({
    members: ['one', 'two'].map(engineId => ({ engineId,
      api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' } })),
    cwd: root, isolate: true, budget: { maxTurns: 1, maxDurationMs: 120_000 },
    executionRefusal: () => {
      for (const engine of ['one', 'two']) {
        const path = join(root, '.agon', 'agent-worktrees', team!.getRunId(), engine);
        if (existsSync(path)) created.add(path);
      }
      return created.size >= threshold ? 'Owner disabled after worktree creation' : undefined;
    },
  });
  await expect(team.initialize()).rejects.toThrow('Owner disabled after worktree creation');
  expect(created.size).toBe(threshold);
  expect(registrations()).toBe(baseline);
  for (const path of created) expect(existsSync(path)).toBe(false);
  expect(stream).not.toHaveBeenCalled();
});

it('counts only completed members as successful in a mixed team result', async () => {
  const step = vi.spyOn(AgentSession.prototype, 'step');
  for (const stopReason of ['completed', 'error', 'cancelled', 'budget_exceeded'] as const) {
    step.mockResolvedValueOnce({ response: 'fixture', toolCalls: 0, innerSteps: 1,
      tokensUsed: 10, costUsd: 0, stopReason });
  }
  step.mockRejectedValueOnce(new Error('fixture failure'));
  try {
    team = new AgentTeam({
      members: ['completed', 'error', 'cancelled', 'budget_exceeded', 'thrown'].map(engineId => ({ engineId,
        api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' } })),
      cwd: root, isolate: false, budget: { maxTurns: 1, maxDurationMs: 120_000 },
    });
    await team.initialize();
    const result = await team.step('fixture');
    expect(result).toMatchObject({ succeeded: 1, failed: 4 });
    expect(result.members.map(member => member.stepResult?.stopReason ?? 'thrown'))
      .toEqual(['completed', 'error', 'cancelled', 'budget_exceeded', 'thrown']);
    expect(stream).not.toHaveBeenCalled();
  } finally {
    step.mockRestore();
  }
});

it.each(['empty', 'throw'])('fails closed on an %s team authority result', async mode => {
  team = new AgentTeam({
    members: [{ engineId: 'fixture', api: { baseUrl: 'https://example.invalid', model: 'fixture' } }],
    cwd: root, isolate: true, budget: { maxTurns: 1, maxDurationMs: 120_000 },
    executionRefusal: () => {
      if (mode === 'throw') throw new Error('private authority detail');
      return '';
    },
  });
  await expect(team.initialize()).rejects.toThrow(mode === 'throw' ? 'authority check failed' : 'execution refused');
  expect(existsSync(join(root, '.agon', 'agent-worktrees'))).toBe(false);
  expect(stream).not.toHaveBeenCalled();
});
