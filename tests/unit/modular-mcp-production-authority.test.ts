import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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
