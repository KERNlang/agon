import { describe, expect, it } from 'vitest';
import { CommandExecutionError, commandResultToToolResult } from './command-tool-result.js';

describe('command-to-tool public boundary', () => {
  it.each([false, 0, '', { degraded: true }, ['fixture']])('preserves a successful payload: %j', (result) => {
    expect(commandResultToToolResult({ exitCode: 0, result })).toBe(result);
  });
  it('retains the established empty-result shape', () => {
    expect(commandResultToToolResult({ exitCode: 0 })).toEqual({});
  });
  it.each([1, 2, 130])('retains failure metadata and diagnostic result for exit %i', (exitCode) => {
    const failure = { code: exitCode === 130 ? 'CANCELLED' : 'FIXTURE_FAILED', message: 'typed failure', retryable: false };
    const result = { completedSeats: 0 };
    let caught: unknown;
    try { commandResultToToolResult({ exitCode, stderr: 'fallback', failure, result }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(CommandExecutionError);
    expect(caught).toMatchObject({ code: 'MOD_COMMAND_FAILED', exitCode, message: 'typed failure', failure, result });
  });
  it('never substitutes stdout as the failure message', () => {
    expect(() => commandResultToToolResult({ exitCode: 7, stdout: 'unrelated raw output' })).toThrow('Command failed (exit 7)');
  });
});
