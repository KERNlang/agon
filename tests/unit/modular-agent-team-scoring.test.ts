import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentTeamResult } from '../../packages/core/src/cesar/agent-team.js';

function team(overrides: Partial<AgentTeamResult> = {}): AgentTeamResult {
  return {
    runId: 'team-scoring', baseSha: 'base', durationMs: 1500, succeeded: 1, failed: 0,
    members: [{
      engineId: 'worker', worktreePath: '/fixture/worker', error: null,
      stepResult: {
        response: 'x'.repeat(51), toolCalls: 1, innerSteps: 1,
        tokensUsed: 10, costUsd: 0, stopReason: 'completed',
      },
    }],
    ...overrides,
  };
}

describe('Agent-owned team scoring', () => {
  it('keeps the Core signature and measures tracked and untracked changes through the real Git reader', async () => {
    const { scoreAgentTeamResult } = await import('../../packages/core/src/cesar/synthesis-utils.js');
    const cwd = mkdtempSync(join(tmpdir(), 'agent-team-score-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      git('init', '-q');
      git('config', 'user.name', 'Scoring test');
      git('config', 'user.email', 'scoring@example.invalid');
      writeFileSync(join(cwd, 'tracked.txt'), 'before\n');
      git('add', 'tracked.txt');
      git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
      const input = team({ baseSha: git('rev-parse', 'HEAD') });
      input.members[0].worktreePath = cwd;
      const fitness = new Map([['worker', true]]);
      expect(scoreAgentTeamResult(input, cwd, 'edit', fitness).get('worker')?.pass).toBe(false);
      writeFileSync(join(cwd, 'tracked.txt'), 'after\n');
      writeFileSync(join(cwd, 'new.txt'), 'new\n');
      expect(scoreAgentTeamResult(input, cwd, 'edit', fitness).get('worker'))
        .toMatchObject({ pass: true, score: 100, filesChanged: 2, diffLines: 3 });
      expect(scoreAgentTeamResult(input, cwd, 'edit').get('worker')?.pass).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it('requires fitness evidence, a changed file and completion for edit success', async () => {
    const { scoreAgentTeamResult } = await import('../../packages/mod-agent/src/team-scoring.js');
    const read = vi.fn(() => ({ filesChanged: 1, linesChanged: 4 }));
    const input = team();
    expect(scoreAgentTeamResult(input, 'edit', undefined, read).get('worker'))
      .toMatchObject({ pass: false, score: 80, durationSec: 2 });
    expect(scoreAgentTeamResult(input, 'edit', new Map(), read).get('worker')?.pass).toBe(false);
    expect(scoreAgentTeamResult(input, 'edit', new Map([['worker', true]]), read).get('worker'))
      .toMatchObject({ pass: true, score: 100, diffLines: 4, filesChanged: 1 });
    expect(read).toHaveBeenCalledWith('/fixture/worker', 'base');
    expect(scoreAgentTeamResult(input, 'edit', new Map([['worker', true]]),
      () => ({ filesChanged: 0, linesChanged: 0 })).get('worker')?.pass).toBe(false);
    input.members[0].stepResult!.stopReason = 'cancelled';
    expect(scoreAgentTeamResult(input, 'edit', new Map([['worker', true]]), read).get('worker'))
      .toMatchObject({ pass: false, score: 50 });
  });

  it('keeps failed members and failed Git reads ineligible', async () => {
    const { scoreAgentTeamResult } = await import('../../packages/mod-agent/src/team-scoring.js');
    const read = vi.fn(() => { throw new Error('Git unavailable'); });
    const input = team();
    expect(scoreAgentTeamResult(input, 'edit', new Map([['worker', true]]), read).get('worker'))
      .toMatchObject({ pass: false, score: 70, diffLines: 0, filesChanged: 0 });
    input.members[0].error = new Error('worker failed');
    read.mockClear();
    expect(scoreAgentTeamResult(input, 'edit', new Map([['worker', true]]), read).get('worker'))
      .toEqual({ engineId: 'worker', pass: false, score: 0, diffLines: 0,
        filesChanged: 0, durationSec: 0, lintWarnings: 0, styleScore: 0 });
    expect(read).not.toHaveBeenCalled();
  });

  it('does not inspect Git for investigation and keeps thresholds and caps', async () => {
    const { scoreAgentTeamResult } = await import('../../packages/mod-agent/src/team-scoring.js');
    const read = vi.fn(() => { throw new Error('must not inspect Git'); });
    const input = team();
    input.members[0].stepResult!.response = 'x'.repeat(50);
    expect(scoreAgentTeamResult(input, 'investigate', undefined, read).get('worker'))
      .toMatchObject({ pass: false, score: 53 });
    input.members[0].stepResult!.response = 'x'.repeat(51);
    expect(scoreAgentTeamResult(input, 'investigate', undefined, read).get('worker')?.pass).toBe(true);
    input.members[0].stepResult!.response = 'x'.repeat(6000);
    input.members[0].stepResult!.toolCalls = 11;
    expect(scoreAgentTeamResult(input, 'investigate', undefined, read).get('worker'))
      .toMatchObject({ pass: true, score: 130, diffLines: 0, filesChanged: 0 });
    expect(read).not.toHaveBeenCalled();
  });

  it('retains input ordering, duplicate-key replacement and a one-second duration floor', async () => {
    const { scoreAgentTeamResult } = await import('../../packages/mod-agent/src/team-scoring.js');
    const input = team({ durationMs: 0 });
    const member = input.members[0];
    input.members = [member, { ...member, engineId: 'other' }, { ...member, error: new Error('last') }];
    const results = scoreAgentTeamResult(input, 'investigate', undefined, () => {
      throw new Error('must not inspect Git');
    });
    expect([...results.keys()]).toEqual(['worker', 'other']);
    expect(results.get('worker')?.pass).toBe(false);
    expect(results.get('other')?.durationSec).toBe(1);
  });
});
