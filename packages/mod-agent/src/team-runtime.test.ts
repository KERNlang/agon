import { describe, expect, it, vi } from 'vitest';
import { AgentTeamRuntime } from './team-runtime.js';
import type { AgentTeamConfig, AgentTeamRuntimeEffects, AgentTeamSession } from './team-runtime.js';

const config: AgentTeamConfig = {
  cwd: '/fixture/repo', isolate: true,
  members: ['one', 'two'].map(engineId => ({
    engineId, api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
  })),
  budget: { maxTurns: 1, maxDurationMs: 10_000 },
};

function fixture() {
  const worktrees = new Set<string>();
  const order: string[] = [];
  const signals = [new AbortController(), new AbortController()];
  const sessions: AgentTeamSession[] = signals.map((controller, index) => ({
    step: vi.fn(async (prompt, options) => {
      options?.onEvent?.({ kind: 'assistant_chunk', engineId: config.members[index].engineId, text: prompt });
      return { response: prompt, toolCalls: 0, innerSteps: 1, tokensUsed: 1, costUsd: 0, stopReason: 'completed' as const };
    }),
    cancel: vi.fn(() => { order.push(`cancel:${index}`); controller.abort(); }),
    getSignal: () => controller.signal,
    getStats: () => ({ turnsUsed: 0, turnsRemaining: 1, tokensUsed: 0, tokensRemaining: null,
      totalToolCalls: 0, totalCostUsd: 0, elapsedMs: 0, durationRemainingMs: 10_000, state: 'idle' }),
  }));
  const effects: AgentTeamRuntimeEffects = {
    repoRoot: vi.fn(cwd => cwd),
    stashSnapshot: vi.fn(() => 'snapshot'),
    worktreePruneAll: vi.fn(),
    worktreeCreate: vi.fn((_root, path) => { worktrees.add(path); return path; }),
    worktreeRemoveBestEffort: vi.fn((_root, path) => { order.push('remove'); worktrees.delete(path); }),
    createSession: vi.fn(member => sessions[config.members.findIndex(item => item.engineId === member.engineId)]),
  };
  return { effects, sessions, worktrees, order };
}

describe('Agent-owned team runtime', () => {
  it('uses injected workspaces and sessions, preserves outcomes, and cancels before removal', async () => {
    const { effects, sessions, worktrees, order } = fixture();
    const team = new AgentTeamRuntime(config, effects);
    try {
      await team.initialize();
      expect(worktrees.size).toBe(2);
      expect(effects.createSession).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(effects.createSession).mock.calls;
      expect(calls.map(([member]) => member.cwd)).toEqual(config.members.map(member => team.getWorktreePath(member.engineId)));
      expect(calls[0][0].heavyToolSemaphore).toBe(calls[1][0].heavyToolSemaphore);
      const onEvent = vi.fn();
      const result = await team.step('inspect', { onEvent });
      expect(result.baseSha).toBe('snapshot');
      expect(result.members.map(member => [member.engineId, member.stepResult?.response])).toEqual([
        ['one', 'inspect'], ['two', 'inspect'],
      ]);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(sessions.every(session => vi.mocked(session.step).mock.calls.length === 1)).toBe(true);
    } finally {
      await team.cleanup();
    }
    expect(worktrees.size).toBe(0);
    expect(order).toEqual(['cancel:0', 'cancel:1', 'remove', 'remove']);
    await expect(team.step('again')).rejects.toMatchObject({ name: 'AgentTeamDisposedError' });
  });

  it('rolls back every injected workspace when the second session cannot be constructed', async () => {
    const { effects, sessions, worktrees } = fixture();
    const failure = new Error('session unavailable');
    vi.mocked(effects.createSession).mockImplementationOnce(() => sessions[0]).mockImplementationOnce(() => { throw failure; });
    const team = new AgentTeamRuntime(config, effects);
    try {
      await expect(team.initialize()).rejects.toMatchObject({ name: 'AgentTeamError', cause: failure });
      expect(worktrees.size).toBe(0);
      expect(sessions[0].cancel).toHaveBeenCalledOnce();
      expect(effects.worktreeRemoveBestEffort).toHaveBeenCalledTimes(2);
      expect(sessions[0].step).not.toHaveBeenCalled();
    } finally {
      await team.cleanup();
    }
  });
});
