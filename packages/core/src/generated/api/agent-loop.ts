// @kern-source: agent-loop:6
import { apiStreamDispatchWithHistory } from './dispatch.js';

// @kern-source: agent-loop:7
import type { ApiConfig } from './dispatch.js';

// @kern-source: agent-loop:8
import type { ToolHandler, ToolContext, ToolResult, ToolDefinition } from '../models/tool-types.js';

// @kern-source: agent-loop:9
import { ToolRegistry, executeToolCall } from '../signals/tool-registry.js';

// @kern-source: agent-loop:10
import { toolsToOpenAIFormat } from '../tools/tool-prompt.js';

// @kern-source: agent-loop:11
import { buildToolSystemPrompt } from '../tools/tool-loop.js';

// @kern-source: agent-loop:12
import { createReadTool } from '../tools/tool-read.js';

// @kern-source: agent-loop:13
import { createEditTool } from '../tools/tool-edit.js';

// @kern-source: agent-loop:14
import { createWriteTool } from '../tools/tool-write.js';

// @kern-source: agent-loop:15
import { createBashTool } from '../tools/tool-bash.js';

// @kern-source: agent-loop:16
import { createGrepTool } from '../tools/tool-grep.js';

// @kern-source: agent-loop:17
import { createGlobTool } from '../tools/tool-glob.js';

// @kern-source: agent-loop:18
import { FileStateCache } from '../blocks/file-state-cache.js';

// @kern-source: agent-loop:19
import { saveToolResultToDisk } from '../signals/session-store.js';

// @kern-source: agent-loop:20
import { createRetrieveResultTool } from '../tools/tool-retrieve.js';

// @kern-source: agent-loop:21
import type { ToolCacheEntry } from '../models/context-parts.js';

// @kern-source: agent-loop:23
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

// @kern-source: agent-loop:34
export interface ApiAgentResult {
  response: string;
  toolCalls: number;
  steps: number;
}

// @kern-source: agent-loop:39
/**
 * Attempt to repair malformed JSON tool arguments. Handles common LLM mistakes: markdown fencing, trailing commas, single quotes, unquoted keys.
 */
export function repairToolArgs(raw: string): Record<string,unknown>|null {
  let cleaned = raw.trim();
  
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  
  // Fix single quotes → double quotes (but not inside strings)
  // Only do this if there are no double quotes at all (simple case)
  if (!cleaned.includes('"') && cleaned.includes("'")) {
    cleaned = cleaned.replace(/'/g, '"');
  }
  
  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  
  // Try parsing the cleaned version
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  
  // Last resort: try to extract a JSON object from the string
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* give up */ }
  }
  
  return null;
}

// @kern-source: agent-loop:68
/**
 * Auto-correct tool name case mismatches. Maps 'read' → 'Read', 'GREP' → 'Grep', etc.
 */
export function repairToolName(name: string, registry: any): string {
  // Check if exact match exists
  if (registry.has?.(name) || registry.get?.(name)) return name;
  
  // Try common case variants
  const lower = name.toLowerCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  
  // Known tool names in Agon
  const knownTools = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Forge', 'Brainstorm', 'Tribunal', 'Campfire', 'Review', 'Delegate', 'Pipeline', 'ReportConfidence', 'ProposePlan'];
  const match = knownTools.find((t: string) => t.toLowerCase() === lower);
  if (match) return match;
  
  // Fallback to capitalized
  return capitalized;
}

// @kern-source: agent-loop:87
/**
 * Run an API engine with full tool loop. Returns final response after all tool calls resolve.
 */
export async function runApiAgentLoop(opts: ApiAgentOptions): Promise<ApiAgentResult> {
  // Build tool registry with workspace tools — read-only permission for safety
  const registry = new ToolRegistry();
  registry.register(createReadTool());
  registry.register(createEditTool());
  registry.register(createWriteTool());
  registry.register(createBashTool());
  registry.register(createGrepTool());
  registry.register(createGlobTool());
  registry.register(createRetrieveResultTool(opts.api.model || 'api-agent'));
  
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
  const totalDeadline = Date.now() + opts.timeout * 1000; // Total timeout for entire loop
  let step = 0;
  let totalToolCalls = 0;
  let finalResponse = '';
  
  while (step < MAX_STEPS) {
    step++;
    let fullResponse = '';
  
    // Per-step timeout: remaining time, not the full configured timeout
    const remaining = Math.max(30, Math.floor((totalDeadline - Date.now()) / 1000));
    if (remaining <= 30) {
      // Less than 30s left — bail out with what we have
      return { response: finalResponse || '[Timeout — ran out of time]', toolCalls: totalToolCalls, steps: step };
    }
  
    const gen = apiStreamDispatchWithHistory(opts.api, messageHistory, remaining, opts.signal, nativeTools);
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
  
      // Execute tools with repair for malformed args
      for (const tc of extractedCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          // Tool call repair — attempt to fix common malformations
          const repaired = repairToolArgs(tc.arguments);
          if (repaired) {
            args = repaired;
          } else {
            // Still broken — send error feedback to model instead of silently passing { raw: ... }
            messageHistory.push({ role: 'tool', content: `Error: Malformed JSON arguments for tool "${tc.name}". Got: ${tc.arguments.slice(0, 200)}. Please retry with valid JSON.`, tool_call_id: tc.id } as any);
            totalToolCalls++;
            continue;
          }
        }
  
        // Tool name repair — auto-correct case mismatches
        const canonicalName = repairToolName(tc.name, registry);
        if (canonicalName !== tc.name) {
          tc.name = canonicalName;
        }
  
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
          // Disk-backed cache: save full result, keep preview + ref
          const engineId = opts.api.model || 'api-agent';
          const cacheEntry = saveToolResultToDisk(engineId, tc.id, tc.name, result);
          if (cacheEntry) {
            const lines = result.split('\n').length;
            histContent = result.slice(0, 400) + `\n...\n[${lines} lines, ${result.length} chars — cached — ${tc.id}]`;
          } else {
            histContent = result.slice(0, 600) + '\n...\n[truncated]';
          }
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
      let histContent = result;
      if (histContent.length > 800) {
        const engineId = opts.api.model || 'api-agent';
        const ce = saveToolResultToDisk(engineId, callId, 'Read', result);
        histContent = ce ? result.slice(0, 400) + `\n...\n[cached — ${callId}]` : result.slice(0, 600) + '\n...\n[truncated]';
      }
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

