import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

const fixture = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { root: mkdtempSync(join(tmpdir(), 'agon-team-handler-')), phase: '', refused: false,
    calls: [] as string[], options: [] as Array<{ executionRefusal?: () => string | undefined }>,
    continuity: [] as string[],
    controller: null as AbortController | null,
    pids: [] as number[],
    fitnessResults: [] as number[], run: 0 };
});
vi.mock('@kernlang/agon-core', async original => {
  const core = await original<typeof import('@kernlang/agon-core')>();
  const effect = (phase: string, options?: { executionRefusal?: () => string | undefined }) => {
    fixture.calls.push(phase);
    if (options) fixture.options.push(options);
    if (fixture.phase === phase) fixture.refused = true;
    if (fixture.phase === `abort-${phase}`) fixture.controller?.abort();
  };
  return {
    ...core, RUNS_DIR: fixture.root, resolveWorkingDir: () => fixture.root,
    loadOrCreateActiveThread: () => {
      fixture.continuity.push('load');
      return { append: () => { fixture.continuity.push('append'); },
        save: async () => {
          fixture.continuity.push('save');
          const save = fixture.continuity.filter(call => call === 'save').length;
          if (fixture.phase === `save-${save}`) fixture.refused = true;
        } };
    },
    estimatedTokensToCost: (_engine: unknown, tokens: number) => tokens / 1000,
    AgentTeam: class {
      constructor(options: { executionRefusal?: () => string | undefined }) { fixture.options.push(options); }
      async initialize() { effect('initialize'); }
      getRunId() { return `fixture-${fixture.run}`; }
      cancel() {}
      async cleanup() { fixture.calls.push('cleanup'); }
      async step() {
        effect('step');
        return { members: ['one', 'two'].map(engineId => ({ engineId, worktreePath: fixture.root,
          error: null, stepResult: { response: 'answer', stopReason: 'completed', tokensUsed: 7, toolCalls: 0 } })),
        baseSha: 'fixture', durationMs: 1 };
      }
    },
    spawnWithTimeout: async (options: Parameters<typeof core.spawnWithTimeout>[0]) => {
      effect('fitness');
      const result = fixture.phase === 'abort-real-fitness'
        ? await core.spawnWithTimeout({ ...options, onSpawn: pid => {
          fixture.pids.push(pid);
          queueMicrotask(() => fixture.controller?.abort());
        } })
        : fixture.phase === 'slow-fitness' ? await core.spawnWithTimeout(options) : { exitCode: 0 };
      fixture.fitnessResults.push(result.exitCode);
      return result;
    },
    scoreAgentTeamResult: () => new Map(),
    determineWinner: () => ({ winner: 'one', bestScore: 10 }),
    worktreeChangedDiff: () => 'fixture diff',
    runAgentTeamSynthesis: async (options: { executionRefusal?: () => string | undefined }) => {
      effect('synthesis', options);
      return { ok: true, synthesizedDiff: 'refined diff', changed: true, responseExcerpt: 'two' };
    },
    runAgentInvestigateSynthesis: async (options: { executionRefusal?: () => string | undefined }) => {
      effect('synthesis', options);
      return { ok: true, report: 'refined answer' };
    },
    runPostSynthesisFitnessCheck: async (options: { executionRefusal?: () => string | undefined }) => {
      effect('refit', options); return { passed: true };
    },
  };
});

it.each([1, 2])('does not publish a team winner after continuity save %i revokes authority', async save => {
  fixture.phase = `save-${save}`;
  const events: Array<Record<string, any>> = [];
  const ctx = { config: { sessionContinuity: true }, activeEngines: () => ['one', 'two'], setActiveAbort: vi.fn(),
    registry: { get: (id: string) => ({ id, api: { baseUrl: 'https://example.invalid', model: 'fixture' } }) },
  } as unknown as HandlerContext;
  const result = await runAgentTeam('A sufficiently long fixture task to verify publication ordering',
    event => { events.push(event); }, ctx, { taskKind: 'investigate', synthesize: false,
      executionRefusal: () => fixture.refused ? 'Owner disabled' : undefined });
  expect(result?.status).toBe('failed');
  expect(fixture.continuity.filter(call => call === 'save')).toHaveLength(save);
  expect(events.some(event => ['success', 'engine-block', 'patch-review'].includes(event.type))).toBe(false);
  const completed = events.filter(event => event.type === 'agent-team-complete');
  expect(completed).toHaveLength(1);
  expect(completed[0].winner).toBeNull();
});
import { runAgentTeam } from '../../packages/cli/src/handlers/agent.js';

beforeEach(() => { fixture.run++; fixture.refused = false; fixture.calls = []; fixture.options = []; fixture.fitnessResults = []; fixture.continuity = []; fixture.controller = null; fixture.pids = []; });
afterAll(() => { rmSync(fixture.root, { recursive: true, force: true }); });

it.each(['entry', 'initialize', 'step', 'healthy'])('gates team continuity after %s', async phase => {
  fixture.phase = phase;
  fixture.refused = phase === 'entry';
  const ctx = { config: { sessionContinuity: true }, activeEngines: () => ['one', 'two'], setActiveAbort: vi.fn(),
    registry: { get: (id: string) => ({ id, api: { baseUrl: 'https://example.invalid', model: 'fixture' } }) },
  } as unknown as HandlerContext;
  const result = await runAgentTeam('A sufficiently long fixture task with continuity enabled', () => {}, ctx,
    { taskKind: 'investigate', synthesize: false, executionRefusal: () => fixture.refused ? 'Owner disabled' : undefined });
  expect(result?.status).toBe(phase === 'healthy' ? 'completed' : 'failed');
  expect(fixture.continuity).toEqual(phase === 'entry' ? [] : phase === 'healthy'
    ? ['load', 'append', 'save', 'append', 'save'] : ['load']);
});

it('allows a real fitness command to finish after 60 milliseconds', async () => {
  fixture.phase = 'slow-fitness';
  const ctx = { config: {}, activeEngines: () => ['one', 'two'], setActiveAbort: vi.fn(),
    registry: { get: (id: string) => ({ id, api: { baseUrl: 'https://example.invalid', model: 'fixture' } }) },
  } as unknown as HandlerContext;
  const code = "setTimeout(() => require('node:fs').writeFileSync('fitness-marker', 'done'), 150)";
  const result = await runAgentTeam('A fixture with a real local fitness command', () => {}, ctx,
    { synthesize: false, fitnessCmd: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}` });
  expect(fixture.fitnessResults).toEqual([0, 0]);
  expect(existsSync(join(fixture.root, 'fitness-marker'))).toBe(true);
  expect(result?.status).toBe('completed');
});

it('terminates real fitness processes before returning cancellation', async () => {
  fixture.phase = 'abort-real-fitness';
  fixture.controller = new AbortController();
  const ctx = { config: {}, activeEngines: () => ['one', 'two'], setActiveAbort: vi.fn(),
    registry: { get: (id: string) => ({ id, api: { baseUrl: 'https://example.invalid', model: 'fixture' } }) },
  } as unknown as HandlerContext;
  const command = `exec ${JSON.stringify(process.execPath)} -e ${JSON.stringify('setInterval(() => {}, 1000)')}`;
  const result = await runAgentTeam('A sufficiently long fixture task with real cancelled fitness processes', () => {}, ctx,
    { synthesize: false, fitnessCmd: command, parentSignal: fixture.controller.signal });
  expect(result?.status).toBe('cancelled');
  expect(fixture.pids).toHaveLength(2);
  expect(fixture.fitnessResults).toEqual([130, 130]);
  for (const pid of fixture.pids) {
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  }
  expect(fixture.calls.filter(call => call === 'cleanup')).toHaveLength(1);
});

it.each(['edit', 'investigate'].flatMap(kind =>
  (kind === 'edit' ? ['entry', 'initialize', 'step', 'fitness', 'synthesis', 'refit', 'healthy']
    : ['entry', 'initialize', 'step', 'synthesis', 'healthy']).map(phase => ({ kind, phase })),
))('stops later team effects after $phase ($kind)', async ({ kind, phase }) => {
  fixture.phase = phase;
  fixture.refused = phase === 'entry';
  const executionRefusal = () => fixture.refused ? 'Owner disabled' : undefined;
  const events: Array<{ type: string }> = [];
  const ctx = { config: {}, activeEngines: () => ['one', 'two'], setActiveAbort: vi.fn(),
    registry: { get: (id: string) => ({ id, api: { baseUrl: 'https://example.invalid', model: 'fixture' } }) },
  } as unknown as HandlerContext;
  const result = await runAgentTeam('A sufficiently long fixture task for two team members',
    event => { events.push(event); }, ctx, { taskKind: kind as 'edit' | 'investigate',
      fitnessCmd: 'fixture command never executed', executionRefusal });
  const outputDir = join(fixture.root, `team-agent-fixture-${fixture.run}`);
  expect(result?.status).toBe(phase === 'healthy' ? 'completed' : 'failed');
  expect(fixture.calls.filter(call => call === 'cleanup')).toHaveLength(phase === 'entry' ? 0 : 1);
  if (phase === 'healthy') {
    expect(existsSync(join(outputDir, 'synthesis.log'))).toBe(true);
    expect(fixture.options.length).toBe(kind === 'edit' ? 3 : 2);
    for (const options of fixture.options) expect(options.executionRefusal).toBe(executionRefusal);
  } else {
    expect(result?.summary).toContain('Owner disabled');
    expect(existsSync(outputDir)).toBe(false);
    expect(events.some(event => ['patch-review', 'success'].includes(event.type))).toBe(false);
    const expected = { entry: [], initialize: ['initialize'], step: ['initialize', 'step'],
      fitness: ['initialize', 'step', 'fitness'],
      synthesis: kind === 'edit' ? ['initialize', 'step', 'fitness', 'fitness', 'synthesis'] : ['initialize', 'step', 'synthesis'],
      refit: ['initialize', 'step', 'fitness', 'fitness', 'synthesis', 'refit'] };
    expect(fixture.calls.filter(call => call !== 'cleanup')).toEqual(expected[phase as keyof typeof expected]);
  }
});

it.each(['step', 'fitness', 'synthesis', 'refit'].flatMap(phase =>
  ['refuse', 'abort'].map(action => ({ phase, action })),
))('closes started team activity on $action during $phase', async ({ phase, action }) => {
  fixture.phase = action === 'abort' ? `abort-${phase}` : phase;
  fixture.controller = new AbortController();
  const events: Array<Record<string, any>> = [];
  const ctx = { config: {}, activeEngines: () => ['one', 'two'], setActiveAbort: vi.fn(),
    registry: { get: (id: string) => ({ id, api: { baseUrl: 'https://example.invalid', model: 'fixture' } }) },
  } as unknown as HandlerContext;
  const result = await runAgentTeam('A sufficiently long fixture task for terminal lifecycle checks',
    event => { events.push(event); }, ctx, {
      fitnessCmd: 'fixture command never executed', parentSignal: fixture.controller.signal,
      executionRefusal: () => fixture.refused ? 'Owner disabled' : undefined,
    });
  expect(result?.status).toBe(action === 'abort' ? 'cancelled' : 'failed');
  expect(result?.winnerId).toBeNull();
  expect(result?.patchAvailable).toBe(false);
  expect(events.some(event => ['patch-review', 'success'].includes(event.type))).toBe(false);
  for (const engineId of ['one', 'two']) {
    for (const type of ['agent-step-start', 'agent-step-end', 'streaming-end']) {
      expect(events.filter(event => event.type === type && event.engineId === engineId)).toHaveLength(1);
    }
  }
  const completed = events.filter(event => event.type === 'agent-team-complete');
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ winner: null, synthesizedPatch: null, synthesizedAnalysis: null });
  const synthesized = phase === 'synthesis' || phase === 'refit';
  expect(completed[0].synthesisRan).toBe(synthesized);
  expect(completed[0].synthesisCostUsd).toBeCloseTo(synthesized ? 0.803 : 0);
  expect(completed[0].teamCostUsd).toBeCloseTo(0.014 + (synthesized ? 0.803 : 0));
  expect(fixture.calls.filter(call => call === 'cleanup')).toHaveLength(1);
});
