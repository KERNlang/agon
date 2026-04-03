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

export const TOOL_CLOSE_TAGS: readonly string[] = ['</tool>', '</invoke>', '</minimax:tool_call>'];

function parseXmlParameters(xml: string): Record<string,unknown> {
  const result: Record<string, unknown> = {};
  const paramRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
  let m;
  while ((m = paramRe.exec(xml)) !== null) {
    const key = m[1];
    const val = m[2].trim();
    // Try to parse as JSON value (for booleans, numbers)
    if (val === 'true') result[key] = true;
    else if (val === 'false') result[key] = false;
    else if (/^\d+$/.test(val)) result[key] = parseInt(val, 10);
    else result[key] = val;
  }
  return result;
}

export function parseToolCalls(text: string): ParseResult {
  const toolCalls: ParsedToolCall[] = [];
  const pattern = new RegExp(TOOL_OPEN_PATTERN.source, 'g');
  let lastEnd = 0;
  let textBefore = '';
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const toolName = match[1];
    const contentStart = match.index + match[0].length;
  
    // Find closing tag — try all known close tags
    let closeIdx = -1;
    let closeLen = 0;
    for (const tag of TOOL_CLOSE_TAGS) {
      const idx = text.indexOf(tag, contentStart);
      if (idx !== -1 && (closeIdx === -1 || idx < closeIdx)) {
        closeIdx = idx;
        closeLen = tag.length;
      }
    }
    if (closeIdx === -1) {
      // No closing tag — check for self-contained block ending with </invoke> or similar
      // Also try just matching to end of an XML block
      const invokeClose = text.indexOf('</invoke>', contentStart);
      if (invokeClose !== -1) {
        closeIdx = invokeClose;
        closeLen = '</invoke>'.length;
        // Also skip any wrapper tags after </invoke>
        const afterInvoke = text.slice(closeIdx + closeLen).match(/^\s*<\/[^>]+>/);
        if (afterInvoke) closeLen += afterInvoke[0].length;
      } else {
        pattern.lastIndex = contentStart;
        continue;
      }
    }
  
    // Capture text before this tool call
    if (toolCalls.length === 0) {
      textBefore = text.slice(0, match.index).trim();
    }
  
    const contentStr = text.slice(contentStart, closeIdx).trim();
    let input: Record<string, unknown> = {};
  
    // Try JSON first
    try {
      input = JSON.parse(contentStr);
    } catch {
      try {
        const cleaned = contentStr.replace(/^```json?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        input = JSON.parse(cleaned);
      } catch {
        // Try XML <parameter> format (OpenCode, Minimax, etc.)
        if (contentStr.includes('<parameter')) {
          input = parseXmlParameters(contentStr);
        }
        // If still empty, try key:value lines
        if (Object.keys(input).length === 0 && contentStr.includes(':')) {
          for (const line of contentStr.split('\n')) {
            const kv = line.match(/^\s*"?(\w+)"?\s*:\s*"?(.*?)"?\s*$/);
            if (kv) input[kv[1]] = kv[2];
          }
        }
        if (Object.keys(input).length === 0) continue;
      }
    }
  
    toolCalls.push({
      name: toolName,
      input,
      startIndex: match.index,
      endIndex: closeIdx + closeLen,
    });
  
    lastEnd = closeIdx + closeLen;
    // Skip any trailing wrapper tags (e.g., </minimax:tool_call>)
    const trailing = text.slice(lastEnd).match(/^\s*<\/[a-zA-Z_:]+>/);
    if (trailing) lastEnd += trailing[0].length;
  
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

