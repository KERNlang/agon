import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
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
  const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; },
    intent: () => () => {}, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar;
  const mod = await createMod(services); await mod.activate(registrar, services);
  return { command: command!, dispatch, record };
}

describe('physical team tribunal', () => {
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
