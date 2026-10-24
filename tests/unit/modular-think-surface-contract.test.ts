import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { assertContributionInput } from '../../packages/mod-kernel/src/index.js';
import { createMod } from '../../packages/mod-think/src/implementation.js';
import { createThinkHostServices } from '../../packages/mod-think/src/host.js';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';

describe('Think TUI domain contract', () => {
  it.each(['parsed', 'problem', 'both'] as const)('passes %s problem and flags through schema validation to the engine', async (shape) => {
    let command!: CommandContribution;
    const dispatch = vi.fn(async () => ({ engineId: 'fixture', exitCode: 0, timedOut: false,
      stdout: JSON.stringify({ thoughts: [], summary: 'fixture answer', openQuestions: [] }) }));
    const think = createThinkHostServices({openRegistry:()=>({get:id=>({id}) as EngineDefinition,resolveId:id=>id}),
      createAdapter:()=>({dispatch}) as unknown as EngineAdapter,selectEngines:()=>({activeEngineIds:['fixture'],defaultEngineIds:['fixture']}),
      captureAuthority:()=>()=>{},warn:vi.fn()});
    const services = { think, runs:{start:async()=>({id:'run',path:'/fixture/think',mode:'think',startedAt:'2026-01-01T00:00:00Z'}),finish:vi.fn()},
      engines: { dispatch:()=>{throw new Error('generic dispatch must not run');} }, receipts: { record: async () => 'fixture' } } as unknown as ModServices;
    const mod = await createMod(services);
    await mod.activate({ command: (surface, value) => { if (surface === 'tui') command = value; return () => {}; }, resultType: () => () => {} } as Registrar);
    const input = JSON.parse(JSON.stringify(command.parse!('/think inspect the architecture --steps 4 --strategy linear')));
    if (shape === 'problem') { input.problem = input.input; delete input.input; }
    if (shape === 'both') input.problem = 'not the selected input';
    expect(() => assertContributionInput(command.inputSchema!, input)).not.toThrow();
    const result = await command.run(input, { cwd: process.cwd(), invocationId: 'fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({prompt:expect.stringContaining('inspect the architecture'),outputDir:'/fixture/think'}));
    expect(input).toMatchObject({ [shape === 'problem' ? 'problem' : 'input']: 'inspect the architecture', steps: 4, strategy: 'linear' });
  });
});
