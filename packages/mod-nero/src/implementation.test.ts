import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';
const context = { invocationId: 'nero-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
async function setup(outputs: Record<string, string>) { const dispatch = vi.fn(async (engineId: string) => ({ engineId, exitCode: 0, stdout: outputs[engineId] ?? '', stderr: '', timedOut: false })); const rank = vi.fn(async () => [{ engineId: 'beta', reason: 'top-rated' as const, scope: 'critique' as const }, { engineId: 'alpha', reason: 'top-rated' as const, scope: 'global' as const }]); const record = vi.fn(async () => 'receipt'); const services = { identity: { id: 'agon.nero', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), rank, dispatch } } as unknown as ModServices; let command: CommandContribution | undefined; const registrar = { resultType: () => () => {}, command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: () => () => {}, tool: () => () => {} } as unknown as Registrar; const mod = await createMod(services); await mod.activate(registrar, services); return { command: command!, dispatch, rank, record }; }
describe('physical nero mod', () => {
  it.each([false, true])('retries a provider failure but not a later receipt failure (receiptFails=%s)', async receiptFails => {
    const h = await setup({ beta: 'Confidence: 80%\nVERDICT: SOUND' });
    h.dispatch.mockRejectedValueOnce(new Error('provider disconnected'));
    if (receiptFails) h.record.mockRejectedValue(new Error('receipt unavailable'));
    const result = await h.command.run({ decision: 'Ship now' }, context);
    expect(h.dispatch.mock.calls.map(call => call[0])).toEqual(['beta', 'beta']);
    expect(h.record).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ exitCode: receiptFails ? 1 : 0, result: {
      verdict: 'sound', attempts: [{ engineId: 'beta', attempt: 1, error: 'provider disconnected' }],
    } });
    if (receiptFails) expect(result.failure).toMatchObject({ code: 'NERO_RECEIPT_FAILED', retryable: false });
  });
  it('down-passes an unknown verdict without retrying that critic or recording a receipt', async () => {
    const h = await setup({ beta: 'No final verdict', alpha: 'Still no final verdict' });
    const result = await h.command.run({ decision: 'Ship now' }, context);
    expect(result.exitCode).toBe(1);
    expect(h.dispatch.mock.calls.map(call => call[0])).toEqual(['beta', 'alpha']);
    expect(h.record).not.toHaveBeenCalled();
  });
  it.each([false, true])('retains a completed verdict without retrying when receipt storage fails (quiet=%s)', async quiet => {
    const h = await setup({ beta: 'Confidence: 80%\nNo fatal issue\nVERDICT: SOUND' });
    h.record.mockRejectedValue(new Error('receipt disk unavailable'));
    const result = await h.command.run({ decision: 'Ship now', quiet }, context);
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.record).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      exitCode: 1,
      failure: { code: 'NERO_RECEIPT_FAILED', retryable: false },
      result: { ok: true, engineId: 'beta', verdict: 'sound', challengeConfidence: 80, attempts: [] },
    });
    expect(result.stderr).toContain('receipt disk unavailable');
    expect(result.failure?.message + '\n').toBe(result.stderr);
    expect(result.failure?.message).toContain('do not rerun the critique');
    expect(result.result).toEqual({
      ok: true, engineId: 'beta', reason: 'top-rated', scope: 'critique', verdict: 'sound',
      challengeConfidence: 80, challengeText: 'Confidence: 80%\nNo fatal issue\nVERDICT: SOUND', attempts: [],
    });
    if (quiet) expect(result.stdout).toBe('SOUND — beta\n');
    else expect(JSON.parse(result.stdout!)).toEqual(result.result);
  });
  it('uses the final verdict after an earlier quoted verdict', async () => {
    const h = await setup({ beta: 'Earlier finding: VERDICT: FLAWED\nConfidence: 80%\nverdict: sound' });
    const result = await h.command.run({ decision: 'Ship now' }, context);
    expect(result).toMatchObject({ exitCode: 0, result: { verdict: 'sound', challengeConfidence: 80 } });
    expect(h.dispatch).toHaveBeenCalledOnce();
  });
  it('uses host rating order and parses the required verdict', async () => { const h = await setup({ beta: 'Confidence: 25%\nChallenge\nVERDICT: FLAWED' }); const result = await h.command.run({ decision: 'Ship now' }, context); const parsed = JSON.parse((result as { stdout: string }).stdout); expect(parsed).toMatchObject({ ok: true, engineId: 'beta', reason: 'top-rated', scope: 'critique', verdict: 'flawed', challengeConfidence: 25 }); expect(h.rank).toHaveBeenCalled(); expect(h.record).toHaveBeenCalled(); });
  it('keeps text-only dispatch on the first attempt, retry and critic down-pass', async () => {
    const h = await setup({ alpha: 'Confidence: 80%\nNo fatal issue\nVERDICT: SOUND' });
    const result = await h.command.run({ decision: 'Ship now' }, context);
    const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed).toMatchObject({ ok: true, engineId: 'alpha', verdict: 'sound' });
    expect(h.dispatch.mock.calls.map((call) => call[0])).toEqual(['beta', 'beta', 'alpha']);
    for (const [index, engine] of ['beta', 'beta', 'alpha'].entries()) {
      expect(h.dispatch).toHaveBeenNthCalledWith(index + 1, engine, expect.any(String), context,
        expect.objectContaining({ textOnly: true }));
    }
  });
  it('rejects an inactive forced engine', async () => { const h = await setup({}); await expect(h.command.run({ decision: 'Ship', engine: 'ghost' }, context)).resolves.toMatchObject({ exitCode: 1 }); expect(h.dispatch).not.toHaveBeenCalled(); });
});
