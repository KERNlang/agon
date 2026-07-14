import { describe, expect, it, vi } from 'vitest';

import {
  runInJobAbortScope,
  trackJobAbortController,
} from '../../packages/cli/src/generated/signals/job-abort-scope.js';

describe('per-job abort scope', () => {
  it('forwards a job cancellation to the handler controller it publishes', async () => {
    const parent = new AbortController();
    const child = new AbortController();
    const aborted = vi.fn();
    child.signal.addEventListener('abort', aborted, { once: true });

    await runInJobAbortScope(parent.signal, async () => {
      expect(trackJobAbortController(child)).toBe(true);
      parent.abort('stop');
      expect(child.signal.reason).toBe('stop');
    });

    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it('isolates concurrent job controllers', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const firstChild = new AbortController();
    const secondChild = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const one = runInJobAbortScope(first.signal, async () => {
      trackJobAbortController(firstChild);
      await gate;
    });
    const two = runInJobAbortScope(second.signal, async () => {
      trackJobAbortController(secondChild);
      await gate;
    });
    first.abort();

    expect(firstChild.signal.aborted).toBe(true);
    expect(secondChild.signal.aborted).toBe(false);
    release();
    await Promise.all([one, two]);
  });

  it('declines controllers outside a job scope', () => {
    expect(trackJobAbortController(new AbortController())).toBe(false);
  });
});
