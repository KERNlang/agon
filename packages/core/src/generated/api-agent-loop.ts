// @kern-source: api-agent-loop:6
import { apiStreamDispatchWithHistory } from './api-dispatch.js';

// @kern-source: api-agent-loop:7
import type { ApiConfig } from './api-dispatch.js';

// @kern-source: api-agent-loop:8
import type { ToolHandler, ToolContext, ToolResult, ToolDefinition } from './tool-types.js';

// @kern-source: api-agent-loop:9
import { ToolRegistry, executeToolCall } from './tool-registry.js';

// @kern-source: api-agent-loop:10
import { toolsToOpenAIFormat } from './tool-prompt.js';

// @kern-source: api-agent-loop:11
import { buildToolSystemPrompt } from './tool-loop.js';

// @kern-source: api-agent-loop:12
import { createReadTool } from './tool-read.js';

// @kern-source: api-agent-loop:13
import { createEditTool } from './tool-edit.js';

// @kern-source: api-agent-loop:14
import { createWriteTool } from './tool-write.js';

// @kern-source: api-agent-loop:15
import { createBashTool } from './tool-bash.js';

// @kern-source: api-agent-loop:16
import { createGrepTool } from './tool-grep.js';

// @kern-source: api-agent-loop:17
import { createGlobTool } from './tool-glob.js';

// @kern-source: api-agent-loop:18
import { FileStateCache } from '../file-state-cache.js';

// @kern-source: api-agent-loop:20
export interface ApiAgentOptions {
  api: ApiConfig;
  prompt: string;
  systemPrompt?: string;
  cwd: string;
  timeout: number;
  signal?: AbortSignal;
  maxSteps?: number;
  onChunk?: (text:string)=>void;
  onToolCall?: (name:string,args:Record<string,unknown>)=>void;
}

// @kern-source: api-agent-loop:31
export interface ApiAgentResult {
  response: string;
  toolCalls: number;
  steps: number;
}

// @kern-source: api-agent-loop:36
export async function runApiAgentLoop(opts: ApiAgentOptions): Promise<ApiAgentResult> {
  // Build tool registry with workspace tools — read-only permission for safety
  const registry = new ToolRegistry();
  registry.register(createReadTool());
  registry.register(createEditTool());
  registry.register(createWriteTool());
  registry.register(createBashTool());
  registry.register(createGrepTool());
  registry.register(createGlobTool());
  
  const nativeTools = toolsToOpenAIFormat(registry);
  
  // Build tool context — auto-allow read-only tools, ask for writes
  const fsc = new FileStateCache();
  const toolCtx: ToolContext = {
    cwd: opts.cwd,
    readFileState: (fsc as any).cache,
    abortSignal: opts.signal,
    permissionMode: 'auto', // Agentic: auto-allow all in forge/brainstorm context
    explorationMode: false,
    allowedCommands: [],
    toolPermissions: {},
  };
  
  // Build system prompt with tool definitions
  const toolPrompt = buildToolSystemPrompt(registry);
  const systemParts: string[] = [];
  if (opts.systemPrompt) systemParts.push(opts.systemPrompt);
  systemParts.push('TOOLS: XML format below. Call tools to investigate the codebase. Use Read for files, Grep for search, Glob to find files.');
  systemParts.push(toolPrompt);
  const fullSystemPrompt = systemParts.join('\n\n');
  
  // Build message history
  const messageHistory: Array<{role: string, content: string}> = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user', content: opts.prompt },
  ];
  
  const MAX_STEPS = opts.maxSteps ?? 10;
  let step = 0;
  let totalToolCalls = 0;
  let finalResponse = '';
  
  while (step < MAX_STEPS) {
    step++;
    let fullResponse = '';
  
    const gen = apiStreamDispatchWithHistory(opts.api, messageHistory, opts.timeout, opts.signal, nativeTools);
    try {
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          const result = value as any;
          if (result?.stderr) {
            return { response: `Error: ${result.stderr}`, toolCalls: totalToolCalls, steps: step };
          }
          break;
        }
        fullResponse += value as string;
        if (opts.onChunk) opts.onChunk(value as string);
      }
    } catch (err: any) {
      return { response: fullResponse || `Error: ${err.message ?? String(err)}`, toolCalls: totalToolCalls, steps: step };
    }
  
    if (!fullResponse) break;
  
    // Extract tool calls
    const toolMarkerRe = /<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>/g;
    const extractedCalls: Array<{id: string, name: string, arguments: string}> = [];
    let tmMatch;
    while ((tmMatch = toolMarkerRe.exec(fullResponse)) !== null) {
      extractedCalls.push({ id: `call_${Date.now()}_${extractedCalls.length}`, name: tmMatch[1], arguments: tmMatch[2] });
    }
  
    if (extractedCalls.length > 0) {
      const cleanText = fullResponse.replace(/<tool\s+name="[^"]+">[\s\S]*?<\/tool>/g, '').trim();
      messageHistory.push({
        role: 'assistant', content: cleanText || null,
        tool_calls: extractedCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
      } as any);
  
      // Execute tools
      for (const tc of extractedCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.arguments); } catch { args = { raw: tc.arguments }; }
  
        if (opts.onToolCall) opts.onToolCall(tc.name, args);
  
        let result: string;
        try {
          const callResult = await executeToolCall(
            { id: tc.id, name: tc.name, input: args },
            toolCtx,
            registry,
          );
          result = callResult.result.ok ? callResult.result.content : (callResult.result.error ?? 'Tool execution failed');
        } catch (err: any) {
          result = `Error: ${err.message ?? String(err)}`;
        }
  
        let histContent = result;
        if (histContent.length > 800) {
          histContent = histContent.slice(0, 300) + '\n...\n[truncated]';
        }
        messageHistory.push({ role: 'tool', content: histContent, tool_call_id: tc.id } as any);
        totalToolCalls++;
      }
      continue;
    }
  
    // No tool calls — check for stall intent
    const tail = fullResponse.slice(-300);
    const readIntent = tail.match(/\b(?:let me |i(?:'ll| need to| want to| should| will) )(?:read|check|look at|examine|open)\s+[`"']?([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,6})[`"']?/i);
    if (readIntent) {
      messageHistory.push({ role: 'assistant', content: fullResponse });
      // Auto-execute the intent
      const callId = `auto_${Date.now()}`;
      let result: string;
      try {
        const callResult = await executeToolCall(
          { id: callId, name: 'Read', input: { file_path: readIntent[1] } },
          toolCtx,
          registry,
        );
        result = callResult.result.ok ? callResult.result.content : (callResult.result.error ?? 'File not found');
      } catch (err: any) {
        result = `Error: ${err.message ?? String(err)}`;
      }
      let histContent = result.length > 800 ? result.slice(0, 300) + '\n...\n[truncated]' : result;
      messageHistory.push({
        role: 'assistant', content: null,
        tool_calls: [{ id: callId, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: readIntent[1] }) } }],
      } as any);
      messageHistory.push({ role: 'tool', content: histContent, tool_call_id: callId } as any);
      totalToolCalls++;
      continue;
    }
  
    // Final response
    finalResponse = fullResponse;
    messageHistory.push({ role: 'assistant', content: fullResponse });
    break;
  }
  
  return { response: finalResponse, toolCalls: totalToolCalls, steps: step };
}

