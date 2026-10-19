import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dynamicMcpToolOwnsExecution, listMcpTools } from '../../packages/mcp/src/agon-orchestration.js';
import {
  disposeMcpSurfaceAuthority,
  activeMcpSurfaceTools,
  initializeMcpSurfaceAuthority,
  invokeActiveMcpSurfaceTool,
  mcpSurfacePublicIds,
} from '../../packages/mcp/src/surface-authority.js';

afterEach(async () => {
  await disposeMcpSurfaceAuthority();
  delete process.env.AGON_MODULAR_HOST_ROOT;
  delete process.env.AGON_HOME;
});

describe('production MCP surface authority', () => {
  it('boots safe-mode authority without importing feature host services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-safe-import-'));
    vi.stubEnv('AGON_MODULAR_HOST_ROOT', join(root, 'host'));
    vi.stubEnv('AGON_MOD_SAFE_MODE', '0');
    vi.doMock('../../packages/mcp/src/first-party-services.js', () => {
      throw new Error('fixture MCP feature services unavailable');
    });
    vi.doMock('@kernlang/agon-core', () => {
      throw new Error('safe-mode authority must not import Core');
    });
    vi.resetModules();
    let authority: typeof import('../../packages/mcp/src/surface-authority.js') | undefined;
    try {
      authority = await import('../../packages/mcp/src/surface-authority.js');
      await expect(authority.initializeMcpSurfaceAuthority()).rejects.toMatchObject({
        cause: { message: 'fixture MCP feature services unavailable' },
      });
      vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
      await authority.initializeMcpSurfaceAuthority();
      expect(authority.mcpSurfacePublicIds().size).toBe(0);
      expect(authority.activeMcpSurfaceTools()).toEqual([]);
    } finally {
      await authority?.disposeMcpSurfaceAuthority();
      vi.doUnmock('../../packages/mcp/src/first-party-services.js');
      vi.doUnmock('@kernlang/agon-core');
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it.each(['cancel', 'dispose', 'replace', 'pointer', 'complete', 'import-error'] as const)('preserves authority on %s while loading invocation configuration', async action => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mcp-config-authority-'));
    process.env.AGON_HOME = join(root, 'home');
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'host');
    await initializeMcpSurfaceAuthority();
    let started!: () => void;
    let release!: () => void;
    const loading = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const loadConfig = vi.fn(() => ({}));
    vi.doMock('@kernlang/agon-core', async () => {
      started();
      await pending;
      if (action === 'import-error') throw new Error('fixture Core import failed');
      return { loadConfig };
    });
    try {
      const controller = new AbortController();
      const invocation = invokeActiveMcpSurfaceTool('RoomList', {}, controller.signal);
      const checked = action === 'complete'
        ? expect(invocation).resolves.toEqual([])
        : action === 'import-error'
          ? expect(invocation).rejects.toMatchObject({ cause: { message: 'fixture Core import failed' } })
          : expect(invocation).rejects.toThrow(action === 'cancel' ? /aborted/i : action === 'pointer' ? /canonical modular generation changed/ : /disposed or replaced/);
      await loading;
      if (action === 'cancel') controller.abort();
      if (action === 'dispose' || action === 'replace') await disposeMcpSurfaceAuthority();
      if (action === 'replace') {
        vi.stubEnv('AGON_MOD_SAFE_MODE', '1');
        await initializeMcpSurfaceAuthority();
      }
      if (action === 'pointer') {
        await mkdir(join(root, 'host'), { recursive: true });
        await writeFile(join(root, 'host', 'current-generation.json'), '{}');
      }
      release();
      await checked;
      expect(loadConfig).toHaveBeenCalledTimes(action === 'complete' ? 1 : 0);
    } finally {
      release();
      vi.doUnmock('@kernlang/agon-core');
      vi.unstubAllEnvs();
    }
  });

  it('boots physical packages before listing tools and retains executor-quality descriptions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-mcp-production-'));
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'absent-host');
    await initializeMcpSurfaceAuthority();
    const available = mcpSurfacePublicIds();
    const active = activeMcpSurfaceTools();
    const brainstormRuntime = active.find(({ name }) => name === 'Brainstorm');
    const brainstorm = listMcpTools(available, active).find(({ name }) => name === 'Brainstorm');
    expect(brainstorm?.description).toMatch(/multi-AI brainstorm/i);
    expect(brainstormRuntime?.ownerId).toBe('agon.brainstorm');
    expect(dynamicMcpToolOwnsExecution(brainstormRuntime)).toBe(true);
    expect(dynamicMcpToolOwnsExecution({ name: 'DeliverAnswer', description: '', inputSchema: {}, ownerId: 'agon.kernel' })).toBe(false);
    expect(available.size).toBe(listMcpTools(available, active).length);
  });

  it('invokes the physical owner through the generated MCP registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-mcp-invoke-'));
    process.env.AGON_HOME = join(root, 'home');
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'host');
    await initializeMcpSurfaceAuthority();
    await expect(invokeActiveMcpSurfaceTool('RoomList', {})).resolves.toEqual([]);
  });
});
