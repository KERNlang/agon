import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

describe('run pruning', () => {
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

      const { ensureAgonHome } = await import('../../packages/core/src/config.js');
      ensureAgonHome();

      expect(existsSync(freshOverflow)).toBe(true);
      expect(existsSync(staleOverflow)).toBe(false);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(agonHome, { recursive: true, force: true });
    }
  });
});
