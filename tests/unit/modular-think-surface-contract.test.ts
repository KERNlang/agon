import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { assertContributionInput } from '../../packages/mod-kernel/src/index.js';
import { createMod } from '../../packages/mod-think/src/implementation.js';
import { createThinkHostServices } from '../../packages/mod-think/src/host.js';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { runThinkSession } from '../../packages/mod-think/src/session-workflow.js';

describe('Think TUI domain contract', () => {
  it.each(['parsed', 'problem', 'both', 'failed', 'receipt'] as const)('passes %s problem and flags through schema validation to the engine', async (shape) => {
    let command!: CommandContribution;
    const dispatch = vi.fn(async () => ({ engineId: 'fixture', exitCode: shape === 'failed' ? 2 : 0, timedOut: false,
      stdout: JSON.stringify({ thoughts: [{ thoughtNumber: 1, totalThoughts: 1, thought: 'Inspect evidence', kind: 'analysis', nextThoughtNeeded: false }], summary: 'fixture answer', openQuestions: [] }) }));
    const think = createThinkHostServices({openRegistry:()=>({get:id=>({id}) as EngineDefinition,resolveId:id=>id}),
      createAdapter:()=>({dispatch}) as unknown as EngineAdapter,selectEngines:()=>({activeEngineIds:['fixture'],defaultEngineIds:['fixture']}),
      captureAuthority:()=>()=>{},warn:vi.fn()});
    const services = { think, runs:{start:async()=>({id:'run',path:'/fixture/think',mode:'think',startedAt:'2026-01-01T00:00:00Z'}),finish:vi.fn()},
      engines: { dispatch:()=>{throw new Error('generic dispatch must not run');} }, receipts: { record: async () => { if (shape === 'receipt') throw new Error('receipt disk full'); return 'fixture'; } } } as unknown as ModServices;
    const mod = await createMod(services);
    await mod.activate({ command: (surface, value) => { if (surface === 'tui') command = value; return () => {}; }, resultType: () => () => {} } as Registrar);
    const input = JSON.parse(JSON.stringify(command.parse!('/think inspect the architecture --steps 4 --strategy linear')));
    if (shape === 'problem') { input.problem = input.input; delete input.input; }
    if (shape === 'both') input.problem = 'not the selected input';
    expect(() => assertContributionInput(command.inputSchema!, input)).not.toThrow();
    const result = await command.run(input, { cwd: process.cwd(), invocationId: 'fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
    expect(result).toMatchObject(shape === 'receipt'
      ? { exitCode: 1, failure: { code: 'THINK_RECEIPT_FAILED' }, result: { ok: true, summary: 'fixture answer' } }
      : shape === 'failed'
      ? { exitCode: 1, stderr: 'fixture produced no usable thinking chain.\n', result: { ok: false } }
      : { exitCode: 0, result: { ok: true, summary: 'fixture answer' } });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({prompt:expect.stringContaining('inspect the architecture'),outputDir:'/fixture/think'}));
    expect(input).toMatchObject({ [shape === 'problem' ? 'problem' : 'input']: 'inspect the architecture', steps: 4, strategy: 'linear' });
    if (shape === 'receipt') {
      const appendMessage = vi.fn(), addResult = vi.fn(), recordRun = vi.fn(), display = vi.fn();
      await expect(runThinkSession(input, { cwd: process.cwd(), signal: new AbortController().signal }, {
        assertCurrent: () => {}, now: () => 1000, defaultEngine: () => 'fixture', dispatch: display,
        scheduleEvery: () => () => {}, appendMessage, addResult, recordRun, track: vi.fn(),
      }, async () => result as import('@kernlang/agon-mod-api').CommandResult)).rejects.toThrow('receipt disk full');
      expect(appendMessage).toHaveBeenCalledTimes(2);
      expect(addResult).toHaveBeenCalledOnce();
      expect(recordRun).not.toHaveBeenCalled();
      expect(display).toHaveBeenCalledWith(expect.objectContaining({ type: 'engine-block', content: 'fixture answer' }));
      expect(display).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: expect.stringContaining('/fixture/think') }));
    }
  });
});
