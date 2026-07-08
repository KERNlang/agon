import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// Isolated file: node:fs is mocked ONLY here (real fs.watch tests live in
// rooms-tail.test.ts). Everything except `watch` stays real so roomDir/mkdir
// keep working; `watchImpl` is swapped per test to simulate watcher failure
// modes that are not portably reproducible with a real FSWatcher.
let watchImpl: (dir: string, cb: (...a: unknown[]) => void) => unknown;

vi.mock('node:fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs')>();
  const watch = (dir: string, cb: (...a: unknown[]) => void) => watchImpl(dir, cb);
  return { ...orig, watch, default: { ...orig, watch } };
});

import { mkdtempSync, rmSync } from 'node:fs';
import { createRoomWaker } from '../../packages/core/src/generated/rooms/tail.js';

class FakeWatcher extends EventEmitter {
  close = vi.fn();
  unref = vi.fn();
}

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-degrade-')); process.env.AGON_HOME = home; });
afterEach(() => { delete process.env.AGON_HOME; rmSync(home, { recursive: true, force: true }); });

describe('createRoomWaker — degradation paths', () => {
  it('fs.watch throwing at creation → warns once and runs on the degraded poll interval', async () => {
    watchImpl = () => { throw new Error('EMFILE: too many open files'); };
    const warnings: string[] = [];
    // Watchdog deliberately huge: only the DEGRADED_POLL_MS (1000ms) fallback
    // can resolve this wait in time.
    const waker = createRoomWaker('r', 600_000, (m) => warnings.push(m));
    try {
      expect(warnings).toEqual(['fs.watch unavailable — degrading to incremental poll']);
      const started = Date.now();
      const reason = await waker.wait();
      expect(reason).toBe('watchdog');
      expect(Date.now() - started).toBeLessThan(5000); // degraded 1s poll, not the 600s watchdog
      // warn-once: a second waker interaction adds no new warning
      expect(warnings).toHaveLength(1);
    } finally {
      waker.close();
    }
  });

  it("watcher 'error' after creation → closes it, warns once, wakes waiters, degrades subsequent waits", async () => {
    const fake = new FakeWatcher();
    watchImpl = () => fake;
    const warnings: string[] = [];
    const waker = createRoomWaker('r', 600_000, (m) => warnings.push(m));
    try {
      expect(warnings).toEqual([]); // healthy so far
      // A waiter is parked on the 600s watchdog when the watcher dies.
      const waitP = waker.wait();
      fake.emit('error', new Error('EPERM: watched dir deleted'));
      const reason = await waitP; // woken promptly, not after 600s
      expect(reason).toBe('watchdog');
      expect(fake.close).toHaveBeenCalled();
      expect(warnings).toEqual(['room watcher failed — degrading to incremental poll']);
      // Subsequent waits arm the DEGRADED interval (1s), not the 600s watchdog.
      const started = Date.now();
      expect(await waker.wait()).toBe('watchdog');
      expect(Date.now() - started).toBeLessThan(5000);
      // A second error emission would be ignored (listener dropped the watcher);
      // warn stays once.
      fake.emit('error', new Error('again'));
      expect(warnings).toHaveLength(1);
    } finally {
      waker.close();
    }
  });
});
