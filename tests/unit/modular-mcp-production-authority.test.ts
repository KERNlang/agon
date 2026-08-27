import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { listMcpTools } from '../../packages/mcp/src/agon-orchestration.js';
import {
  disposeMcpSurfaceAuthority,
  initializeMcpSurfaceAuthority,
  mcpSurfacePublicIds,
} from '../../packages/mcp/src/surface-authority.js';

afterEach(async () => {
  await disposeMcpSurfaceAuthority();
  delete process.env.AGON_MODULAR_HOST_ROOT;
});

describe('production MCP surface authority', () => {
  it('boots physical packages before listing tools and retains executor-quality descriptions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-mcp-production-'));
    process.env.AGON_MODULAR_HOST_ROOT = join(root, 'absent-host');
    await initializeMcpSurfaceAuthority();
    const available = mcpSurfacePublicIds();
    const brainstorm = listMcpTools(available).find(({ name }) => name === 'Brainstorm');
    expect(brainstorm?.description).toMatch(/multi-AI brainstorm/i);
    expect(available.size).toBe(listMcpTools(available).length);
  });
});
