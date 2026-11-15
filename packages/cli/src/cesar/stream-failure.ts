import { parseToolCalls as parseToolCallsRaw, runToolLoop as runToolLoopRaw, stripToolMarkup } from '@kernlang/agon-core';

const CONFIG_SHAPED_FAILURE = /\b(?:400|401|403|404)\b|not found|unauthorized|invalid api key|authentication|no such (?:route|endpoint)/i;

/**
 * Two separate questions: would the same engine with the same config fail again, and is the user's config at fault? An exhausted 429 or 5xx answers yes to the first and no to the second.
 */
export function classifyCesarStreamFailure(errorText: string, metadata?: Record<string, unknown>): { skipSameEngineRetry: boolean; configShaped: boolean } {
  const status = Number(metadata?.statusCode);
  const transient = status === 429 || (status >= 500 && status <= 599);
  const configShaped = !transient && ((status >= 400 && status <= 499) || CONFIG_SHAPED_FAILURE.test(errorText));
  return { skipSameEngineRetry: configShaped || metadata?.modelRetryFinal === true, configShaped };
}

/**
 * Text streamed before a failed model call must never become a tool execution: the call never finished, so its markup is not a decision the model completed. Once latched, every parse and tool-loop entry for the turn sees the text with its markup removed.
 */
export function createStreamFailureGuard() {
  let failed = false;
  const clean = (text: string): string => (failed ? stripToolMarkup(text) : text);
  const parseToolCalls: typeof parseToolCallsRaw = (text) => (failed
    ? { textBefore: clean(text), toolCalls: [], textAfter: '', hasToolCalls: false }
    : parseToolCallsRaw(text));
  const runToolLoop: typeof runToolLoopRaw = (send, initial, ...rest) =>
    runToolLoopRaw(async (message) => clean(await send(message)), clean(initial), ...rest);
  return {
    note(chunk: { type?: string; metadata?: Record<string, unknown> }): boolean {
      if (chunk.type !== 'error' || chunk.metadata?.outputStarted !== true) return false;
      failed = true;
      return true;
    },
    clean,
    parseToolCalls,
    runToolLoop,
  };
}
