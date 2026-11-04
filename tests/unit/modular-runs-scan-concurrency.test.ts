import { expect, it, vi } from 'vitest';
import { unlink } from 'node:fs/promises';

const fixture = vi.hoisted(() => ({ active: 0, peak: 0, completed: 0 }));
vi.mock('node:fs', async original => ({
  ...await original<typeof import('node:fs')>(),
  readFileSync: () => '0', writeFileSync: () => {},
}));
vi.mock('../../packages/support-persistence/src/file-lock.js', () => ({
  withFileLock: (_path: string, action: () => unknown) => action(),
}));
vi.mock('node:fs/promises', () => ({
  readdir: async () => [...Array.from({ length: 65 }, (_, index) => `${index}.json`), '.prune-stamp'],
  stat: async (path: string) => {
    fixture.active++;
    fixture.peak = Math.max(fixture.peak, fixture.active);
    try {
      await Promise.resolve();
      if (path.endsWith('/1.json')) throw new Error('vanished');
      return { isFile: () => !path.endsWith('/2.json'), mtimeMs: 0 };
    } finally { fixture.active--; fixture.completed++; }
  },
  unlink: vi.fn(async () => { throw new Error('small scan must not delete'); }),
}));

import { RunsStore } from '../../packages/support-persistence/src/runs-store.js';

it('bounds concurrent stat work without serializing every filesystem round trip', async () => {
  const store = new RunsStore();
  expect(await store.maybePrune({ force: true })).toMatchObject({ reason: 'within-policy' });
  expect(fixture.completed).toBe(65);
  expect(fixture.active).toBe(0);
  expect(fixture.peak).toBeGreaterThan(1);
  expect(fixture.peak).toBeLessThanOrEqual(8);
  expect(store.snapshot().count).toBe(63);
  expect(unlink).not.toHaveBeenCalled();
});
