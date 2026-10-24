import { describe, it, expect } from 'vitest';
import { spawnWithTimeout } from '../../packages/core/src/blocks/process.js';

// ── Basic spawn behavior ────────────────────────────────────────────

describe('spawnWithTimeout', () => {
  it('bounds decoded malformed output and incomplete EOF characters', async () => {
    for (const [bytes, limit, expected] of [
      [[255, 255, 255, 255], 4, '�'], [[226], 1, ''],
    ] as const) {
      const result = await spawnWithTimeout({ command: process.execPath,
        args: ['-e', `process.stdout.write(Buffer.from(${JSON.stringify(bytes)}))`],
        cwd: process.cwd(), timeout: 5000, maxCapturedBytesPerStream: limit });
      expect(result.stdout).toBe(expected);
      expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(limit);
      expect(result.outputTruncated).toBe(true);
      expect(result.exitCode).toBe(0);
    }
  });
  it('captures each stream separately without terminating on capture overflow', async () => {
    const result = await spawnWithTimeout({ command: process.execPath,
      args: ['-e', "process.stdout.write('abcdef'); process.stderr.write('uvwxyz');"],
      cwd: process.cwd(), timeout: 5000, maxCapturedBytesPerStream: 4 });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'abcd', stderr: 'uvwx',
      aborted: false, outputTruncated: true });
  });

  it('keeps exact capture limits and drops a UTF-8 character cut by truncation', async () => {
    for (const [text, limit, expected, truncated] of [
      ['éé', 4, 'éé', false], ['éé', 3, 'é', true], ['abc', 4, 'abc', false],
    ] as const) {
      const result = await spawnWithTimeout({ command: process.execPath,
        args: ['-e', `process.stdout.write(${JSON.stringify(text)})`],
        cwd: process.cwd(), timeout: 5000, maxCapturedBytesPerStream: limit });
      expect(result.stdout).toBe(expected);
      expect(result.outputTruncated).toBe(truncated);
      expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(limit);
    }
  });

  it('observes cancellation from onSpawn before the listener is registered', async () => {
    const controller = new AbortController();
    const result = await spawnWithTimeout({ command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'], cwd: process.cwd(), timeout: 10000,
      maxCapturedBytesPerStream: 4, signal: controller.signal,
      onSpawn: () => controller.abort() });
    expect(result).toMatchObject({ exitCode: 130, aborted: true, timedOut: false });
    expect(result.durationMs).toBeLessThan(3000);
  });

  it('rejects invalid capture limits without spawning', async () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity]) {
      await expect(spawnWithTimeout({ command: process.execPath, args: [],
        cwd: process.cwd(), timeout: 1000, maxCapturedBytesPerStream: limit,
        onSpawn: () => { throw new Error('must not spawn'); } }))
        .rejects.toThrow('maxCapturedBytesPerStream must be a positive safe integer');
    }
  });

  it('preserves default result fields when bounded capture is not selected', async () => {
    const result = await spawnWithTimeout({ command: process.execPath, args: ['-e', ''],
      cwd: process.cwd(), timeout: 5000 });
    expect(result).not.toHaveProperty('aborted');
    expect(result).not.toHaveProperty('outputTruncated');
    expect(result).not.toHaveProperty('spawnError');
  });

  it('decodes UTF-8 split across output chunks', async () => {
    const result = await spawnWithTimeout({
      command: process.execPath,
      args: ['-e', "process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 50);"],
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 2,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('é');
  });

  it('bounds combined stdout and stderr by bytes', async () => {
    const result = await spawnWithTimeout({
      command: process.execPath,
      args: ['-e', "process.stdout.write('é'.repeat(40)); process.stderr.write('x'.repeat(40));"],
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 100,
    });
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain('output exceeded 100 bytes');
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(100);
  });

  it('preserves output at the exact byte limit', async () => {
    const result = await spawnWithTimeout({
      command: process.execPath,
      args: ['-e', "process.stdout.write('é'.repeat(50));"],
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 100,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('é'.repeat(50));
  });

  it('captures stdout from a simple command', async () => {
    let spawnedPid: number | null = null;
    const result = await spawnWithTimeout({
      command: 'echo',
      args: ['hello world'],
      cwd: process.cwd(),
      timeout: 5000,
      onSpawn: (pid) => { spawnedPid = pid; },
    });
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.pid).toBe(spawnedPid);
    expect(typeof result.pid).toBe('number');
  });

  it('captures stderr', async () => {
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'echo error >&2'],
      cwd: process.cwd(),
      timeout: 5000,
    });
    expect(result.stderr.trim()).toBe('error');
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exit code', async () => {
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'exit 42'],
      cwd: process.cwd(),
      timeout: 5000,
    });
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it('handles command not found', async () => {
    const result = await spawnWithTimeout({
      command: 'nonexistent_command_xyz',
      args: [],
      cwd: process.cwd(),
      timeout: 5000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ENOENT');
  });

  it('measures duration', async () => {
    const result = await spawnWithTimeout({
      command: 'sleep',
      args: ['0.1'],
      cwd: process.cwd(),
      timeout: 5000,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(50);
    expect(result.durationMs).toBeLessThan(3000);
  });

  it('passes environment variables', async () => {
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'echo $AGON_TEST_VAR'],
      cwd: process.cwd(),
      timeout: 5000,
      env: { AGON_TEST_VAR: 'test_value' },
    });
    expect(result.stdout.trim()).toBe('test_value');
  });

  it('respects cwd', async () => {
    const result = await spawnWithTimeout({
      command: 'pwd',
      args: [],
      cwd: '/tmp',
      timeout: 5000,
    });
    // /tmp may resolve to /private/tmp on macOS
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });
});

// ── Timeout behavior ────────────────────────────────────────────────

describe('spawnWithTimeout — Timeout', () => {
  it('kills process after timeout', async () => {
    const result = await spawnWithTimeout({
      command: 'sleep',
      args: ['30'],
      cwd: process.cwd(),
      timeout: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it('collects partial stdout before timeout', async () => {
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'echo before; sleep 30'],
      cwd: process.cwd(),
      timeout: 500,
    });
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toContain('before');
  });

  it('force-kills processes that ignore SIGTERM', async () => {
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'trap "" TERM; echo ready; while true; do sleep 1; done'],
      cwd: process.cwd(),
      timeout: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toContain('ready');
    expect(result.durationMs).toBeLessThan(2500);
  });
});

// ── Abort signal ────────────────────────────────────────────────────

describe('spawnWithTimeout — AbortSignal', () => {
  it('returns immediately if signal already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await spawnWithTimeout({
      command: 'sleep',
      args: ['30'],
      cwd: process.cwd(),
      timeout: 30000,
      signal: ac.signal,
    });
    expect(result.exitCode).toBe(130);
    expect(result.stderr).toContain('Aborted');
    expect(result.durationMs).toBe(0);
  });

  it('kills running process when signal fires', async () => {
    const ac = new AbortController();
    // Abort after 200ms
    setTimeout(() => ac.abort(), 200);
    const result = await spawnWithTimeout({
      command: 'sleep',
      args: ['30'],
      cwd: process.cwd(),
      timeout: 30000,
      signal: ac.signal,
    });
    expect(result.exitCode).toBe(130);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it('collects partial output before abort', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 500);
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'echo started; sleep 30'],
      cwd: process.cwd(),
      timeout: 30000,
      signal: ac.signal,
    });
    expect(result.stdout).toContain('started');
    expect(result.exitCode).toBe(130);
  });

  it('signal is ignored if process completes first', async () => {
    const ac = new AbortController();
    // Abort after 5s — but process finishes in ~0s
    setTimeout(() => ac.abort(), 5000);
    const result = await spawnWithTimeout({
      command: 'echo',
      args: ['fast'],
      cwd: process.cwd(),
      timeout: 5000,
      signal: ac.signal,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('fast');
    ac.abort(); // Clean up
  });
});

// ── Multi-byte output ───────────────────────────────────────────────

describe('spawnWithTimeout — Output handling', () => {
  it('handles large stdout', async () => {
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', 'seq 1 1000'],
      cwd: process.cwd(),
      timeout: 5000,
    });
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBe(1000);
    expect(lines[999]).toBe('1000');
  });

  it('handles empty output', async () => {
    const result = await spawnWithTimeout({
      command: 'true',
      args: [],
      cwd: process.cwd(),
      timeout: 5000,
    });
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });
});

describe('spawnWithTimeout — pre-aborted signal', () => {
  it('short-circuits without spawning and reports an abort, NOT a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;

    const result = await spawnWithTimeout({
      // A command that would take a full second if it were ever spawned.
      command: 'sleep',
      args: ['1'],
      cwd: process.cwd(),
      timeout: 30_000,
      signal: controller.signal,
      onSpawn: () => { spawned = true; },
    });

    expect(spawned).toBe(false);
    expect(result.exitCode).toBe(130);
    expect(result.stderr).toBe('Aborted');
    expect(result.stdout).toBe('');
    expect(result.durationMs).toBe(0);
    // Cancellation is not a timeout: callers that retry-on-timeout must not
    // re-dispatch work the user explicitly cancelled.
    expect(result.timedOut).toBe(false);
  });
});
