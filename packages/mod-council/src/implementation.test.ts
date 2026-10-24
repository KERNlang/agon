import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod, runCouncil } from './implementation.js';
import { withCouncilFixtureHost } from '../../../tests/fixtures/modular-council-host.js';
const context = { invocationId: 'council-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
async function setup() { const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: 0, stdout: prompt.includes('Synthesize the advisors') ? 'RECOMMENDATION\nConfidence: 73%\nShip with a kill-switch.' : prompt.includes('Frame this') ? 'DECISION: ship\nOPTIONS: yes/no' : `${engineId} analysis`, stderr: '', timedOut: false })); const record = vi.fn(async () => 'receipt'); const services = { identity: { id: 'agon.council', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta', 'gamma']), rank: vi.fn(async () => [{ engineId: 'gamma', reason: 'top-rated', scope: 'tribunal' }, { engineId: 'alpha', reason: 'top-rated', scope: 'global' }, { engineId: 'beta', reason: 'random', scope: null }]), dispatch } } as unknown as ModServices; let command: CommandContribution | undefined; const registrar = { resultType: () => () => {}, command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar; const hosted = withCouncilFixtureHost(services); const mod = await createMod(hosted); await mod.activate(registrar, hosted); return { command: command!, dispatch, record, services: hosted }; }
describe('physical council mod', () => {
  it.each(['role', 'critique'] as const)('marks a successful verdict degraded after exhausted %s retries', async phase => {
    const h = await setup();
    const original = h.dispatch.getMockImplementation()!;
    h.dispatch.mockImplementation(async (engineId, prompt) => {
      const target = engineId === 'alpha' && (phase === 'role'
        ? prompt.includes('Respond ONLY from your role') : prompt.includes('Critique ONE peer'));
      return target ? { engineId, exitCode: 2, stdout: '', stderr: 'advisor unavailable', timedOut: false }
        : original(engineId, prompt);
    });
    const output = await h.command.run({ question: 'Q', json: true }, context);
    expect(h.dispatch.mock.calls.filter(([id, prompt]) => id === 'alpha' && (phase === 'role'
      ? prompt.includes('Respond ONLY from your role') : prompt.includes('Critique ONE peer')))).toHaveLength(2);
    expect(output).toMatchObject({ exitCode: 0, result: { ok: true, degraded: true } });
    expect(h.record).toHaveBeenCalledWith('council', expect.objectContaining({ degraded: true }));
  });
  it.each([false, true])('gives JSON precedence over quiet outside CLI, receipt failure: %s', async receiptFails => {
    const h = await setup();
    if (receiptFails) h.record.mockRejectedValueOnce(new Error('receipt unavailable'));
    const output = await runCouncil({ question: 'Q', json: true, quiet: true }, context, h.services);
    expect(output.exitCode).toBe(receiptFails ? 1 : 0);
    expect(JSON.parse(output.stdout!)).toMatchObject({ ok: true, confidence: 73 });
    expect(output.result).toEqual(JSON.parse(output.stdout!));
  });
  it('keeps quiet-only non-CLI output as plain verdict text', async () => {
    const h = await setup();
    const output = await runCouncil({ question: 'Q', quiet: true }, context, h.services);
    expect(output.stdout).toBe('RECOMMENDATION\nConfidence: 73%\nShip with a kill-switch.\n');
  });
  it('retains the completed verdict and run when its receipt cannot be saved', async () => {
    const h = await setup();
    const finish = vi.spyOn(h.services.runs!, 'finish');
    h.record.mockRejectedValueOnce(new Error('receipt disk full'));
    const output = await h.command.run({ question: 'Q', json: true }, context);
    expect(output).toMatchObject({ exitCode: 1, result: { ok: true, confidence: 73 },
      failure: { code: 'COUNCIL_RECEIPT_FAILED', retryable: false, details: { runPath: expect.any(String) } },
      stderr: expect.stringContaining('Inspect the saved run before retrying.') });
    expect(JSON.parse((output as { stdout: string }).stdout)).toMatchObject({ ok: true, confidence: 73 });
    expect(finish).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: true }), context);
    expect(h.dispatch).toHaveBeenCalledTimes(6);
  });
  it.each(['panel', 'chair'] as const)('does not replace an empty resolved %s with defaults', async target => {
    const h = await setup();
    h.services.engines.resolveRequested = vi.fn(async ids => target === 'panel' || ids.length === 1 ? [] : [...ids]);
    const start = vi.spyOn(h.services.runs!, 'start');
    const result = await runCouncil({ question: 'Q', engines: 'alpha,beta', ...(target === 'chair' ? { chairman: 'gamma' } : {}) }, context, h.services);
    expect(result.exitCode).toBe(1);
    expect(start).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });
  it('fails before dispatch or run creation when host capabilities are missing', async () => {
    const h = await setup();
    Object.assign(h.services, { council: undefined });
    const start = vi.spyOn(h.services.runs!, 'start');
    expect(await h.command.run({ question: 'Q' }, context)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('host capabilities') });
    expect(start).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });
  it('adds an available forced chair outside the requested pool', async () => {
    const h = await setup();
    expect(await h.command.run({ question: 'Q', engines: 'alpha,beta', chairman: 'gamma', json: true }, context))
      .toMatchObject({ exitCode: 0, result: { chairmanId: 'gamma', chairmanReason: 'forced' } });
  });
  it('does not issue success when run finalization fails', async () => {
    const h = await setup();
    vi.spyOn(h.services.runs!, 'finish').mockRejectedValue(new Error('disk unavailable'));
    await expect(h.command.run({ question: 'Q' }, context)).rejects.toThrow('disk unavailable');
    expect(h.record).not.toHaveBeenCalled();
  });
  it('records failed verdicts without issuing success receipts', async () => {
    const h = await setup(); const finish = vi.spyOn(h.services.runs!, 'finish');
    h.dispatch.mockImplementation(async engineId => ({ engineId, exitCode: 2, stdout: '', stderr: 'failed', timedOut: false }));
    expect(await h.command.run({ question: 'Q', json: true }, context)).toMatchObject({ exitCode: 1, result: { ok: false } });
    expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), context);
    expect(h.record).not.toHaveBeenCalled();
  });
  it('promotes an advisor when the seated chair fails, preserving the legacy fallback', async () => {
    const h = await setup();
    h.dispatch.mockImplementation(async (engineId: string, prompt: string) => ({
      engineId, exitCode: engineId === 'gamma' ? 2 : 0,
      stdout: engineId === 'gamma' ? '' : prompt.includes('Synthesize')
        ? 'RECOMMENDATION\nConfidence: 73%\nUse the verified fallback.' : `${engineId} analysis`,
      stderr: engineId === 'gamma' ? 'chair unavailable' : '', timedOut: false,
    }));
    const result = await h.command.run({ json: true, question: 'Ship?' }, context);
    expect(result).toMatchObject({ exitCode: 0, result: {
      ok: true, chairmanId: 'gamma', actingChairmanId: 'alpha', degraded: true,
    } });
    expect(h.dispatch.mock.calls.some(([engineId, prompt]) => engineId === 'alpha' && prompt.includes('Synthesize'))).toBe(true);
  });
  it('runs brief, advisor, directed-critique, and chairman phases', async () => { const h = await setup(); const result = await h.command.run({ json: true, question: 'Ship?' }, context); const parsed = JSON.parse((result as { stdout: string }).stdout); expect(parsed).toMatchObject({ ok: true, chairmanId: 'gamma', chairmanReason: 'top-rated', confidence: 73, degraded: false }); expect(parsed.seats).toHaveLength(2); expect(parsed.seats.every((seat: { critique: string }) => seat.critique)).toBe(true); expect(h.dispatch).toHaveBeenCalledTimes(6); expect(h.record).toHaveBeenCalled(); });
  it('honors a forced chair and reports the resulting thin panel', async () => { const h = await setup(); const result = await h.command.run({ json: true, question: 'Ship?', engines: 'alpha,beta', chairman: 'alpha' }, context); const parsed = JSON.parse((result as { stdout: string }).stdout); expect(parsed).toMatchObject({ chairmanId: 'alpha', chairmanReason: 'forced', degraded: true }); expect(parsed.seats).toHaveLength(1); });
  it('rejects a one-engine council without dispatch', async () => { const h = await setup(); const result = await h.command.run({ json: true, question: 'Ship?', engines: 'alpha' }, context); expect(result).toMatchObject({ exitCode: 1 }); expect(h.dispatch).not.toHaveBeenCalled(); });
});
