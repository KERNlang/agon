import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableModHost } from '../../packages/mod-kernel/src/durable-host.js';
import { hostLock } from '../helpers/modular-host.js';

describe('transaction receipt immutability', () => {
  it('creates read-only evidence and refuses replacement through the exclusive write contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-receipt-immutable-'));
    const host = new DurableModHost(root, { kernelVersion: '1.0.0' });
    await host.commitGeneration({ operation: 'install', lock: hostLock(), desiredState: {}, installedIndex: {} });
    const [name] = await readdir(host.paths.receipts);
    const path = join(host.paths.receipts, name!);
    expect((await stat(path)).mode & 0o777).toBe(0o400);
    await expect(writeFile(path, 'replacement', { flag: 'wx' })).rejects.toMatchObject({ code: 'EEXIST' });
  });
});
