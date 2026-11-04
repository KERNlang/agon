import type { CommandResult, Json } from './index.js';

/** A command failed after invocation; distinct from a protocol/schema error. */
export class CommandExecutionError extends Error {
  readonly code = 'MOD_COMMAND_FAILED';
  readonly exitCode: number;
  readonly failure: CommandResult['failure'];
  readonly result: Json | undefined;

  constructor(output: CommandResult) {
    super(output.failure?.message || output.stderr?.trim() || `Command failed (exit ${output.exitCode})`);
    this.name = 'CommandExecutionError';
    this.exitCode = output.exitCode;
    this.failure = output.failure;
    this.result = output.result;
  }
}

/** Preserve the existing successful payload while refusing false success. */
export function commandResultToToolResult(output: CommandResult): Json {
  if (output.exitCode !== 0) throw new CommandExecutionError(output);
  return output.result ?? {};
}
