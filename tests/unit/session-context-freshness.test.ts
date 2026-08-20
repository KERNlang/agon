import { describe, it, expect, beforeEach, vi } from 'vitest';

const scanMock = vi.hoisted(() => vi.fn());
vi.mock('../../packages/core/src/blocks/context-scanner.js', () => ({ scanProjectContext: scanMock }));

import { SessionContext } from '../../packages/core/src/blocks/session-context.js';
import { hostNowMs } from '../../packages/core/src/blocks/host-runtime.js';

// The whole point of SessionContext is that the project scan (directory walk
// + git status) happens ONCE per session, not once per dispatch. The memo is
// only bypassed when the capture is older than the 5-minute window, so the
// staleness comparison must be an AGE (now - capturedAt), never a sum.
//
// The existing session-context.test.ts can't see this: scanProjectContext
// returns a deterministic string, and `toBe` on two equal primitive strings
// passes whether or not the scan re-ran. Counting the calls is the only
// observable.

const FRESHNESS_MS = 300_000;

beforeEach(() => {
  scanMock.mockReset();
  let n = 0;
  scanMock.mockImplementation((cwd: string) => `scan#${(n += 1)}:${cwd}`);
});

describe('SessionContext freshness window', () => {
  it('scans once and reuses the memo for repeat gets', () => {
    const ctx = new SessionContext();
    const first = ctx.get('/tmp/project-a');
    const second = ctx.get('/tmp/project-a');
    const third = ctx.get('/tmp/project-a');

    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('rescans for a different cwd / extra / format', () => {
    const ctx = new SessionContext();
    ctx.get('/tmp/project-a');
    ctx.get('/tmp/project-b');
    ctx.get('/tmp/project-b', 'extra note');
    ctx.get('/tmp/project-b', 'extra note', 'kern');
    expect(scanMock).toHaveBeenCalledTimes(4);
  });

  it('rescans once the capture is older than the freshness window', () => {
    const ctx = new SessionContext();
    ctx.get('/tmp/project-a');
    expect(scanMock).toHaveBeenCalledTimes(1);

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(hostNowMs() + FRESHNESS_MS + 1_000);
    try {
      ctx.get('/tmp/project-a');
      expect(scanMock).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('invalidate forces the next get to rescan', () => {
    const ctx = new SessionContext();
    ctx.get('/tmp/project-a');
    ctx.invalidate();
    ctx.get('/tmp/project-a');
    expect(scanMock).toHaveBeenCalledTimes(2);
    expect(ctx.age()).toBeLessThan(FRESHNESS_MS);
  });
});
