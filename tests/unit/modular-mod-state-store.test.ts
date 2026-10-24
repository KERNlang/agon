import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ModStateStore } from '../../packages/mod-kernel/src/mod-state-store.js';

describe('host-backed modular state', () => {
  it('survives a new store instance and isolates owner namespaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-state-'));
    await new ModStateStore(root, 'agon.jobs').write('jobs/one', { state: 'running' });
    expect(await new ModStateStore(root, 'agon.jobs').read('jobs/one')).toEqual({ state: 'running' });
    expect(await new ModStateStore(root, 'agon.goal').read('jobs/one')).toBeUndefined();
  });

  it('uses atomic replacement and leaves no temporary records after concurrent writers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-state-'));
    const store = new ModStateStore(root, 'agon.jobs');
    await Promise.all(Array.from({ length: 20 }, (_, value) => store.write('same', { value })));
    expect((await store.read<{ value: number }>('same'))?.value).toBeTypeOf('number');
    const files = await readdir(join(root, 'mod-state', 'agon.jobs'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
  });

  it('fails closed on corrupt or identity-swapped records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-mod-state-'));
    const store = new ModStateStore(root, 'agon.jobs');
    await store.write('same', { ok: true });
    const owner = join(root, 'mod-state', 'agon.jobs');
    const [name] = await readdir(owner);
    const path = join(owner, name!);
    const original = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...original, ownerId: 'agon.goal' }));
    await expect(store.read('same')).rejects.toThrow(/identity mismatch/);
  });
});
