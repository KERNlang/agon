import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@kernlang/agon-mod-api';
import type { AgonModFactory, ModServices, Registrar, ToolContribution } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-brainstorm/src/implementation.js';
import type { BrainstormModServices } from '../../packages/mod-brainstorm/src/host.js';
import { dispatchSeatWithRetry } from '@kernlang/agon-support-panel';
import { buildKernDraftPrompt, parseKernDraft } from '@kernlang/protocol';
import { createMod as campfire } from '../../packages/mod-campfire/src/implementation.js';
import { createMod as tribunal } from '../../packages/mod-tribunal/src/implementation.js';
import { createMod as nero } from '../../packages/mod-nero/src/implementation.js';
import { createMod as synthesis } from '../../packages/mod-synthesis/src/implementation.js';
import { createMod as forge } from '../../packages/mod-forge/src/implementation.js';
import { createMod as review } from '../../packages/mod-review/src/implementation.js';
import { createMod as rag } from '../../packages/mod-rag/src/implementation.js';
import { createMod as plan } from '../../packages/mod-plan/src/implementation.js';
import { createMod as jobs } from '../../packages/mod-jobs/src/implementation.js';
import { createMod as agent } from '../../packages/mod-agent/src/implementation.js';
import { createMod as pipeline } from '../../packages/mod-pipeline-orchestration/src/implementation.js';

const context = { cwd: process.cwd(), invocationId: 'fixture', platform: 'darwin-arm64' as const,
  signal: new AbortController().signal, config: {} };

async function brainstorm(dispatch: ModServices['engines']['dispatch']) {
  let tool!: ToolContribution;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'tool' && args[0] === 'mcp') tool = args[1] as ToolContribution;
    return () => {};
  } }) as Registrar;
  const services = {
    engines: { dispatch }, receipts: { record: async () => 'fixture' },
    runs: { start: async () => ({ path: '/fixture', startedAt: 'fixture' }), finish: async () => {} },
    brainstorm: { open: () => ({
      readRatings: () => ({ byMode: { brainstorm: {} }, global: {} }),
      seed: () => {}, preflight: async (options: { engines: string[] }) => ({ healthy: options.engines, skipped: [] }),
      createLogger: () => ({ log: () => {} }),
      buildPrompt: buildKernDraftPrompt, parseDraft: parseKernDraft,
      deduplicate: async () => ({ groups: null, status: { status: 'not-needed' } }),
      updateRatings: () => {},
      selectSeat: (_options: unknown, engineId: string) => (prompt: string, systemPrompt: string) =>
        dispatchSeatWithRetry({ dispatch: () => dispatch(engineId, prompt, context) } as never,
          { engineId, engine: { id: engineId }, prompt, systemPrompt } as never),
      selectWinner: (_options: unknown, engineId: string) => (prompt: string) => dispatch(engineId, prompt, context),
    }) },
  } as unknown as BrainstormModServices;
  await (await createMod(services)).activate(registrar);
  return tool;
}

describe('MCP command failure preservation', () => {
  it.each<[string, AgonModFactory, string]>([
    ['plan', plan, 'mcpTools:0018'], ['jobs', jobs, 'mcpTools:0014'],
    ['agent', agent, 'mcpTools:0000'], ['pipeline validation only', pipeline, 'mcpTools:0016'],
  ])('%s preserves failed command identity', async (_, factory, id) => {
    let selected!: ToolContribution;
    const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
      if (method === 'tool' && args[0] === 'mcp' && (args[1] as ToolContribution).id === id) selected = args[1] as ToolContribution;
      return () => {};
    } }) as Registrar;
    const dispatch = vi.fn(async () => { throw new Error('provider must not run'); });
    const dispose = await (await factory({ engines: { dispatch },
      receipts: { record: async () => 'fixture' } } as unknown as ModServices)).activate(registrar);
    try {
      expect(selected).toBeDefined();
      // Empty input stops at validation/missing job; no pipeline stages execute.
      await expect(selected.run({}, context)).rejects.toBeInstanceOf(CommandExecutionError);
      expect(dispatch).not.toHaveBeenCalled();
    } finally { await dispose(); }
  });
  it.each<[string, AgonModFactory]>([['campfire', campfire], ['tribunal', tribunal],
    ['nero', nero], ['synthesis', synthesis], ['forge', forge], ['review', review], ['rag', rag]])(
    '%s preserves rejected command outcomes', async (_, factory) => {
      const tools: ToolContribution[] = [];
      const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
        if (method === 'tool' && args[0] === 'mcp') tools.push(args[1] as ToolContribution);
        return () => {};
      } }) as Registrar;
      const dispatch = vi.fn(async () => { throw new Error('provider must not run'); });
      await (await factory({ permissions: { check: async () => 'deny' }, engines: { dispatch },
        receipts: { record: async () => 'fixture' } } as unknown as ModServices)).activate(registrar);
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) await expect(tool.run({}, context)).rejects.toBeInstanceOf(CommandExecutionError);
      expect(dispatch).not.toHaveBeenCalled();
    });
  it('rejects an all-failed panel instead of returning a successful tool payload', async () => {
    const tool = await brainstorm(vi.fn(async () => ({ exitCode: 1, stderr: 'fixture failed' })));
    await expect(tool.run({ question: 'fixture', engines: 'a,b' }, context)).rejects.toThrow('no engine produced a usable draft');
  });
  it('retains a degraded successful panel and its failed seats', async () => {
    const tool = await brainstorm(vi.fn(async (engine) => engine === 'a'
      ? { exitCode: 0, stdout: 'fixture answer' } : { exitCode: 1, stderr: 'fixture failed' }));
    await expect(tool.run({ question: 'fixture', engines: 'a,b' }, context)).resolves.toMatchObject({
      winner: 'a', panelHealth: { requested: 2, responded: 1, degraded: true,
        notes: [expect.stringContaining('b error → retry error, dropped')],
        banner: expect.stringContaining('1/2 responded') },
    });
  });
});
