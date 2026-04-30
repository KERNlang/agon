import { describe, it, expect } from 'vitest';
import { spawnWithTimeout } from '../../packages/core/src/generated/blocks/process.js';

// ── Basic spawn behavior ────────────────────────────────────────────

describe('spawnWithTimeout', () => {
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
