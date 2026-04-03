import type { ToolCall } from './tool-types.js';

export interface ParsedToolCall {
  name: string;
  input: Record<string,unknown>;
  startIndex: number;
  endIndex: number;
}

export interface ParseResult {
  textBefore: string;
  toolCalls: ParsedToolCall[];
  textAfter: string;
  hasToolCalls: boolean;
}

export const TOOL_OPEN_PATTERN: RegExp = /<tool\s+name="([^"]+)">\s*/g;

export const TOOL_CLOSE: string = '</tool>';

export function parseToolCalls(text: string): ParseResult {
  const toolCalls: ParsedToolCall[] = [];
  const pattern = new RegExp(TOOL_OPEN_PATTERN.source, 'g');
  let lastEnd = 0;
  let textBefore = '';
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const toolName = match[1];
    const jsonStart = match.index + match[0].length;
  
    // Find closing </tool> tag
    const closeIdx = text.indexOf(TOOL_CLOSE, jsonStart);
    if (closeIdx === -1) break; // Unclosed tag — stop parsing
  
    // Capture text before this tool call
    if (toolCalls.length === 0) {
      textBefore = text.slice(0, match.index).trim();
    }
  
    const jsonStr = text.slice(jsonStart, closeIdx).trim();
    let input: Record<string, unknown> = {};
  
    try {
      input = JSON.parse(jsonStr);
    } catch {
      // Try to be lenient — handle common LLM mistakes
      try {
        // Sometimes LLMs wrap in markdown code blocks
        const cleaned = jsonStr.replace(/^```json?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        input = JSON.parse(cleaned);
      } catch {
        // Give up parsing this tool call, include as text
        continue;
      }
    }
  
    toolCalls.push({
      name: toolName,
      input,
      startIndex: match.index,
      endIndex: closeIdx + TOOL_CLOSE.length,
    });
  
    lastEnd = closeIdx + TOOL_CLOSE.length;
    // Advance regex past the close tag
    pattern.lastIndex = lastEnd;
  }
  
  const textAfter = lastEnd > 0 ? text.slice(lastEnd).trim() : '';
  
  if (toolCalls.length === 0) {
    return { textBefore: text, toolCalls: [], textAfter: '', hasToolCalls: false };
  }
  
  return { textBefore, toolCalls, textAfter, hasToolCalls: true };
}

export function toolCallsToApiFormat(parsed: ParsedToolCall[]): ToolCall[] {
  return parsed.map((tc, i) => ({
    id: `tc_${Date.now()}_${i}`,
    name: tc.name,
    input: tc.input,
  }));
}

export function formatToolResult(toolName: string, result: string, isError?: boolean): string {
  if (isError) {
    return `<tool_result name="${toolName}" error="true">\n${result}\n</tool_result>`;
  }
  return `<tool_result name="${toolName}">\n${result}\n</tool_result>`;
}

export function formatToolResults(results: {name:string,content:string,error?:string}[]): string {
  return results.map(r => {
    if (r.error) {
      return formatToolResult(r.name, r.error, true);
    }
    return formatToolResult(r.name, r.content);
  }).join('\n\n');
}

