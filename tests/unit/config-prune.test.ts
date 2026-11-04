import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

describe('run pruning', () => {
  it.each(['directories', 'symlinks'] as const)('counts only owned directories when the other entries are %s', async kind => {
    const agonHome = setupTestAgonHome('run-prune-slots');
    const runsDir = join(agonHome, 'runs');
    mkdirSync(runsDir, { recursive: true });
    try {
      const old = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const target = join(agonHome, 'external-directory');
      mkdirSync(target);
      for (let i = 0; i < 100; i++) {
        const path = join(runsDir, `retained-${i}`);
        if (kind === 'symlinks') symlinkSync(target, path);
        else {
          mkdirSync(path);
          const timestamp = new Date(old + i * 1000);
          utimesSync(path, timestamp, timestamp);
        }
      }
      const oldest = join(runsDir, 'oldest');
      mkdirSync(oldest);
      const timestamp = new Date(old - 1000);
      utimesSync(oldest, timestamp, timestamp);
      const { ensureAgonHome } = await import('../../packages/core/src/signals/config.js');
      ensureAgonHome();
      expect(existsSync(oldest)).toBe(kind === 'symlinks');
      for (let i = 0; i < 100; i++) expect(existsSync(join(runsDir, `retained-${i}`))).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(agonHome, { recursive: true, force: true });
    }
  });

  it('leaves history records and metadata to their retention owner', async () => {
    const agonHome = setupTestAgonHome('run-prune-records');
    const runsDir = join(agonHome, 'runs');
    mkdirSync(runsDir, { recursive: true });
    try {
      for (let i = 0; i < 100; i++) mkdirSync(join(runsDir, `recent-${i}`));
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const contents = '{"id":"history","status":"done"}\n';
      for (const name of ['history.json', '.prune-stamp']) {
        writeFileSync(join(runsDir, name), contents);
        utimesSync(join(runsDir, name), old, old);
      }
      const staleDirectory = join(runsDir, 'stale-directory');
      mkdirSync(staleDirectory);
      utimesSync(staleDirectory, old, old);
      const { ensureAgonHome } = await import('../../packages/core/src/signals/config.js');
      ensureAgonHome();
      expect(existsSync(staleDirectory)).toBe(false);
      for (const name of ['history.json', '.prune-stamp']) {
        expect(readFileSync(join(runsDir, name), 'utf8')).toBe(contents);
      }
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(agonHome, { recursive: true, force: true });
    }
  });

  it('does not count records against the directory retention limit', async () => {
    const agonHome = setupTestAgonHome('run-prune-count');
    const runsDir = join(agonHome, 'runs');
    mkdirSync(runsDir, { recursive: true });
    try {
      for (let i = 0; i < 100; i++) writeFileSync(join(runsDir, `${i}.json`), '{}');
      const directory = join(runsDir, 'only-directory');
      mkdirSync(directory);
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      utimesSync(directory, old, old);
      const { ensureAgonHome } = await import('../../packages/core/src/signals/config.js');
      ensureAgonHome();
      expect(existsSync(directory)).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(agonHome, { recursive: true, force: true });
    }
  });

  it('does not treat a symlink as an owned run directory', async () => {
    const agonHome = setupTestAgonHome('run-prune-link');
    const runsDir = join(agonHome, 'runs');
    mkdirSync(runsDir, { recursive: true });
    try {
      for (let i = 0; i < 100; i++) mkdirSync(join(runsDir, `recent-${i}`));
      const target = join(agonHome, 'outside-runs');
      mkdirSync(target);
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      utimesSync(target, old, old);
      const link = join(runsDir, 'linked-directory');
      symlinkSync(target, link);
      const { ensureAgonHome } = await import('../../packages/core/src/signals/config.js');
      ensureAgonHome();
      expect(existsSync(link)).toBe(true);
      expect(existsSync(target)).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(agonHome, { recursive: true, force: true });
    }
  });

  it('does not delete fresh overflow run directories', async () => {
    const agonHome = setupTestAgonHome('run-prune-fresh');
    const runsDir = join(agonHome, 'runs');
    mkdirSync(runsDir, { recursive: true });

    try {
      const now = Date.now();
      for (let i = 0; i < 100; i++) {
        const dir = join(runsDir, `live-${i}`);
        mkdirSync(dir, { recursive: true });
        const ts = new Date(now - i * 1000);
        utimesSync(dir, ts, ts);
      }

      const freshOverflow = join(runsDir, 'plan-exec-fresh-active');
      mkdirSync(freshOverflow, { recursive: true });
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      utimesSync(freshOverflow, oneHourAgo, oneHourAgo);

      const staleOverflow = join(runsDir, 'plan-exec-stale');
      mkdirSync(staleOverflow, { recursive: true });
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
      utimesSync(staleOverflow, twoDaysAgo, twoDaysAgo);

      const { ensureAgonHome } = await import('../../packages/core/src/signals/config.js');
      ensureAgonHome();

      expect(existsSync(freshOverflow)).toBe(true);
      expect(existsSync(staleOverflow)).toBe(false);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(agonHome, { recursive: true, force: true });
    }
  });
});
