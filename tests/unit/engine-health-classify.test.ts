import { describe, it, expect } from 'vitest';
import { classifyDispatchFailure } from '../../packages/core/src/generated/signals/engine-health.js';

describe('classifyDispatchFailure — binary-missing classification', () => {
  it('classifies the EngineNotFoundError binary message as binary-missing', () => {
    expect(
      classifyDispatchFailure({
        errorMessage: 'Engine "codex" not found — binary "codex" not found on PATH. Install: npm install -g @openai/codex',
      }),
    ).toBe('binary-missing');
  });

  it('classifies a spawn ENOENT (process spawn) as binary-missing, not unreachable', () => {
    expect(classifyDispatchFailure({ stderr: 'spawn /usr/local/bin/codex ENOENT', exitCode: 1 })).toBe('binary-missing');
    expect(classifyDispatchFailure({ errorMessage: 'spawn codex ENOENT' })).toBe('binary-missing');
  });

  it('classifies "is not installed" as binary-missing', () => {
    expect(classifyDispatchFailure({ stderr: 'the aider CLI is not installed' })).toBe('binary-missing');
  });

  it('does NOT quarantine a healthy engine over inner-shell "command not found"', () => {
    // A subprocess the engine itself shelled out to is missing (e.g. jq inside a tool),
    // not the dispatched binary — must not hard-quarantine the engine.
    expect(classifyDispatchFailure({ stderr: 'bash: jq: command not found' })).toBe('failed');
  });

  it('does NOT quarantine a healthy engine over "No such file or directory" (missing data/config file)', () => {
    expect(
      classifyDispatchFailure({ stderr: 'cannot open ~/.foo/config: No such file or directory' }),
    ).toBe('failed');
  });

  it('still classifies network failures as unreachable (not binary-missing)', () => {
    expect(classifyDispatchFailure({ stderr: 'getaddrinfo ENOTFOUND api.openai.com' })).toBe('unreachable');
    expect(classifyDispatchFailure({ stderr: 'connect ECONNREFUSED 127.0.0.1:443' })).toBe('unreachable');
    expect(classifyDispatchFailure({ errorMessage: 'fetch failed' })).toBe('unreachable');
  });

  it('auth failures still win over binary-missing (order preserved)', () => {
    expect(classifyDispatchFailure({ stderr: '401 invalid api key' })).toBe('auth-failed');
  });

  it('timeout still wins over everything', () => {
    expect(classifyDispatchFailure({ stderr: 'spawn codex ENOENT', timedOut: true })).toBe('timeout');
  });

  it('empty signal → failed; generic stderr → failed', () => {
    expect(classifyDispatchFailure({})).toBe('failed');
    expect(classifyDispatchFailure({ stderr: 'some unrelated runtime error' })).toBe('failed');
  });
});
