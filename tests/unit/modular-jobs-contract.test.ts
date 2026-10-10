import { describe, expect, it, vi } from 'vitest';
import type { ModServices, Registrar, ToolContribution } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-jobs/src/implementation.js';
import JOB_TOOLS from '../fixtures/modular-jobs-legacy-tools.json';

const ids: Record<string, string> = {
  JobCancel: 'mcpTools:0010', JobEvents: 'mcpTools:0011', JobList: 'mcpTools:0012',
  JobResult: 'mcpTools:0013', JobStatus: 'mcpTools:0014', JobSubmit: 'mcpTools:0015',
};

describe('physical Jobs mod preserves the MCP workflow contract', () => {
  it.each(['dispose', 'abort'] as const)('rejects transport completion after %s', async action => {
    const tools = new Map<string, ToolContribution>();
    const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
      if (method === 'tool' && args[0] === 'mcp') { const tool = args[1] as ToolContribution; tools.set(tool.id, tool); }
      return () => {};
    } }) as Registrar;
    let release!: (value: string) => void;
    const services = { jobs: { runTool: vi.fn(() => new Promise<string>(resolve => { release = resolve; })) } } as unknown as ModServices;
    const dispose = await (await createMod(services)).activate(registrar, services);
    const controller = new AbortController();
    const pending = tools.get(ids.JobList)!.run({}, { invocationId: 'fixture', cwd: process.cwd(), platform: 'darwin-arm64', config: {}, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow(action === 'dispose' ? /closed/ : /abort/i);
    if (action === 'dispose') await dispose?.(); else controller.abort();
    release('[]');
    await rejected;
    if (action === 'abort') await dispose?.();
  });
  it.each(JOB_TOOLS)('$name preserves the established input schema', async legacy => {
    const tools = new Map<string, ToolContribution>();
    const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
      if (method === 'tool' && args[0] === 'mcp') {
        const tool = args[1] as ToolContribution;
        tools.set(tool.id, tool);
      }
      return () => {};
    } }) as Registrar;
    const services = { engines: { dispatch: vi.fn() } } as unknown as ModServices;
    const dispose = await (await createMod(services)).activate(registrar, services);
    try {
      expect(tools.get(ids[legacy.name])?.inputSchema).toEqual(legacy.inputSchema);
    } finally { await dispose?.(); }
  });
});
