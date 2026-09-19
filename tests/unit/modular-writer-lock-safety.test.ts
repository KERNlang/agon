import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WriterFence } from '../../packages/mod-kernel/src/writer-lock.js';

describe('writer liveness fails closed', () => {
  it('treats an unexpected liveness error as possibly alive and refuses reclaim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-writer-liveness-'));
    const path = join(root, 'writer.json');
    const owner = await WriterFence.acquire(path, 'owner', { processIdentity: 'owner-process' });
    const kill = vi.spyOn(process, 'kill').mockImplementation((() => {
      throw Object.assign(new Error('unsupported liveness probe'), { code: 'EINVAL' });
    }) as typeof process.kill);
    try {
      await expect(WriterFence.recoverStale(path, 'recovery', { processIdentity: 'recovery-process' }))
        .rejects.toMatchObject({ code: 'MOD_HOST_BUSY' });
    } finally {
      kill.mockRestore();
      await owner.release();
    }
  });
});
