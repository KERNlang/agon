import type { DispatchOptions, DispatchResult } from '@kernlang/agon-core';

import { planPromptDelivery } from '@kernlang/agon-core';

import { buildCommand, resolveModeConfig } from './adapter-helpers.js';

export interface CliInvocation {
  command: string;
  args: string[];
  stdinInput?: string;
  eventStreamOutput?: boolean;
  error?: string;
}

/**
 * The argv and prompt transport for one CLI dispatch. Without a native flag the system prompt is prepended to the prompt; isolation flags go first so they bind before a positional prompt.
 */
export function planCliInvocation(
  options: DispatchOptions,
  binaryPath: string,
  iso: { env?: Record<string, string>; argsExtra: string[] },
): CliInvocation {
  const sysFlag = options.engine.systemPromptFlag;
  const prompt = options.systemPrompt && !sysFlag
    ? `[System Instructions]\n${options.systemPrompt}\n\n[User Message]\n${options.prompt}`
    : options.prompt;
  const { command, args, promptArg } = buildCommand(options.engine, options.mode, prompt, options.cwd, options.timeout, binaryPath, options.images);
  if (options.systemPrompt && sysFlag) {
    const promptIdx = args.indexOf(promptArg);
    args.splice(promptIdx >= 0 ? promptIdx : 0, 0, sysFlag, options.systemPrompt);
  }
  if (iso.argsExtra.length > 0) args.unshift(...iso.argsExtra);
  const delivery = planPromptDelivery({
    engineId: options.engine.id,
    mode: resolveModeConfig(options.engine, options.mode),
    command, args, prompt: promptArg, env: iso.env,
  });
  return { command, ...delivery };
}

export function promptRefusedResult(error: string): DispatchResult {
  return { exitCode: 1, stdout: '', stderr: error, durationMs: 0, timedOut: false };
}
