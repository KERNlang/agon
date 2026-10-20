import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAdapter, TeamEvent, TeamSpec } from '../../packages/core/src/index.js';
import { EngineRegistry, loadConfig, classifyTask, getRatings, updateTeamElo } from '../../packages/core/src/index.js';
import { runTeamBrainstorm as legacyTeamBrainstorm, runTeamTribunal } from '../../packages/forge/src/index.js';
import { runTeamCoopTribunal } from '../../packages/forge/src/team-tribunal.js';
import { runTeamCoopBrainstorm as legacyTeamCoopBrainstorm } from '../../packages/forge/src/team-brainstorm.js';
import { createTeamBrainstormRuntime } from '../../packages/mod-team-brainstorm/src/runtime.js';
import { loadTeamConfidenceFloor } from '../../packages/mod-ratings/src/team-elo.js';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import { createTeamBrainstormHostServices } from '../../packages/mod-team-brainstorm/src/host.js';
import type { InvocationContext } from '@kernlang/agon-mod-api';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

let agonHome: string;
const structuredDraft = `draft {
  approach: "Use staged deployment"
  reasoning: "Keep the previous version"
  tradeoffs: "More disk space"
  confidence: 80
  keyFiles: "src/deploy.ts"
  steps { 1: "Stage then promote" }
}`;
beforeEach(() => {
  agonHome = setupTestAgonHome('team-prompt-routing');
  vi.spyOn(process, 'cwd').mockReturnValue(agonHome);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); cleanupTestAgonHome(agonHome); });

function registryWithTwoEngines(): EngineRegistry {
  const registry = new EngineRegistry();
  for (const id of ['e1', 'e2']) {
    registry.register({
      schemaVersion: 3, id, displayName: id, binary: process.execPath,
      exec: { args: ['{prompt}'] }, review: { args: ['{prompt}'] },
    } as any);
  }
  return registry;
}

function recordingAdapter(modes: string[], systemPrompts: string[] = [], cwds: string[] = []) {
  return {
    dispatch: async (options: { mode: string; prompt: string; systemPrompt?: string; cwd: string }) => {
      modes.push(options.mode);
      systemPrompts.push(options.systemPrompt ?? '');
      cwds.push(options.cwd);
      const judge = options.prompt.includes('JUDGE');
      return {
        exitCode: 0, timedOut: false, stderr: '', durationMs: 1,
        stdout: judge ? 'SCORE_ALPHA: 70\nSCORE_BETA: 30\nWINNER: ALPHA' : 'Prompt-grounded team contribution',
      };
    },
  } as any;
}

describe('physical team host authority', () => {
  it('uses task-specific rating floors for composition while the legacy update switch stays off', async () => {
    const registry = registryWithTwoEngines();
    for (const id of ['e3', 'e4']) registry.register({
      schemaVersion: 3, id, displayName: id, binary: process.execPath,
      exec: { args: ['{prompt}'] },
    } as any);
    const floors: Record<string, number> = { e1: 124.4, e2: 299.6, e3: 200.2, e4: 900 };
    const floor = vi.fn((id: string) => floors[id]);
    const loadFloor = vi.fn(() => floor);
    const readRatings = vi.fn(() => ({ global: {}, byMode: { brainstorm: {} } }));
    const updateRatings = vi.fn();
    const calls: Array<Parameters<EngineAdapter['dispatch']>[0]> = [];
    const runtime = createTeamBrainstormRuntime({
      loadConfig: () => ({ cesarEngine: 'e4', ratingsEnabled: false }),
      classifyTask: () => 'other', readRatings, updateTeamElo: updateRatings,
      loadConfidenceFloor: loadFloor, buildKernDraftPrompt, parseKernDraft,
      partitionRoster: (_registry: EngineRegistry, requested) => ({ active: requested!, removed: [] }),
    });
    const result = await runtime.runTeamBrainstorm({
      question: 'rated composition', membersPerSide: 2, engines: ['e1', 'e2', 'e3', 'e4'],
      registry, timeout: 10, outputDir: agonHome,
      adapter: { dispatch: async options => {
        calls.push(options);
        return { exitCode: 0, timedOut: false, stderr: '', durationMs: 1,
          stdout: options.prompt.includes('JUDGE') ? 'SCORE_ALPHA: 70\nSCORE_BETA: 30\nWINNER: ALPHA' : structuredDraft };
      } } as EngineAdapter,
    });
    expect(result.teams.map(team => ({ members: team.members, aggregateElo: team.aggregateElo }))).toEqual([
      { members: [{ engineId: 'e2', role: 'architect', weight: 0.6 },
        { engineId: 'e3', role: 'implementer', weight: 0.4 }], aggregateElo: 250 },
      { members: [{ engineId: 'e3', role: 'architect', weight: 0.6 },
        { engineId: 'e1', role: 'implementer', weight: 0.4 }], aggregateElo: 162 },
    ]);
    expect(loadFloor.mock.calls).toEqual([['other'], ['other'], ['other']]);
    expect(readRatings).toHaveBeenCalled();
    expect(updateRatings).not.toHaveBeenCalled();
    expect(calls.filter(call => call.prompt.includes('TEAM SYNTHESIS')).map(call => call.engine.id)).toEqual(['e2', 'e3']);
    expect(calls.at(-1)?.engine.id).toBe('e4');
  });

  const transitions = [
    { transition: 'current', phase: 'draft', reject: false },
    ...['retired', 'cancelled'].flatMap(transition =>
      ['draft', 'synthesis', 'judge'].flatMap(phase =>
        [false, true].map(reject => ({ transition, phase, reject })))),
  ];
  it.each(transitions)('checks late $phase results ($transition, reject=$reject)', async ({ transition, phase, reject }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = new AbortController();
    let current = true;
    const calls: Array<Parameters<EngineAdapter['dispatch']>[0]> = [];
    const registry = registryWithTwoEngines();
    const openRegistry = vi.fn(() => registry);
    const readConfig = vi.fn((cwd: string) => ({ ...loadConfig(cwd), cesarEngine: 'e2', ratingsEnabled: true }));
    const updateRatings = vi.fn();
    const adapter = {
      dispatch: async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
        calls.push(options);
        await Promise.resolve();
        const activePhase = options.prompt.includes('JUDGE') ? 'judge'
          : options.prompt.includes('TEAM SYNTHESIS') ? 'synthesis' : 'draft';
        if (activePhase === phase) {
          if (transition === 'retired') current = false;
          if (transition === 'cancelled') controller.abort(new Error('cancelled'));
          if (reject) throw new Error('provider failed after authority change');
        }
        return { exitCode: 0, timedOut: false, stderr: '', durationMs: 1,
          stdout: options.prompt.includes('JUDGE') ? 'SCORE_ALPHA: 70\nSCORE_BETA: 30\nWINNER: ALPHA' : structuredDraft };
      },
    } as EngineAdapter;
    const createAdapter = vi.fn(() => adapter);
    const captureAuthority = vi.fn(() => () => { if (!current) throw new Error('retired'); });
    const host = createTeamBrainstormHostServices({
      openRegistry, createAdapter, captureAuthority,
      loadConfig: readConfig, classifyTask, readRatings: getRatings, updateTeamElo: updateRatings,
      loadConfidenceFloor: loadTeamConfidenceFloor, buildKernDraftPrompt, parseKernDraft,
      partitionRoster: (value: EngineRegistry, requested, config) => value.partitionRoster(requested, config),
    });
    expect(openRegistry).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(readConfig).not.toHaveBeenCalled();
    expect(captureAuthority).not.toHaveBeenCalled();
    const context: InvocationContext = {
      invocationId: 'host-baseline', cwd: agonHome, platform: 'darwin-arm64',
      signal: controller.signal, config: {},
    };
    const invocation = host.open(context);
    expect(openRegistry).toHaveBeenCalledWith(agonHome);
    expect(readConfig).not.toHaveBeenCalled();
    const events: TeamEvent[] = [];
    const result = invocation.run({ question: 'migration?', membersPerSide: 1,
      engines: ['e1', 'e2'], composeMode: 'explicit', explicitTeams: [['e1'], ['e2']],
      timeout: 10, outputDir: agonHome, onEvent: event => events.push(event as TeamEvent) });
    if (transition === 'current') {
      await expect(result).resolves.toMatchObject({ mode: 'brainstorm', task: 'migration?' });
      expect(calls).toHaveLength(5);
      expect(calls[4].engine.id).toBe('e2');
      expect(updateRatings).toHaveBeenCalledTimes(1);
      expect(events.at(-1)?.type).toBe('team:match-done');
    } else {
      await expect(result).rejects.toThrow(transition);
      expect(calls).toHaveLength(phase === 'draft' ? 2 : phase === 'synthesis' ? 4 : 5);
      expect(updateRatings).not.toHaveBeenCalled();
      expect(events.some(event => event.type === 'team:match-done')).toBe(false);
      if (phase === 'draft') expect(events.some(event => event.type === 'team:member-done')).toBe(false);
      expect(events.some(event => event.type === 'team:score' || event.type === 'team:winner')).toBe(false);
    }
    expect(readConfig).toHaveBeenCalledWith(agonHome);
    expect(calls.every(call => call.signal === controller.signal)).toBe(true);
  });
});

describe.each(['legacy', 'physical'] as const)('team prompt routing (%s)', implementation => {
  const runtime = createTeamBrainstormRuntime({
    loadConfig, classifyTask, readRatings: getRatings, updateTeamElo,
    loadConfidenceFloor: loadTeamConfidenceFloor, buildKernDraftPrompt, parseKernDraft,
    partitionRoster: (registry: EngineRegistry, requested, config) => registry.partitionRoster(requested, config),
  });
  const runTeamBrainstorm = implementation === 'legacy' ? legacyTeamBrainstorm : runtime.runTeamBrainstorm;
  const runTeamCoopBrainstorm = implementation === 'legacy' ? legacyTeamCoopBrainstorm : runtime.runTeamCoopBrainstorm;
  it.each(['none', 'draft', 'synthesis'] as const)('preserves Brainstorm raw output and failure fallback (failure=%s)', async failure => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const team: TeamSpec = {
      teamId: 'baseline', name: 'Baseline', lineupKey: 'e1', source: 'explicit',
      aggregateElo: 100, members: [{ engineId: 'e1', role: 'captain', weight: 1 }],
    };
    const calls: Array<Parameters<EngineAdapter['dispatch']>[0]> = [];
    const adapter = {
      dispatch: async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
        const synthesis = calls.length === 1;
        calls.push(options);
        vi.setSystemTime(Date.now() + 5);
        if ((synthesis && failure === 'synthesis') || (!synthesis && failure === 'draft')) {
          throw new Error('fixture failure');
        }
        return { exitCode: 0, timedOut: false, stderr: '', durationMs: 5,
          stdout: synthesis ? ' Final proposal ' : structuredDraft, usage: { totalTokens: synthesis ? 20 : 10 } };
      },
    } as EngineAdapter;
    const events: TeamEvent[] = [];
    const signal = new AbortController().signal;
    const result = await runTeamCoopBrainstorm(team, 'migration?', 'Keep rollback',
      registryWithTwoEngines(), adapter, 10, agonHome, event => events.push(event as TeamEvent), signal);
    const fallback = '## e1 (quality: 52, confidence: 80%)\nApproach: Use staged deployment\nReasoning: Keep the previous version\nTradeoffs: More disk space\nSteps:\n  1. Stage then promote';
    const proposal = failure === 'synthesis' ? fallback : 'Final proposal';
    expect(result).toEqual({
      proposal, score: failure === 'draft' ? 0 : 62.4,
      submission: {
        teamId: 'baseline', finalOutput: proposal, totalTokens: failure === 'none' ? 30 : failure === 'draft' ? 20 : 10,
        wallClockMs: 10, collaborationLift: failure === 'draft' ? 0 : expect.closeTo(10.4, 10),
        trace: [
          { round: 1, actor: 'e1', role: 'captain', action: 'implemented',
            artifactSummary: failure === 'draft' ? 'failed: fixture failure' : 'Use staged deployment',
            durationMs: failure === 'draft' ? 0 : 5 },
          { round: 2, actor: 'e1', role: 'architect', action: 'finalized',
            artifactSummary: proposal.slice(0, 200), durationMs: failure === 'synthesis' ? 0 : 5 },
        ],
      },
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({ mode: 'exec', cwd: agonHome, outputDir: agonHome, timeout: 10, signal });
      expect(call.engine.id).toBe('e1');
      expect(call.systemPrompt).toContain('Do not use tools, read files, or run commands.');
    }
    expect(calls[0].prompt).toContain('Keep rollback');
    expect(calls[0].prompt).toContain('migration?');
    expect(calls[1].prompt).toContain('migration?');
    expect(calls[1].prompt).toContain(failure === 'draft' ? 'Approach: Failed to respond' : fallback);
    const failures = events.filter(event => event.type === 'engine:failed' as string);
    expect(failures).toEqual(failure === 'none' ? [] : [{
      type: 'engine:failed', engineId: 'e1',
      data: { teamId: 'baseline', engineId: 'e1', phase: `team-brainstorm-${failure}`, error: 'fixture failure' },
    }]);
    expect(events.filter(event => event.type.startsWith('team:round-'))).toEqual([
      { type: 'team:round-start', data: { teamId: 'baseline', round: 1 } },
      { type: 'team:round-done', data: { teamId: 'baseline', round: 1 } },
      { type: 'team:round-start', data: { teamId: 'baseline', round: 2 } },
      { type: 'team:round-done', data: { teamId: 'baseline', round: 2 } },
    ]);
    expect(warning).toHaveBeenCalledTimes(failure === 'none' ? 0 : 1);
    expect(events.map(event => event.type)).toEqual([
      'team:round-start', 'team:member-dispatch',
      failure === 'draft' ? 'engine:failed' : 'team:member-done',
      'team:round-done', 'team:round-start', 'team:member-dispatch',
      ...(failure === 'synthesis' ? ['engine:failed'] : []),
      'team:member-done', 'team:round-done',
    ]);
  });

  it.each([false, true])('combines unequal drafts through the non-first architect (member fails=%s)', async memberFails => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const team: TeamSpec = {
      teamId: 'multi', name: 'Multi', lineupKey: 'e1+e2', source: 'explicit', aggregateElo: 100,
      members: [{ engineId: 'e1', role: 'implementer', weight: 0.4 },
        { engineId: 'e2', role: 'architect', weight: 0.6 }],
    };
    const calls: Array<Parameters<EngineAdapter['dispatch']>[0]> = [];
    const adapter = {
      dispatch: async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
        calls.push(options);
        if (options.engine.id === 'e1' && memberFails) throw new Error('member failed');
        return { exitCode: 0, timedOut: false, stderr: '', durationMs: 1,
          stdout: options.prompt.includes('TEAM SYNTHESIS') ? 'Combined proposal'
            : options.engine.id === 'e1' ? 'Plain draft' : structuredDraft };
      },
    } as EngineAdapter;
    const result = await runTeamCoopBrainstorm(team, 'migration?', undefined,
      registryWithTwoEngines(), adapter, 10, agonHome);
    expect(calls.map(call => call.engine.id)).toEqual(['e1', 'e2', 'e2']);
    const synthesis = calls[2].prompt;
    expect(synthesis).toContain('## e2 (quality: 52, confidence: 80%)');
    expect(synthesis).toContain(memberFails ? '## e1 (quality: 0, confidence: 0%)' : '## e1 (quality: 2.5, confidence: 50%)');
    expect(synthesis.indexOf('## e2')).toBeLessThan(synthesis.indexOf('## e1'));
    expect(synthesis).toContain(memberFails ? 'Approach: Failed to respond' : 'Approach: Plain draft');
    expect(result.proposal).toBe('Combined proposal');
    expect(result.score).toBeCloseTo(memberFails ? 31.2 : 32.7, 10);
    expect(result.submission.collaborationLift).toBeCloseTo(memberFails ? -20.8 : -19.3, 10);
    expect(result.submission.trace.map(step => [step.actor, step.action])).toEqual([
      ['e1', 'implemented'], ['e2', 'implemented'], ['e2', 'finalized'],
    ]);
  });

  it('preserves the raw two-round Tribunal role, trace, token and event contract', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    const registry = registryWithTwoEngines();
    registry.register({ ...registry.get('e1'), id: 'e3', displayName: 'e3' });
    const team: TeamSpec = {
      teamId: 'baseline', name: 'Baseline', lineupKey: 'e1+e2+e3',
      source: 'explicit', aggregateElo: 100,
      members: [
        { engineId: 'e1', role: 'architect', weight: 0.4 },
        { engineId: 'e2', role: 'implementer', weight: 0.35 },
        { engineId: 'e3', role: 'reviewer', weight: 0.25 },
      ],
    };
    const calls: Array<Parameters<EngineAdapter['dispatch']>[0]> = [];
    const outputs = ['strategy one', 'evidence one', 'argument one', 'strategy two', 'evidence two', 'argument two'];
    const adapter = {
      dispatch: async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
        const index = calls.length;
        calls.push(options);
        vi.setSystemTime(Date.now() + 7);
        return { exitCode: 0, timedOut: false, stderr: '', durationMs: index + 1,
          stdout: ` ${outputs[index]} `, usage: { totalTokens: index + 10 } };
      },
    } as EngineAdapter;
    const events: TeamEvent[] = [];
    const signal = new AbortController().signal;
    const result = await runTeamCoopTribunal(team, 'against', 'rollback?', 2, 'red-team',
      registry, adapter, 10, agonHome, event => events.push(event as TeamEvent), signal);

    expect(result).toEqual({
      arguments: ['argument one', 'argument two'],
      submission: {
        teamId: 'baseline', finalOutput: 'argument two', totalTokens: 75,
        wallClockMs: 42, collaborationLift: 0,
        trace: [
          { round: 1, actor: 'e1', role: 'architect', action: 'planned', artifactSummary: 'strategy one', durationMs: 1 },
          { round: 1, actor: 'e2', role: 'implementer', action: 'implemented', artifactSummary: 'evidence one', durationMs: 2 },
          { round: 1, actor: 'e3', role: 'reviewer', action: 'finalized', artifactSummary: 'argument one', durationMs: 3 },
          { round: 2, actor: 'e1', role: 'architect', action: 'planned', artifactSummary: 'strategy two', durationMs: 4 },
          { round: 2, actor: 'e2', role: 'implementer', action: 'implemented', artifactSummary: 'evidence two', durationMs: 5 },
          { round: 2, actor: 'e3', role: 'reviewer', action: 'finalized', artifactSummary: 'argument two', durationMs: 6 },
        ],
      },
    });
    expect(calls.map(call => call.engine.id)).toEqual(['e1', 'e2', 'e3', 'e1', 'e2', 'e3']);
    for (const call of calls) {
      expect(call).toMatchObject({ mode: 'exec', cwd: agonHome, outputDir: agonHome, timeout: 10, signal });
      expect(call.systemPrompt).toBe('Return text only. Do not use tools, read files, or modify the workspace.');
      expect(call.prompt).toContain('rollback?');
      expect(call.prompt).toContain('"against"');
    }
    expect(calls[0].prompt).not.toContain('YOUR PREVIOUS ARGUMENTS');
    expect(calls[3].prompt).toContain('Round 1: argument one');
    expect(calls[1].prompt).toContain('strategy one');
    expect(calls[2].prompt).toContain('evidence one');
    expect(calls[2].prompt).toContain('strategy one');
    expect(calls[4].prompt).toContain('strategy two');
    expect(calls[5].prompt).toContain('evidence two');
    expect(calls[5].prompt).toContain('strategy two');
    expect(calls[0].prompt).toContain('red-team tribunal');
    expect(calls[3].prompt).toContain('red-team tribunal');
    expect(events).toEqual([1, 2].flatMap(round => [
      { type: 'team:round-start', data: { teamId: 'baseline', round } },
      { type: 'team:member-dispatch', data: { teamId: 'baseline', engineId: 'e1', role: 'architect' } },
      { type: 'team:member-dispatch', data: { teamId: 'baseline', engineId: 'e2', role: 'implementer' } },
      { type: 'team:member-done', data: { teamId: 'baseline', engineId: 'e2' } },
      { type: 'team:member-dispatch', data: { teamId: 'baseline', engineId: 'e3', role: 'reviewer' } },
      { type: 'team:round-done', data: { teamId: 'baseline', round } },
    ]));
  });

  it.each([0, 1, 2])('propagates Tribunal phase %i failure without later dispatch', async failedCall => {
    const team: TeamSpec = { teamId: 'failed', name: 'Failed', lineupKey: 'e1+e2',
      source: 'explicit', aggregateElo: 100,
      members: [{ engineId: 'e1', role: 'architect', weight: 0.6 },
        { engineId: 'e2', role: 'implementer', weight: 0.4 }] };
    let calls = 0;
    const adapter = { dispatch: async () => {
      if (calls++ === failedCall) throw new Error('phase failure');
      return { exitCode: 0, timedOut: false, stdout: 'argument', stderr: '', durationMs: 1 };
    } } as EngineAdapter;
    const events: TeamEvent[] = [];
    await expect(runTeamCoopTribunal(team, 'against', 'rollback?', 2, 'red-team',
      registryWithTwoEngines(), adapter, 10, agonHome, event => events.push(event as TeamEvent)))
      .rejects.toThrow('phase failure');
    expect(calls).toBe(failedCall + 1);
    expect(events.some(event => event.type === 'team:round-done')).toBe(false);
  });

  it('keeps Brainstorm fallback scores and emits judge failure before completion', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: TeamEvent[] = [];
    const adapter = { dispatch: async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
      if (options.prompt.includes('JUDGE')) throw new Error('judge failed');
      return { exitCode: 0, timedOut: false, stdout: 'Plain proposal', stderr: '', durationMs: 1 };
    } } as EngineAdapter;
    const result = await runTeamBrainstorm({
      question: 'migration?', membersPerSide: 1, composeMode: 'explicit',
      explicitTeams: [['e1'], ['e2']], engines: ['e1', 'e2'],
      registry: registryWithTwoEngines(), adapter, timeout: 10, outputDir: agonHome,
      onEvent: event => events.push(event as TeamEvent),
    });
    expect(Object.values(result.scorecards).map(card => card.score)).toEqual([3, 3]);
    expect(result.winnerTeamId).toBeNull();
    expect(events.slice(-5)).toEqual([
      { type: 'engine:failed', engineId: 'e1', data: { engineId: 'e1', phase: 'team-brainstorm-judge', error: 'judge failed' } },
      { type: 'team:score', data: { teamId: result.teams[0].teamId, score: 3 } },
      { type: 'team:score', data: { teamId: result.teams[1].teamId, score: 3 } },
      { type: 'team:winner', data: { winnerTeamId: null } },
      { type: 'team:match-done', data: {} },
    ]);
    expect(warning).toHaveBeenCalledWith('[agon] team brainstorm judge (e1) failed: judge failed');
  });

  it('preserves the capped Tribunal match envelope and exec-only routing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    const modes: string[] = [];
    const systemPrompts: string[] = [];
    const cwds: string[] = [];
    const events: TeamEvent[] = [];
    const result = await runTeamTribunal({
      question: 'rollback?', membersPerSide: 1, rounds: 9, mode: 'red-team',
      composeMode: 'explicit', explicitTeams: [['e1'], ['e2']], engines: ['e1', 'e2'],
      registry: registryWithTwoEngines(), adapter: recordingAdapter(modes, systemPrompts, cwds),
      timeout: 10, outputDir: agonHome,
      onEvent: (event: TeamEvent) => events.push(event),
    } as any);
    expect(modes).toHaveLength(9);
    expect(new Set(modes)).toEqual(new Set(['exec']));
    expect(systemPrompts.every((prompt) => prompt.includes('Do not use tools'))).toBe(true);
    expect(new Set(cwds)).toEqual(new Set([agonHome]));
    const [alpha, beta] = result.teams;
    expect(result.matchId).toMatch(/^[a-f0-9]{8}$/);
    expect(result).toEqual({
      matchId: result.matchId, mode: 'tribunal', task: 'rollback?',
      format: { membersPerSide: 1, label: '1v1' }, teams: [alpha, beta],
      winnerTeamId: alpha.teamId, timestamp: '2026-10-20T00:00:00.000Z',
      scorecards: {
        [alpha.teamId]: { teamId: alpha.teamId, score: 70, breakdown: { position: 'Defender' } },
        [beta.teamId]: { teamId: beta.teamId, score: 30, breakdown: { position: 'Attacker 1' } },
      },
      submissions: Object.fromEntries([alpha, beta].map((team, index) => [team.teamId, {
        teamId: team.teamId, finalOutput: 'Prompt-grounded team contribution',
        totalTokens: 0, wallClockMs: 0, collaborationLift: 0,
        trace: [1, 2].flatMap(round => ['planned', 'finalized'].map(action => ({
          round, actor: `e${index + 1}`, role: 'architect', action,
          artifactSummary: 'Prompt-grounded team contribution', durationMs: 1,
        }))),
      }])),
    });
    expect(events.slice(-4)).toEqual([
      { type: 'team:score', data: { teamId: alpha.teamId, score: 70 } },
      { type: 'team:score', data: { teamId: beta.teamId, score: 30 } },
      { type: 'team:winner', data: { winnerTeamId: alpha.teamId } },
      { type: 'team:match-done', data: {} },
    ]);
  });

  it('uses exec for the team-brainstorm judge as well as draft and synthesis prompts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    const modes: string[] = [];
    const cwds: string[] = [];
    const events: TeamEvent[] = [];
    const calls: Array<Parameters<EngineAdapter['dispatch']>[0]> = [];
    const adapter = {
      dispatch: async (options: Parameters<EngineAdapter['dispatch']>[0]) => {
        calls.push(options);
        modes.push(options.mode);
        cwds.push(options.cwd);
        const phase = options.prompt.includes('JUDGE') ? 'judge'
          : options.prompt.includes('TEAM SYNTHESIS') ? 'proposal' : 'draft';
        return { exitCode: 0, timedOut: false, stderr: '', durationMs: 1,
          stdout: phase === 'judge' ? 'SCORE_ALPHA: 70\nSCORE_BETA: 30\nWINNER: ALPHA'
            : `${options.engine.id} ${phase}` };
      },
    } as EngineAdapter;
    const result = await runTeamBrainstorm({
      question: 'migration?', membersPerSide: 1,
      composeMode: 'explicit', explicitTeams: [['e1'], ['e2']], engines: ['e1', 'e2'],
      registry: registryWithTwoEngines(), adapter,
      timeout: 10, outputDir: agonHome,
      onEvent: (event: TeamEvent) => events.push(event),
    } as any);
    expect(modes).toHaveLength(5);
    expect(new Set(modes)).toEqual(new Set(['exec']));
    expect(new Set(cwds)).toEqual(new Set([agonHome]));
    expect(calls[4].prompt).toContain('Question: migration?');
    expect(calls[4].prompt).toContain('## TEAM ALPHA PROPOSAL:\ne1 proposal');
    expect(calls[4].prompt).toContain('## TEAM BETA PROPOSAL:\ne2 proposal');
    const [alpha, beta] = result.teams;
    expect(result.matchId).toMatch(/^[a-f0-9]{8}$/);
    expect(result).toEqual({
      matchId: result.matchId, mode: 'brainstorm', task: 'migration?',
      format: { membersPerSide: 1, label: '1v1' }, teams: [alpha, beta],
      winnerTeamId: alpha.teamId, timestamp: '2026-10-20T00:00:00.000Z',
      scorecards: {
        [alpha.teamId]: { teamId: alpha.teamId, score: 70, breakdown: {} },
        [beta.teamId]: { teamId: beta.teamId, score: 30, breakdown: {} },
      },
      submissions: Object.fromEntries([alpha, beta].map((team, index) => [team.teamId, {
        teamId: team.teamId, finalOutput: `e${index + 1} proposal`,
        totalTokens: 0, wallClockMs: 0, collaborationLift: 0.5,
        trace: [
          { round: 1, actor: `e${index + 1}`, role: 'captain', action: 'implemented',
            artifactSummary: `e${index + 1} draft`, durationMs: 1 },
          { round: 2, actor: `e${index + 1}`, role: 'architect', action: 'finalized',
            artifactSummary: `e${index + 1} proposal`, durationMs: 1 },
        ],
      }])),
    });
    expect(events[0]).toEqual({ type: 'team:compose', data: { teams: [alpha, beta] } });
    expect(events.slice(-4)).toEqual([
      { type: 'team:score', data: { teamId: alpha.teamId, score: 70 } },
      { type: 'team:score', data: { teamId: beta.teamId, score: 30 } },
      { type: 'team:winner', data: { winnerTeamId: alpha.teamId } },
      { type: 'team:match-done', data: {} },
    ]);
  });
});
