import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { TeamMatchResult } from '@kernlang/agon-kernel';
import type { TeamBrainstormOptions } from '../../packages/forge/src/team-brainstorm.js';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { Dispatch } from '../../packages/cli/src/handlers/types.js';
import { runTeamBrainstormSession } from '../../packages/mod-team-brainstorm/src/session-workflow.js';
import { filterDefaultOrchestrationEngines } from '../../packages/cli/src/handlers/engine-filter.js';
import type { Json } from '@kernlang/agon-mod-api';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const effects = vi.hoisted(() => ({
  home: '', run: vi.fn(), execute: vi.fn(), append: vi.fn(), scan: vi.fn(), config: vi.fn(), ensure: vi.fn(),
}));
vi.mock('@kernlang/agon-core', async importOriginal => ({
  ...await importOriginal<typeof import('@kernlang/agon-core')>(),
  get RUNS_DIR() { return effects.home; },
  ensureAgonHome: effects.ensure, appendMessage: effects.append,
  scanProjectContext: effects.scan, loadConfig: effects.config,
  resolveWorkingDir: () => effects.home,
}));
vi.mock('@kernlang/agon-forge', () => ({ runTeamBrainstorm: effects.run }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', () => ({ executeProcessCesarRoute: effects.execute }));
import { handleTeamBrainstorm as legacyHandleTeamBrainstorm } from '../fixtures/team-brainstorm-session-legacy.js';
import { handleTeamBrainstorm as boundHandleTeamBrainstorm } from '../../packages/cli/src/handlers/team-brainstorm.js';

beforeEach(() => {
  vi.clearAllMocks();
  effects.home = setupTestAgonHome('team-session-baseline');
  effects.scan.mockReturnValue('project context');
  effects.config.mockReturnValue({ cesarEngine: 'judge', projectContext: 'project.md', contextFormat: 'kern' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); cleanupTestAgonHome(effects.home); });

function fixture() {
  const result = {
    teams: [
      { teamId: 'a', name: 'Alpha', members: [{ engineId: 'e1', role: 'architect' }] },
      { teamId: 'b', name: 'Beta', members: [{ engineId: 'e2', role: 'architect' }] },
    ],
    submissions: { a: { finalOutput: 'alpha proposal' }, b: { finalOutput: 'beta proposal' } },
    scorecards: { a: { score: 70 }, b: { score: 30 } }, winnerTeamId: 'a',
  } as unknown as TeamMatchResult;
  const dispatch = vi.fn();
  const setActiveAbort = vi.fn();
  const ctx = { activeEngines: () => ['e1', 'e2', 'opencode'], registry: {}, adapter: {},
    chatSession: { id: 'chat' }, setActiveAbort } as unknown as HandlerContext;
  effects.run.mockImplementation(async (options: TeamBrainstormOptions) => {
    options.onEvent?.({ type: 'team:compose', data: { teams: result.teams } });
    options.onEvent?.({ type: 'team:member-dispatch', data: { engineId: 'e1', role: 'architect' } });
    options.onEvent?.({ type: 'engine:failed', engineId: 'e2', data: { phase: 'draft' } });
    return result;
  });
  return { result, dispatch, setActiveAbort, ctx };
}

describe('Team Brainstorm CLI session binding', () => {
  it.each(['pre-aborted', 'executor-rejected'])('cleans the abort listener after %s', async mode => {
    const h = fixture();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const error = new Error('session rejected');
    if (mode === 'pre-aborted') controller.abort(error);
    else effects.execute.mockRejectedValueOnce(error);
    await expect(boundHandleTeamBrainstorm('Question', h.dispatch, h.ctx, 2, controller.signal)).rejects.toBe(error);
    if (mode === 'pre-aborted') expect(effects.execute).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(effects.append).not.toHaveBeenCalled();
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it.each(['duplicate', 'missing'])('rejects a %s run announcement without saving history', async mode => {
    const h = fixture();
    effects.execute.mockImplementationOnce(async (_route, _input, context) => {
      context.onWorkflowEvent({ type: 'team:run-started', data: { path: mode === 'missing' ? 42 : effects.home } });
      context.onWorkflowEvent({ type: 'team:run-started', data: { path: effects.home } });
      return { exitCode: 0, result: h.result };
    });
    await expect(boundHandleTeamBrainstorm('Question', h.dispatch, h.ctx)).rejects.toThrow(
      mode === 'duplicate' ? 'more than one run' : 'run path is missing');
    expect(effects.append).not.toHaveBeenCalled();
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it('does not present an ordinary failed command as a saved match', async () => {
    const h = fixture();
    effects.execute.mockResolvedValueOnce({ exitCode: 1, stderr: 'engine failure', result: h.result });
    await expect(boundHandleTeamBrainstorm('Question', h.dispatch, h.ctx)).rejects.toThrow('engine failure');
    expect(effects.append).not.toHaveBeenCalled();
    expect(h.dispatch.mock.calls.some(([event]) => event.type === 'verdict')).toBe(false);
  });

  it('shows the saved match but rejects settlement when its receipt could not be recorded', async () => {
    const h = fixture();
    const path = join(effects.home, 'saved-match');
    const message = `Match saved at ${path}; receipt unavailable`;
    effects.execute.mockImplementationOnce(async (_route, _input, context) => {
      context.onWorkflowEvent({ type: 'team:run-started', data: { path } });
      return { exitCode: 1, result: h.result, stderr: message, failure: {
        code: 'TEAM_BRAINSTORM_RECEIPT_FAILED', message, retryable: false, details: { runPath: path },
      } };
    });
    await expect(boundHandleTeamBrainstorm('Question', h.dispatch, h.ctx)).rejects.toThrow(message);
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'info', message: `Full results saved: ${path}` });
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'verdict', summary: 'alpha proposal' });
    expect(effects.append).toHaveBeenCalledTimes(2);
    expect(effects.append.mock.calls[1][1].content).toContain('receipt unavailable');
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it('uses the generation-selected executor and its actual run path', async () => {
    const h = fixture();
    const path = join(effects.home, 'canonical-run');
    effects.execute.mockImplementationOnce(async (_route, _input, context) => {
      context.onWorkflowEvent({ type: 'team:run-started', data: { path } });
      return { exitCode: 0, result: h.result };
    });
    await boundHandleTeamBrainstorm('Question', h.dispatch, h.ctx, 3);
    expect(effects.run).not.toHaveBeenCalled();
    expect(effects.execute).toHaveBeenCalledWith('team-brainstorm', {
      question: 'Question\n\n## PROJECT CONTEXT\nproject context', members: '3',
      engines: 'e1,e2', timeout: '120',
    }, expect.objectContaining({ cwd: effects.home, signal: expect.any(AbortSignal) }));
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'info', message: `Full results saved: ${path}` });
    expect(effects.append).toHaveBeenCalledTimes(2);
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it('forwards job cancellation and removes its listener after settlement', async () => {
    const h = fixture();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    effects.execute.mockImplementationOnce(async (_route, _input, context) => {
      controller.abort(new Error('job cancelled'));
      expect(context.signal.aborted).toBe(true);
      expect(context.signal.reason).toBe(controller.signal.reason);
      return { exitCode: 0, result: h.result };
    });
    await boundHandleTeamBrainstorm('Question', h.dispatch, h.ctx, 2, controller.signal);
    expect(effects.append).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it('refuses a successful result that has no run identity', async () => {
    const h = fixture();
    effects.execute.mockResolvedValueOnce({ exitCode: 0, result: h.result });
    await expect(boundHandleTeamBrainstorm('Question', h.dispatch, h.ctx)).rejects.toThrow('without its run path');
    expect(effects.append).not.toHaveBeenCalled();
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });
});

describe.each(['legacy', 'physical'] as const)('Team Brainstorm TUI baseline (%s)', implementation => {
  const handleTeamBrainstorm = implementation === 'legacy' ? legacyHandleTeamBrainstorm
    : async (question: string, dispatch: Dispatch, ctx: HandlerContext, members?: number) => {
      await runTeamBrainstormSession(question, members, new AbortController(), {
        ensureHome: effects.ensure,
        engines: () => {
          const all = ctx.activeEngines();
          const active = filterDefaultOrchestrationEngines(all);
          return { active, excluded: all.filter(id => !active.includes(id)) };
        },
        project: () => {
          const config = effects.config(effects.home);
          return { cwd: effects.home, judge: config.cesarEngine,
            context: effects.scan(effects.home, config.projectContext || undefined, config.contextFormat) };
        },
        dispatch: event => dispatch(event as Parameters<Dispatch>[0]),
        setActiveAbort: controller => ctx.setActiveAbort(controller),
        appendMessage: message => effects.append(ctx.chatSession, message),
      }, async (input, context) => {
        const outputDir = join(effects.home, `team-brainstorm-${Date.now()}`);
        context.onWorkflowEvent({ type: 'team:run-started', data: { path: outputDir } });
        const result = await effects.run({ question: input.question, membersPerSide: Number(input.members),
          registry: ctx.registry, adapter: ctx.adapter, timeout: Number(input.timeout),
          outputDir, signal: context.signal, onEvent: context.onWorkflowEvent });
        return { exitCode: 0, result: result as Json };
      });
    };
  it.each([undefined, 3])('preserves preparation, presentation, history and cleanup (members=%s)', async members => {
    const h = fixture();
    await handleTeamBrainstorm('Question', h.dispatch, h.ctx, members);
    const size = members ?? 2;
    expect(effects.scan).toHaveBeenCalledWith(effects.home, 'project.md', 'kern');
    expect(effects.run).toHaveBeenCalledTimes(1);
    expect(effects.run.mock.calls[0][0]).toMatchObject({
      question: 'Question\n\n## PROJECT CONTEXT\nproject context', membersPerSide: size,
      registry: h.ctx.registry, adapter: h.ctx.adapter, timeout: 120,
      outputDir: join(effects.home, 'team-brainstorm-1792454400000'),
    });
    expect(h.dispatch.mock.calls.map(([event]) => event)).toEqual([
      { type: 'info', message: 'Skipping disabled orchestration engines: opencode' },
      { type: 'header', title: `Team Brainstorm ${size}v${size}: Question` },
      { type: 'info', message: 'Engines: e1, e2' },
      { type: 'info', message: 'Cesar (judge): judge' },
      { type: 'spinner-start', message: 'Teams brainstorming...' },
      { type: 'info', message: 'Team Alpha: e1(architect)' },
      { type: 'info', message: 'Team Beta: e2(architect)' },
      { type: 'spinner-update', message: 'e1 (architect) working...' },
      { type: 'warning', message: 'e2 failed during draft' },
      { type: 'spinner-stop', message: 'Team brainstorm complete' },
      { type: 'header', title: 'Team Alpha — Alpha' },
      { type: 'info', message: 'e1(architect) | Score: 70' },
      { type: 'verdict', summary: 'alpha proposal' },
      { type: 'header', title: 'Team Beta — Beta' },
      { type: 'info', message: 'e2(architect) | Score: 30' },
      { type: 'verdict', summary: 'beta proposal' },
      { type: 'header', title: 'Winner: Alpha' },
      { type: 'info', message: `Full results saved: ${join(effects.home, 'team-brainstorm-1792454400000')}` },
      { type: 'spinner-stop' },
    ]);
    expect(effects.append.mock.calls).toEqual([
      [h.ctx.chatSession, { role: 'user', content: `[team-brainstorm:${size}v${size}] Question`, timestamp: '2026-10-20T00:00:00.000Z' }],
      [h.ctx.chatSession, { role: 'engine', engineId: 'team-brainstorm', content: 'Winner: Alpha', timestamp: '2026-10-20T00:00:00.000Z' }],
    ]);
    expect(h.setActiveAbort.mock.calls[0][0]).toBeInstanceOf(AbortController);
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it('keeps cancellation from displaying or saving a late result', async () => {
    const h = fixture();
    effects.run.mockImplementationOnce(async (options: TeamBrainstormOptions) => {
      h.setActiveAbort.mock.calls[0][0].abort();
      options.onEvent?.({ type: 'team:member-dispatch', data: { engineId: 'late', role: 'architect' } });
      return h.result;
    });
    await handleTeamBrainstorm('Question', h.dispatch, h.ctx);
    expect(h.dispatch.mock.calls.some(([event]) => event.type === 'verdict' || event.type === 'spinner-update')).toBe(false);
    expect(effects.append).not.toHaveBeenCalled();
    expect(h.dispatch).toHaveBeenLastCalledWith({ type: 'spinner-stop' });
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it('preserves the workflow error and clears active state', async () => {
    const h = fixture();
    const error = new Error('fixture failure');
    effects.run.mockRejectedValueOnce(error);
    await expect(handleTeamBrainstorm('Question', h.dispatch, h.ctx)).rejects.toBe(error);
    expect(effects.append).not.toHaveBeenCalled();
    expect(h.dispatch).toHaveBeenLastCalledWith({ type: 'spinner-stop' });
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });

  it.each(['empty', 'one-engine'])('rejects %s input before execution', async mode => {
    const h = fixture();
    if (mode === 'one-engine') h.ctx.activeEngines = () => ['e1'];
    await handleTeamBrainstorm(mode === 'empty' ? '' : 'Question', h.dispatch, h.ctx);
    expect(effects.run).not.toHaveBeenCalled();
    expect(effects.append).not.toHaveBeenCalled();
    expect(h.dispatch.mock.calls[0][0].type).toBe(mode === 'empty' ? 'warning' : 'error');
    expect(h.setActiveAbort).toHaveBeenLastCalledWith(null);
  });
});
