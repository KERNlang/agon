import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

const context = { invocationId: 'i', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
async function setup() {
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: 0,
    stdout: prompt.includes('Evaluate strengths') ? 'SCORE_ALPHA: 85\nSCORE_BETA: 70\nWINNER: ALPHA' : `${engineId} argument`, stderr: '', timedOut: false }));
  const record = vi.fn(async () => 'r');
  const services = { identity: { id: 'agon.team-tribunal', version: '1', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn() },
    state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['a', 'b', 'c', 'd', 'judge']), dispatch } } as unknown as ModServices;
  let command: CommandContribution | undefined;
  let intent: IntentContribution | undefined;
  const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; },
    intent: (value: IntentContribution) => { intent = value; return () => {}; }, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar;
  const mod = await createMod(services); await mod.activate(registrar, services);
  return { command: command!, intent: intent!, dispatch, record };
}

describe('physical team tribunal', () => {
  it('runs the parsed team size and red-team mode', async () => {
    const h = await setup();
    const parsed = await h.intent.parse('/team-tribunal 3v3 red-team Q');
    expect(parsed).toEqual({ question: 'Q', tribunalMode: 'red-team', membersPerSide: 3 });
    const out = await h.intent.run(parsed!, context);
    const result = JSON.parse((out as { stdout: string }).stdout);
    expect(result.mode).toBe('red-team');
    expect(result.teams.map((team: { members: unknown[] }) => team.members.length)).toEqual([3, 3]);
    expect(h.dispatch.mock.calls.some(([, prompt]) => prompt.includes('TEAM POSITION: Defender'))).toBe(true);
    expect(h.dispatch.mock.calls.some(([, prompt]) => prompt.includes('TEAM POSITION: Attacker'))).toBe(true);
  });
  it('rejects a malformed member count before dispatch', async () => {
    const h = await setup();
    await expect(h.command.run({ question: 'Q', members: 'invalid' }, context))
      .rejects.toThrow('Team size must be a finite number');
    expect(h.dispatch).not.toHaveBeenCalled();
  });
  it('composes, argues multiple rounds, and judges', async () => {
    const h = await setup(); const out = await h.command.run({ question: 'Q', members: '2', rounds: '2' }, context);
    const result = JSON.parse((out as { stdout: string }).stdout);
    expect(result).toMatchObject({ winnerTeamId: 'ALPHA', rounds: 2, judgeConflict: false, panelHealth: { degraded: false } });
    expect(result.submissions.ALPHA.arguments).toHaveLength(2); expect(h.record).toHaveBeenCalled();
  });
  it('rejects invalid mode', async () => {
    const h = await setup(); await expect(h.command.run({ question: 'Q', mode: 'magic' }, context)).resolves.toMatchObject({ exitCode: 1 }); expect(h.dispatch).not.toHaveBeenCalled();
  });
});
