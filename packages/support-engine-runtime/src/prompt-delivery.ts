import type { EngineModeConfig } from './types.js';

interface ArgvLimit {
  readonly total: number;
  readonly perArg?: number;
  readonly countsEnv: boolean;
}

// Linux: MAX_ARG_STRLEN is 128 KiB per item, and the usual 8 MB stack gives a 2 MB total.
// Windows: CreateProcess takes 32,767 UTF-16 units and the environment does not count.
// Elsewhere (macOS ARG_MAX): 1 MiB across argv and environment together.
function argvLimit(platform: NodeJS.Platform): ArgvLimit {
  if (platform === 'linux') return { total: 2 * 1024 * 1024, perArg: 128 * 1024, countsEnv: true };
  if (platform === 'win32') return { total: 32_767, countsEnv: false };
  return { total: 1024 * 1024, countsEnv: true };
}

// Exec also spends the limit on pointers, the auxiliary vector and path copies.
const EXEC_OVERHEAD_BYTES = 16 * 1024;
const POINTER_BYTES = 8;

const cString = (value: string) => Buffer.byteLength(value) + 1 + POINTER_BYTES;

export interface ArgvOverflow {
  readonly bytes: number;
  readonly limit: number;
}

export function argvOverflow(
  command: string,
  args: readonly string[],
  env: Record<string, string | undefined> = {},
  platform: NodeJS.Platform = process.platform,
): ArgvOverflow | null {
  const limit = argvLimit(platform);
  const largest = Math.max(0, ...args.map(arg => Buffer.byteLength(arg)));
  if (limit.perArg !== undefined && largest >= limit.perArg) return { bytes: largest, limit: limit.perArg };
  let bytes = cString(command) + args.reduce((sum, arg) => sum + cString(arg), 0);
  if (limit.countsEnv) {
    for (const [key, value] of Object.entries({ ...process.env, ...env })) {
      if (value !== undefined) bytes += cString(`${key}=${value}`);
    }
  }
  const budget = limit.total - EXEC_OVERHEAD_BYTES;
  return bytes > budget ? { bytes, limit: budget } : null;
}

const count = (value: number) => value.toLocaleString('en-US');

export function argvTooLargeMessage(engineId: string, promptBytes: number, overflow: ArgvOverflow): string {
  return `Engine "${engineId}" was not started: its ${count(promptBytes)}-byte prompt needs ${count(overflow.bytes)} bytes of process arguments, over the ${count(overflow.limit)}-byte ${process.platform} limit, and it has no verified stdin delivery. Use agon review --split, a smaller target, or an engine that takes stdin.`;
}

export interface PromptDelivery {
  readonly args: string[];
  readonly stdinInput?: string;
  readonly eventStreamOutput?: boolean;
  readonly error?: string;
}

function encodeStdin(prompt: string, envelope: 'event-stream' | undefined): string {
  if (envelope !== 'event-stream') return prompt;
  return `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n`;
}

/**
 * Argv stays the transport whenever it fits, so prompts that already work keep exactly the invocation they always had; only a prompt that argv cannot carry moves to stdin.
 */
export function planPromptDelivery(input: {
  readonly engineId: string;
  readonly mode: Pick<EngineModeConfig, 'stdin'> | null | undefined;
  readonly command: string;
  readonly args: readonly string[];
  readonly prompt: string;
  readonly env?: Record<string, string>;
  readonly platform?: NodeJS.Platform;
}): PromptDelivery {
  const { command, env, platform, prompt, engineId } = input;
  const argvOnly = [...input.args];
  const overflow = argvOverflow(command, argvOnly, env, platform);
  if (!overflow) return { args: argvOnly };
  const promptBytes = Buffer.byteLength(prompt);
  const stdin = input.mode?.stdin;
  const index = argvOnly.indexOf(prompt);
  if (!stdin || index < 0) return { args: argvOnly, error: argvTooLargeMessage(engineId, promptBytes, overflow) };
  const protocol = stdin === true ? {} : stdin;
  const args = [...argvOnly];
  if (protocol.promptFlag && args[index - 1] === protocol.promptFlag) {
    args.splice(index - 1, 2, `${protocol.promptFlag}=`);
  } else {
    args.splice(index, 1);
  }
  args.push(...(protocol.args ?? []));
  const remaining = argvOverflow(command, args, env, platform);
  if (remaining) return { args: argvOnly, error: argvTooLargeMessage(engineId, promptBytes, remaining) };
  return {
    args,
    stdinInput: encodeStdin(prompt, protocol.envelope),
    ...(protocol.envelope === 'event-stream' ? { eventStreamOutput: true } : {}),
  };
}

/** Final answer from an `event-stream` run; empty when the stream never closed with a result. */
export function decodeEventStreamOutput(stdout: string): string {
  let response = '';
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line) as { event?: unknown; result?: { response?: unknown } };
      if (message.event === 'result' && typeof message.result?.response === 'string') response = message.result.response;
    } catch { /* Non-JSON diagnostics are not part of the answer. */ }
  }
  return response;
}
