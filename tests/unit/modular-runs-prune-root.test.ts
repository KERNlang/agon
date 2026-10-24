import { beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const fixture = vi.hoisted(() => ({
  root: '/fixture/original', pauseAt: 'scan', paused: false,
  entered: () => {}, wait: Promise.resolve(),
  calls: [] as Array<{ action: string; path: string }>,
  names: Array.from({ length: 2005 }, (_, index) => `${index}.json`),
}));
vi.mock('../../packages/support-persistence/src/paths.js', () => ({
  persistencePath: (...parts: string[]) => join(fixture.root, ...parts),
}));
vi.mock('../../packages/support-persistence/src/file-lock.js', () => ({
  withFileLock: (path: string, action: () => void) => {
    fixture.calls.push({ action: 'lock', path });
    action();
  },
}));
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => { fixture.calls.push({ action: 'read-stamp', path }); return '0'; },
  writeFileSync: (path: string) => { fixture.calls.push({ action: 'write-stamp', path }); },
}));
vi.mock('node:fs/promises', () => {
  const pause = async (boundary: string) => {
    if (fixture.pauseAt !== boundary || fixture.paused) return;
    fixture.paused = true;
    fixture.entered();
    await fixture.wait;
  };
  return {
    readdir: async (path: string) => {
      fixture.calls.push({ action: 'readdir', path });
      await pause('scan');
      return [...fixture.names];
    },
    stat: async (path: string) => {
      fixture.calls.push({ action: 'stat', path });
      return { isFile: () => true, mtimeMs: 0 };
    },
    unlink: async (path: string) => {
      fixture.calls.push({ action: 'unlink', path });
      await pause('delete');
      fixture.names = fixture.names.filter(name => path !== join('/fixture/original/runs', name));
    },
  };
});

import { RunsStore } from '../../packages/support-persistence/src/runs-store.js';

beforeEach(() => {
  fixture.root = '/fixture/original';
  fixture.paused = false;
  fixture.calls = [];
  fixture.names = Array.from({ length: 2005 }, (_, index) => `${index}.json`);
});

it.each(['scan', 'delete'])('pins the prune directory across a %s wait', async boundary => {
  fixture.pauseAt = boundary;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { fixture.entered = resolve; });
  fixture.wait = new Promise<void>(resolve => { release = resolve; });
  const store = new RunsStore();
  const pending = store.maybePrune({ force: true });
  await entered;
  fixture.root = '/fixture/replacement';
  release();
  expect(await pending).toMatchObject({ deleted: 5, reason: 'pruned' });
  expect(fixture.calls.filter(call => !call.path.startsWith('/fixture/original/runs'))).toEqual([]);
  expect(fixture.calls.filter(call => call.action === 'unlink')).toHaveLength(5);
  expect(store.snapshot().count).toBe(2000);
});
