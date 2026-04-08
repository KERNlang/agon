import { describe, it, expect } from 'vitest';
import { runHook, hooksFailed, hooksOutput } from '../../packages/core/src/generated/blocks/hooks.js';

describe('Hooks', () => {
  describe('runHook', () => {
    it('runs a simple echo command', () => {
      const result = runHook({ command: 'echo hello' }, {});
      expect(result.ok).toBe(true);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.exitCode).toBe(0);
    });

    it('returns failure for bad command', () => {
      const result = runHook({ command: 'false' }, {});
      expect(result.ok).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    it('passes env vars to command', () => {
      const result = runHook(
        { command: 'echo $AGON_TEST_VAR' },
        { AGON_TEST_VAR: 'works' },
      );
      expect(result.stdout.trim()).toBe('works');
    });

    it('respects timeout', () => {
      const result = runHook({ command: 'sleep 10', timeout: 1 }, {});
      expect(result.ok).toBe(false);
    });
  });

  describe('hooksFailed', () => {
    it('returns false for all passing', () => {
      expect(hooksFailed([
        { ok: true, stdout: '', stderr: '', exitCode: 0 },
        { ok: true, stdout: '', stderr: '', exitCode: 0 },
      ])).toBe(false);
    });

    it('returns true when any fails', () => {
      expect(hooksFailed([
        { ok: true, stdout: '', stderr: '', exitCode: 0 },
        { ok: false, stdout: '', stderr: 'err', exitCode: 1 },
      ])).toBe(true);
    });

    it('returns false for empty array', () => {
      expect(hooksFailed([])).toBe(false);
    });
  });

  describe('hooksOutput', () => {
    it('joins non-empty stdout', () => {
      const output = hooksOutput([
        { ok: true, stdout: 'line 1', stderr: '', exitCode: 0 },
        { ok: true, stdout: '', stderr: '', exitCode: 0 },
        { ok: true, stdout: 'line 2', stderr: '', exitCode: 0 },
      ]);
      expect(output).toBe('line 1\nline 2');
    });
  });
});
