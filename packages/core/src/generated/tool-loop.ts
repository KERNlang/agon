// @kern-source: tool-loop:5
import type { ToolCall, ToolCallResult, ToolContext, ToolHandler } from './tool-types.js';

// @kern-source: tool-loop:6
import { ToolRegistry, executeToolCalls } from './tool-registry.js';

// @kern-source: tool-loop:7
import { parseToolCalls, toolCallsToApiFormat, formatToolResults } from './tool-parser.js';

// @kern-source: tool-loop:8
import type { ParseResult } from './tool-parser.js';

// @kern-source: tool-loop:9
import { generateToolPrompt } from './tool-prompt.js';

// @kern-source: tool-loop:11
export const MAX_TOOL_TURNS: number = 25;

// @kern-source: tool-loop:14
export interface ToolLoopCallbacks {
  onToolCall?: (name: string, input: Record<string,unknown>) => void;
  onToolResult?: (name: string, result: ToolCallResult) => void;
  onPermissionAsk?: (tool: string, message: string) => Promise<boolean>;
  onText?: (text: string) => void;
  onTurnComplete?: (turn: number) => void;
}

// @kern-source: tool-loop:21
export interface ToolLoopResult {
  finalText: string;
  toolCallCount: number;
  turns: number;
  aborted: boolean;
}

// @kern-source: tool-loop:27
export function buildToolSystemPrompt(registry: ToolRegistry): string {
  const handlers = Array.from((registry as any).tools.values()) as ToolHandler[];
  return generateToolPrompt(handlers);
}

// @kern-source: tool-loop:34
export async function processToolResponse(response: string, ctx: ToolContext, registry: ToolRegistry, callbacks?: ToolLoopCallbacks): Promise<{hasTools:boolean, textBefore:string, toolResults:string, textAfter:string}> {
  const parsed = parseToolCalls(response);
  
  if (!parsed.hasToolCalls) {
    return { hasTools: false, textBefore: response, toolResults: '', textAfter: '' };
  }
  
  // Notify about text before tools
  if (parsed.textBefore && callbacks?.onText) {
    callbacks.onText(parsed.textBefore);
  }
  
  // Convert to ToolCall format
  const calls = toolCallsToApiFormat(parsed.toolCalls);
  
  // Notify about each tool call
  for (const call of calls) {
    if (callbacks?.onToolCall) {
      callbacks.onToolCall(call.name, call.input);
    }
  }
  
  // Execute all tool calls
  const results = await executeToolCalls(
    calls,
    ctx,
    registry,
    callbacks?.onPermissionAsk,
    (result) => {
      if (callbacks?.onToolResult) {
        callbacks.onToolResult(result.toolName, result);
      }
    }
  );
  
  // Format results for re-injection
  const formatted = formatToolResults(
    results.map(r => ({
      name: r.toolName,
      content: r.result.content,
      error: r.result.error,
    }))
  );
  
  return {
    hasTools: true,
    textBefore: parsed.textBefore,
    toolResults: formatted,
    textAfter: parsed.textAfter,
  };
}

// @kern-source: tool-loop:88
export async function runToolLoop(sendMessage: (message:string)=>Promise<string>, initialResponse: string, ctx: ToolContext, registry: ToolRegistry, callbacks?: ToolLoopCallbacks): Promise<ToolLoopResult> {
  let currentResponse = initialResponse;
  let totalToolCalls = 0;
  let turn = 0;
  const allText: string[] = [];
  
  while (turn < MAX_TOOL_TURNS) {
    if (ctx.abortSignal?.aborted) {
      return { finalText: allText.join('\n'), toolCallCount: totalToolCalls, turns: turn, aborted: true };
    }
  
    const processed = await processToolResponse(currentResponse, ctx, registry, callbacks);
  
    if (!processed.hasTools) {
      // No tool calls — we're done
      allText.push(processed.textBefore);
      if (callbacks?.onText && processed.textBefore) {
        callbacks.onText(processed.textBefore);
      }
      break;
    }
  
    // Collect text
    if (processed.textBefore) allText.push(processed.textBefore);
    totalToolCalls += parseToolCalls(currentResponse).toolCalls.length;
    turn++;
  
    if (callbacks?.onTurnComplete) {
      callbacks.onTurnComplete(turn);
    }
  
    // Send tool results back to the engine and get next response
    const nextMessage = processed.toolResults + (processed.textAfter ? '\n\n' + processed.textAfter : '');
    currentResponse = await sendMessage(nextMessage);
  }
  
  if (turn >= MAX_TOOL_TURNS) {
    allText.push(`\n[Tool loop reached maximum of ${MAX_TOOL_TURNS} turns]`);
  }
  
  return {
    finalText: allText.join('\n'),
    toolCallCount: totalToolCalls,
    turns: turn,
    aborted: ctx.abortSignal?.aborted ?? false,
  };
}

