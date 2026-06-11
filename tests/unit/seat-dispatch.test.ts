import { describe, it, expect } from 'vitest';
import { classifySeatFailure, dispatchSeatWithRetry, buildPanelHealth } from '../../packages/forge/src/generated/seat-dispatch.js';

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', durationMs: 1, timedOut: false });
const timedOut = () => ({ exitCode: 124, stdout: '', stderr: 'Timed out', durationMs: 1, timedOut: true });
const empty = () => ({ exitCode: 0, stdout: '   ', stderr: '', durationMs: 1, timedOut: false });
const crashed = () => ({ exitCode: 1, stdout: '', stderr: 'boom', durationMs: 1, timedOut: false });

const fakeAdapter = (results: Array<() => any>) => {
  const calls: number[] = [];
  return {
    calls,
    adapter: {
      dispatch: async (opts: any) => {
        calls.push(opts.timeout);
        const next = results.shift();
        if (!next) throw new Error('no scripted result left');
        return next();
      },
    } as any,
  };
};

const seatOpts = (signal?: AbortSignal) => ({
  engineId: 'codex', engine: { id: 'codex' }, prompt: 'p', cwd: '/tmp', mode: 'exec',
  timeout: 120, outputDir: '/tmp', signal,
});

describe('classifySeatFailure', () => {
  it('classifies timeout, error, empty, and ok', () => {
    expect(classifySeatFailure(timedOut() as any)).toBe('timeout');
    expect(classifySeatFailure(crashed() as any)).toBe('error');
    expect(classifySeatFailure(empty() as any)).toBe('empty');
    expect(classifySeatFailure(ok('text') as any)).toBe(null);
  });
});

describe('dispatchSeatWithRetry', () => {
  it('returns first-attempt success without retrying', async () => {
    const { adapter, calls } = fakeAdapter([() => ok('answer')]);
    const seat = await dispatchSeatWithRetry(adapter, seatOpts());
    expect(seat).toMatchObject({ ok: true, text: 'answer', attempts: 1, failure: null, note: null });
    expect(calls).toEqual([120]);
  });

  it('retries ONCE with ~half the timeout and notes the recovery', async () => {
    const { adapter, calls } = fakeAdapter([() => timedOut(), () => ok('late answer')]);
    const seat = await dispatchSeatWithRetry(adapter, seatOpts());
    expect(seat).toMatchObject({ ok: true, text: 'late answer', attempts: 2 });
    expect(seat.note).toBe('codex timeout → retried OK');
    expect(calls).toEqual([120, 60]);
  });

  it('drops the seat after a failed retry with a loud note', async () => {
    const { adapter } = fakeAdapter([() => crashed(), () => empty()]);
    const seat = await dispatchSeatWithRetry(adapter, seatOpts());
    expect(seat).toMatchObject({ ok: false, attempts: 2, failure: 'empty' });
    expect(seat.note).toBe('codex error → retry empty, dropped');
  });

  it('treats a dispatch exception as a retryable error', async () => {
    const { adapter } = fakeAdapter([() => { throw new Error('spawn failed'); }, () => ok('recovered')]);
    const seat = await dispatchSeatWithRetry(adapter, seatOpts());
    expect(seat.ok).toBe(true);
    expect(seat.note).toBe('codex error → retried OK');
  });

  it('never retries after a user abort mid-attempt', async () => {
    const controller = new AbortController();
    const { adapter, calls } = fakeAdapter([() => { controller.abort(); return timedOut(); }, () => ok('should not happen')]);
    const seat = await dispatchSeatWithRetry(adapter, seatOpts(controller.signal));
    expect(seat.ok).toBe(false);
    expect(seat.attempts).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('skips dispatch entirely when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { adapter, calls } = fakeAdapter([() => ok('should not happen')]);
    const seat = await dispatchSeatWithRetry(adapter, seatOpts(controller.signal));
    expect(seat.ok).toBe(false);
    expect(seat.attempts).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('caps the retry timeout at the original (sub-60s callers never get a longer retry)', async () => {
    const { adapter, calls } = fakeAdapter([() => timedOut(), () => ok('late')]);
    const seat = await dispatchSeatWithRetry(adapter, { ...seatOpts(), timeout: 20 });
    expect(seat.ok).toBe(true);
    expect(calls).toEqual([20, 20]);   // min(20, max(30, 10)) = 20, never > original
  });

  it('preserves the underlying failure detail for diagnosability', async () => {
    const { adapter } = fakeAdapter([() => crashed(), () => crashed()]);
    const seat = await dispatchSeatWithRetry(adapter, seatOpts());
    expect(seat.ok).toBe(false);
    expect(seat.detail).toContain('boom');
  });

  it('an extract throw counts as an empty failure and is retried', async () => {
    const { adapter } = fakeAdapter([() => ok('<think>only thinking</think>'), () => ok('visible')]);
    const seat = await dispatchSeatWithRetry(adapter, {
      ...seatOpts(),
      extract: (r: any) => {
        const cleaned = String(r.stdout).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (!cleaned) throw new Error('empty after strip');
        return cleaned;
      },
    });
    expect(seat.ok).toBe(true);
    expect(seat.text).toBe('visible');
    expect(seat.note).toBe('codex empty → retried OK');
  });
});

describe('buildPanelHealth', () => {
  const seat = (engineId: string, okFlag: boolean, note: string | null) =>
    ({ engineId, ok: okFlag, text: okFlag ? 'x' : '', attempts: note ? 2 : 1, failure: okFlag ? null : 'timeout', note }) as any;

  it('is silent when every seat responded first try', () => {
    const h = buildPanelHealth([seat('a', true, null), seat('b', true, null)]);
    expect(h).toMatchObject({ requested: 2, responded: 2, degraded: false, banner: null });
  });

  it('reports recovered seats without flagging degradation', () => {
    const h = buildPanelHealth([seat('a', true, 'a timeout → retried OK'), seat('b', true, null)]);
    expect(h.degraded).toBe(false);
    expect(h.banner).toBe('panel recovered: a timeout → retried OK (2/2 responded)');
  });

  it('reports dropped seats loudly', () => {
    const h = buildPanelHealth([
      seat('a', true, null),
      seat('b', true, 'b timeout → retried OK'),
      seat('c', false, 'c error → retry empty, dropped'),
    ]);
    expect(h.degraded).toBe(true);
    expect(h.banner).toBe('panel degraded: b timeout → retried OK; c error → retry empty, dropped (2/3 responded)');
  });
});
