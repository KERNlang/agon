import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api'; import { createMod } from './implementation.js';
const context = { invocationId: 'synthesis-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
async function setup(fail = new Set<string>()) { const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: fail.has(`${engineId}:${prompt.startsWith('SYNTHESIS DRAFT') ? 'draft' : 'other'}`) ? 1 : 0, stdout: prompt.startsWith('SYNTHESIS DRAFT') ? `${engineId} draft` : prompt.startsWith('TASK:') && prompt.includes('DRAFT BY') ? `${engineId} improved\n## REASONING\nbetter` : 'SCORE_1: 70\nCONFIDENCE_1: .7\nUNHANDLED_1: none\nSCORE_2: 90\nCONFIDENCE_2: .8\nUNHANDLED_2: edge\nWINNER: beta\nREASONING: strongest', stderr: 'failed', timedOut: false })); const record = vi.fn(async () => 'receipt'); const services = { identity: { id: 'agon.synthesis', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch } } as unknown as ModServices; let command: CommandContribution | undefined; const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, tool: () => () => {}, resultType: () => () => {}, config: () => () => {} } as unknown as Registrar; const mod = await createMod(services); await mod.activate(registrar, services); return { command: command!, dispatch, record, services }; }
describe('physical synthesis mod', () => {
  it.each([{ engines: [] }, { engines: ['alpha'] }])('rejects cancellation during engine discovery: $engines', async ({ engines }) => {
    const h = await setup();
    const controller = new AbortController();
    let finish!: (ids: string[]) => void;
    vi.mocked(h.services.engines.listActive!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.command.run({ prompt: 'Design', judge: 'missing' }, { ...context, signal: controller.signal });
    controller.abort(new Error('cancelled discovery'));
    const rejected = expect(pending).rejects.toThrow('cancelled discovery');
    finish(engines);
    await rejected;
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
  it.each(['before', 'draft', 'judge'])('stops cancelled synthesis before further effects: %s', async phase => {
    const h = await setup();
    const controller = new AbortController();
    const original = h.dispatch.getMockImplementation()!;
    h.dispatch.mockImplementation(async (engineId, prompt) => {
      const response = await original(engineId, prompt);
      if ((phase === 'draft' && prompt.startsWith('SYNTHESIS DRAFT'))
        || (phase === 'judge' && prompt.includes('Score correctness'))) {
        controller.abort(new Error('operator cancelled'));
      }
      return response;
    });
    if (phase === 'before') controller.abort(new Error('operator cancelled'));
    await expect(h.command.run({ prompt: 'Design', swaps: '0' }, { ...context, signal: controller.signal }))
      .rejects.toThrow('operator cancelled');
    expect(h.record).not.toHaveBeenCalled();
    if (phase === 'before') expect(h.dispatch).not.toHaveBeenCalled();
    if (phase === 'draft') expect(h.dispatch.mock.calls.some(([, prompt]) => prompt.includes('Score correctness'))).toBe(false);
  });
  it.each(['Entry 2', '2', 'BETA', '**Entry 2**', '**Entry 2**.', '"**Entry 2**."', 'Entry2'])('uses the judged winner for %s labels', async winner => {
    const h = await setup();
    const original = h.dispatch.getMockImplementation()!;
    h.dispatch.mockImplementation(async (engineId, prompt) => {
      const response = await original(engineId, prompt);
      return prompt.startsWith('TASK:') && !prompt.includes('DRAFT BY')
        ? { ...response, stdout: `SCORE_1: 10\nSCORE_2: 90\nWINNER: ${winner}\nREASONING: second is stronger` }
        : response;
    });
    const output = await h.command.run({ prompt: 'Design it', swaps: '0' }, context);
    expect(output).toMatchObject({ exitCode: 0, result: { winner: 'beta',
      scores: [{ engineId: 'alpha', score: 10 }, { engineId: 'beta', score: 90 }] } });
  });
  it('preserves markdown judge labels and fractional confidence', async () => {
    const h = await setup();
    const original = h.dispatch.getMockImplementation()!;
    h.dispatch.mockImplementation(async (engineId, prompt) => {
      const response = await original(engineId, prompt);
      return prompt.startsWith('TASK:') && !prompt.includes('DRAFT BY')
        ? { ...response, stdout: '**SCORE_1:** 10\n**SCORE_2:** 90\n**CONFIDENCE_2:** .8\n**WINNER:** Entry 2\n**REASONING:** second is stronger' }
        : response;
    });
    const output = await h.command.run({ prompt: 'Design it', swaps: '0' }, context);
    expect(output).toMatchObject({ exitCode: 0, result: { winner: 'beta',
      scores: [{ engineId: 'alpha', score: 10, breakdown: '' }, { engineId: 'beta', score: 90, confidence: .8, breakdown: '' }] } });
  });
  it('drafts, performs deterministic cross-pollination, and judges', async () => { const h = await setup(); const result = await h.command.run({ prompt: 'Design it', swaps: '1' }, context); const parsed = JSON.parse((result as { stdout: string }).stdout); expect(parsed).toMatchObject({ winner: 'beta', judgeReasoning: 'strongest', panelHealth: { degraded: false } }); expect(parsed.drafts).toHaveLength(2); expect(parsed.swaps).toHaveLength(2); expect(parsed.scores[1]).toMatchObject({ score: 90, confidence: .8, unhandled: 'edge' }); expect(h.record).toHaveBeenCalled(); });
  it('rejects an out-of-pool judge before dispatch', async () => { const h = await setup(); await expect(h.command.run({ prompt: 'Design', judge: 'ghost' }, context)).resolves.toMatchObject({ exitCode: 1 }); expect(h.dispatch).not.toHaveBeenCalled(); });
  it('fails when every draft fails', async () => { const h = await setup(new Set(['alpha:draft', 'beta:draft'])); await expect(h.command.run({ prompt: 'Design' }, context)).resolves.toMatchObject({ exitCode: 1 }); });
});
