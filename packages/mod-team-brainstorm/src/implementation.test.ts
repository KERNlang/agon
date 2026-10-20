import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandContribution, IntentContribution, PlanStepContribution, Registrar } from '@kernlang/agon-mod-api';
import { validateContributionInput } from '@kernlang/agon-kernel';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import { createMod } from './implementation.js';
import { createTeamBrainstormHostServices } from './host.js';
import type { TeamBrainstormModServices } from './host.js';
import type { TeamBrainstormEvent } from './runtime.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../../../tests/helpers/agon-home.js';

let home: string;
afterEach(() => { cleanupTestAgonHome(home); });

async function setup(assertCurrent = () => {}) {
  home = setupTestAgonHome('physical-team-command');
  const controller = new AbortController();
  const context = { invocationId: 'i', cwd: home, platform: 'darwin-arm64' as const,
    signal: controller.signal, config: {} };
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({
    exitCode: 0, stdout: prompt.includes('BRAINSTORM JUDGE') ? 'SCORE_ALPHA: 60\nSCORE_BETA: 80\nWINNER: BETA'
      : engineId + (prompt.includes('TEAM SYNTHESIS') ? ' proposal' : ' draft'),
    stderr: '', timedOut: false, durationMs: 1,
  }));
  const record = vi.fn(async () => 'r');
  const finish = vi.fn();
  const writeArtifact = vi.fn();
  const registry = {
    get: (id: string) => ({ id, schemaVersion: 3, displayName: id, binary: process.execPath } as EngineDefinition),
    isAvailable: () => true,
  };
  const host = createTeamBrainstormHostServices({
    openRegistry: () => registry,
    createAdapter: () => ({ dispatch: options => dispatch(options.engine.id, options.prompt) } as EngineAdapter),
    captureAuthority: () => assertCurrent,
    loadConfig: () => ({ cesarEngine: 'd', ratingsEnabled: false }),
    partitionRoster: (_registry, requested) => ({ active: requested ?? ['a', 'b', 'c', 'd'], removed: [] }),
    classifyTask: () => 'other', loadConfidenceFloor: () => undefined,
    readRatings: () => ({ global: {}, byMode: { brainstorm: {} } }),
    updateTeamElo: vi.fn(), buildKernDraftPrompt, parseKernDraft,
  });
  const services = {
    identity: { id: 'agon.team-brainstorm', version: '1', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record }, permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() },
    engines: { listActive: vi.fn(async () => ['a', 'b', 'c', 'd']), dispatch },
    teamBrainstorm: host,
    runs: { start: vi.fn(() => ({ id: 'run', path: home, mode: 'team-brainstorm', startedAt: '2026-10-20T00:00:00Z' })),
      finish, writeArtifact },
  } as unknown as TeamBrainstormModServices;
  let command: CommandContribution | undefined;
  let intent: IntentContribution | undefined;
  let planStep: PlanStepContribution | undefined;
  const registrar = {
    command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; },
    intent: (value: IntentContribution) => { intent = value; return () => {}; },
    tool: () => () => {},
    planStep: (value: PlanStepContribution) => { planStep = value; return () => {}; },
  } as unknown as Registrar;
  const mod = await createMod(services);
  await mod.activate(registrar, services);
  return { command: command!, intent: intent!, planStep: planStep!, dispatch, record, finish, writeArtifact, context, services, controller };
}

it('rejects a malformed team member count before dispatch', async () => {
  const h = await setup();
  await expect(h.command.run({ question: 'Q', members: 'invalid' }, h.context))
    .rejects.toThrow('Team size must be a finite number');
  expect(h.dispatch).not.toHaveBeenCalled();
});

it('runs the parsed three-member team format', async () => {
  const h = await setup();
  const parsed = await h.intent.parse('/team-brainstorm 3v3 Q');
  expect(parsed).toEqual({ question: 'Q', membersPerSide: 3 });
  const out = await h.intent.run(parsed!, h.context);
  const result = JSON.parse((out as { stdout: string }).stdout);
  expect(result.teams.map((team: { members: unknown[] }) => team.members.length)).toEqual([3, 3]);
  expect(h.dispatch.mock.calls.filter(([, prompt]) => !prompt.includes('TEAM SYNTHESIS') && !prompt.includes('BRAINSTORM JUDGE'))).toHaveLength(6);
});

describe('physical team brainstorm', () => {
  it('announces the actual run before dispatch without changing the raw result', async () => {
    const h = await setup();
    const events: Array<{ event: TeamBrainstormEvent; dispatches: number }> = [];
    const context = { ...h.context, onWorkflowEvent: (event: TeamBrainstormEvent) => {
      events.push({ event, dispatches: h.dispatch.mock.calls.length });
    } };
    const output = await h.command.run({ question: 'Q' }, context);
    expect(events[0]).toEqual({ event: { type: 'team:run-started', data: { path: home } }, dispatches: 0 });
    expect(events.filter(({ event }) => event.type === 'team:run-started')).toHaveLength(1);
    const result = JSON.parse((output as { stdout: string }).stdout);
    expect(result).not.toHaveProperty('runPath');
    expect(result).not.toHaveProperty('path');
    expect(JSON.parse(h.writeArtifact.mock.calls[0][2])).toEqual(result);
  });

  it('honors cancellation from the run announcement before executing engines', async () => {
    const h = await setup();
    const error = new Error('cancelled at run start');
    const context = { ...h.context, onWorkflowEvent: (event: TeamBrainstormEvent) => {
      if (event.type === 'team:run-started') h.controller.abort(error);
    } };
    await expect(h.command.run({ question: 'Q' }, context)).rejects.toBe(error);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.writeArtifact).not.toHaveBeenCalled();
    expect(h.finish).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('advertises the result envelope returned by the plan step, not its request', async () => {
    const h = await setup();
    const success = await h.planStep.run({ question: 'Q' }, h.context);
    const failure = await h.planStep.run({ question: '' }, h.context);
    expect(validateContributionInput(h.planStep.resultSchema, success)).toBeNull();
    expect(validateContributionInput(h.planStep.resultSchema, failure)).toBeNull();
    for (const malformed of [{ question: 'Q' }, { exitCode: '0' }, { exitCode: 0, stdout: 42 },
      { exitCode: 0, result: [] }]) {
      expect(validateContributionInput(h.planStep.resultSchema, malformed)).not.toBeNull();
    }
  });

  it.each(['resolve', 'reject'] as const)(
    'reports revocation during failure-status persistence when the write does %s', async settlement => {
      const revoked = new Error('generation retired');
      let retired = false;
      const h = await setup(() => { if (retired) throw revoked; });
      h.writeArtifact.mockRejectedValueOnce(new Error('artifact unavailable'));
      h.finish.mockImplementationOnce(async () => {
        retired = true;
        if (settlement === 'reject') throw new Error('status unavailable');
      });
      await expect(h.command.run({ question: 'Q' }, h.context)).rejects.toBe(revoked);
      expect(h.finish).toHaveBeenCalledTimes(1);
      expect(h.record).not.toHaveBeenCalled();
    },
  );

  it.each(['start', 'artifact', 'finish', 'receipt'] as const)(
    'stops after authority is revoked during %s', async stage => {
      const error = new Error('generation retired');
      let retired = false;
      const h = await setup(() => { if (retired) throw error; });
      const revoke = async () => { retired = true; };
      if (stage === 'start') {
        vi.spyOn(h.services.runs!, 'start').mockImplementationOnce(async () => {
          await revoke();
          return { id: 'run', path: home, mode: 'team-brainstorm', startedAt: '2026-10-20T00:00:00Z' };
        });
      } else if (stage === 'artifact') h.writeArtifact.mockImplementationOnce(revoke);
      else if (stage === 'finish') h.finish.mockImplementationOnce(revoke);
      else h.record.mockImplementationOnce(async () => { await revoke(); return 'r'; });
      await expect(h.command.run({ question: 'Q' }, h.context)).rejects.toBe(error);
      expect(h.dispatch).toHaveBeenCalledTimes(stage === 'start' ? 0 : 7);
      expect(h.writeArtifact).toHaveBeenCalledTimes(stage === 'start' ? 0 : 1);
      expect(h.finish).toHaveBeenCalledTimes(['finish', 'receipt'].includes(stage) ? 1 : 0);
      expect(h.record).toHaveBeenCalledTimes(stage === 'receipt' ? 1 : 0);
    },
  );

  it('does not publish a failure status after cancellation during artifact writing', async () => {
    const h = await setup();
    const error = new Error('operator cancelled');
    h.writeArtifact.mockImplementationOnce(async () => { h.controller.abort(error); });
    await expect(h.command.run({ question: 'Q' }, h.context)).rejects.toBe(error);
    expect(h.finish).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('returns the saved match with a failed receipt status', async () => {
    const h = await setup();
    h.record.mockRejectedValueOnce(new Error('receipt unavailable'));
    const output = await h.command.run({ question: 'Q' }, h.context);
    expect(output).toMatchObject({ exitCode: 1, failure: {
      code: 'TEAM_BRAINSTORM_RECEIPT_FAILED', retryable: false,
      details: { runPath: home },
    } });
    const completed = output as { stdout: string; result: unknown; stderr: string };
    expect(completed.stderr).toContain('receipt unavailable');
    expect(completed.stderr).toContain(home);
    expect(JSON.parse(completed.stdout)).toEqual(completed.result);
    expect(JSON.parse(h.writeArtifact.mock.calls[0][2])).toEqual(completed.result);
    expect(validateContributionInput(h.planStep.resultSchema, output)).toBeNull();
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.finish.mock.calls[0][1]).toMatchObject({ ok: true });
  });

  it.each(['cancelled', 'retired'] as const)('does not return a saved match after receipt rejection and %s authority', async mode => {
    const error = new Error('invocation no longer current');
    let retired = false;
    const h = await setup(() => { if (retired) throw error; });
    h.record.mockImplementationOnce(async () => {
      if (mode === 'cancelled') h.controller.abort(error);
      else retired = true;
      throw new Error('receipt unavailable');
    });
    await expect(h.command.run({ question: 'Q' }, h.context)).rejects.toBe(error);
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.finish.mock.calls[0][1]).toMatchObject({ ok: true });
  });

  it('records an artifact failure once and preserves its identity', async () => {
    const h = await setup();
    const error = new Error('artifact unavailable');
    h.writeArtifact.mockRejectedValueOnce(error);
    await expect(h.command.run({ question: 'Q' }, h.context)).rejects.toBe(error);
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.finish.mock.calls[0][1]).toMatchObject({ ok: false, summary: error.message });
    expect(h.record).not.toHaveBeenCalled();
  });

  it('does not overwrite a completed run when receipt recording fails', async () => {
    const h = await setup();
    const error = new Error('receipt unavailable');
    h.record.mockRejectedValueOnce(error);
    expect(await h.command.run({ question: 'Q' }, h.context)).toMatchObject({ exitCode: 1 });
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.finish.mock.calls[0][1]).toMatchObject({ ok: true });
  });

  it('does not retry a failed success-status write as a workflow failure', async () => {
    const h = await setup();
    const error = new Error('status unavailable');
    h.finish.mockRejectedValueOnce(error);
    await expect(h.command.run({ question: 'Q' }, h.context)).rejects.toBe(error);
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.record).not.toHaveBeenCalled();
  });

  it('preserves both artifact and failure-status errors', async () => {
    const h = await setup();
    const artifactError = new Error('artifact unavailable');
    const statusError = new Error('status unavailable');
    h.writeArtifact.mockRejectedValueOnce(artifactError);
    h.finish.mockRejectedValueOnce(statusError);
    await expect(h.command.run({ question: 'Q' }, h.context)).rejects.toMatchObject({
      errors: [artifactError, statusError],
    });
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.finish.mock.calls[0][1]).toMatchObject({ ok: false, summary: artifactError.message });
    expect(h.record).not.toHaveBeenCalled();
  });

  it('composes two teams, drafts, synthesizes, judges and preserves the raw artifact', async () => {
    const h = await setup();
    const out = await h.command.run({ question: 'Q', members: '2' }, h.context);
    const result = JSON.parse((out as { stdout: string }).stdout);
    expect(result.mode).toBe('brainstorm');
    expect(result.teams).toHaveLength(2);
    const [alpha, beta] = result.teams;
    expect(alpha.members).toHaveLength(2);
    expect(beta.members).toHaveLength(2);
    expect(result.winnerTeamId).toBe(beta.teamId);
    expect(result.scorecards[alpha.teamId].score).toBe(60);
    expect(result.scorecards[beta.teamId].score).toBe(80);
    expect(result.submissions[alpha.teamId].trace).toHaveLength(3);
    expect(h.dispatch).toHaveBeenCalledTimes(7);
    expect(h.dispatch.mock.calls[6][0]).toBe('d');
    expect(h.record).toHaveBeenCalledWith('team-brainstorm', { winnerTeamId: beta.teamId, members: 2 });
    expect(JSON.parse(h.writeArtifact.mock.calls[0][2])).toEqual(result);
    expect(h.writeArtifact.mock.calls[0][1]).toBe('team-result.json');
    expect(h.finish.mock.calls[0][1]).toMatchObject({ ok: true, mode: 'team-brainstorm' });
  });

  it('rejects fewer than two engines', async () => {
    const h = await setup();
    expect(await h.command.run({ question: 'Q', engines: 'a' }, h.context)).toMatchObject({ exitCode: 1 });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('refuses execution without the canonical host rather than running a second algorithm', async () => {
    const h = await setup();
    delete (h.services as { teamBrainstorm?: unknown }).teamBrainstorm;
    expect(await h.command.run({ question: 'Q' }, h.context)).toMatchObject({ exitCode: 1 });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
});
