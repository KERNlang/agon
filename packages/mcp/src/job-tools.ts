import { DEFAULT_AGON_CONFIG, loadConfig } from '@kernlang/agon-core';
import { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';

import type { AgonConfig } from '@kernlang/agon-core';

import { buildMcpJobCommand } from '@kernlang/agon-mod-jobs';
export { JOB_TOOLS, isJobTool, requiredString, optionalInteger, buildMcpJobCommand } from '@kernlang/agon-mod-jobs';

type JobClientContext = { cwd?: string; signal?: AbortSignal };

export async function runMcpJobCommand(args: string[], context: JobClientContext = {}): Promise<string> {
  const nodeScript = process.env.AGON_CLI_NODE_SCRIPT;
  const command = nodeScript ? process.execPath : (process.env.AGON_CLI_COMMAND || 'agon');
  const runArgs = nodeScript ? [nodeScript, ...args] : args;
  const cwd = context.cwd ?? process.cwd();
  const config = loadConfig(cwd) as Required<AgonConfig>;
  const maxBytes = config.daemonFrameMaxBytes || DEFAULT_AGON_CONFIG.daemonFrameMaxBytes;
  const result = await spawnWithTimeout({
    command, args: runArgs, cwd, signal: context.signal,
    // The client submits or reads jobs. It never waits for workflow completion.
    timeout: 15_000, maxOutputBytes: maxBytes,
  });
  const output = result.stdout.trim();
  if (result.exitCode === 0 && (output || args[1] === 'events')) return output;
  return JSON.stringify({ ok: false, exitCode: result.exitCode, error: result.stderr.trim() || output || (result.exitCode === 130 ? 'Aborted' : 'agon job client failed') });
}

export async function handleJobToolCall(name: string, args: Record<string,unknown>, context: JobClientContext = {}): Promise<string> {
  try { return await runMcpJobCommand(buildMcpJobCommand(name, args), context); }
  catch (error) { return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
}
