export interface ContentSegment {
  type: 'prose'|'code';
  text: string|undefined;
  language: string|undefined;
  code: string|undefined;
  index: number|undefined;
}






export const FENCE_OPEN: RegExp = /^```(\w*)\s*$/;

export const FENCE_CLOSE: RegExp = /^```\s*$/;

export function parseMarkdownBlocks(text: string): ContentSegment[] {
  const lines = text.split('\n');
  const segments: ContentSegment[] = [];
  
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let proseLines: string[] = [];
  let codeIndex = 0;
  
  for (const line of lines) {
    const trimmed = line.trimStart();
  
    if (!inCode) {
      const openMatch = trimmed.match(FENCE_OPEN);
      if (openMatch) {
        const proseText = proseLines.join('\n');
        if (proseText.trim()) {
          segments.push({ type: 'prose', text: proseText, language: undefined, code: undefined, index: undefined });
        }
        proseLines = [];
        inCode = true;
        codeLang = openMatch[1] ?? '';
        codeLines = [];
        continue;
      }
      proseLines.push(line);
    } else {
      if (FENCE_CLOSE.test(trimmed)) {
        if (codeLines.length > 0) {
          codeIndex++;
          segments.push({ type: 'code', language: codeLang, code: codeLines.join('\n'), text: undefined, index: codeIndex });
        }
        inCode = false;
        codeLang = '';
        codeLines = [];
        continue;
      }
      codeLines.push(line);
    }
  }
  
  if (inCode && codeLines.length > 0) {
    codeIndex++;
    segments.push({ type: 'code', language: codeLang, code: codeLines.join('\n'), text: undefined, index: codeIndex });
  } else if (proseLines.length > 0) {
    const proseText = proseLines.join('\n');
    if (proseText.trim()) {
      segments.push({ type: 'prose', text: proseText, language: undefined, code: undefined, index: undefined });
    }
  }
  
  return segments;
  
}

export function truncateCodeLine(line: string, maxWidth: number): string {
  if (line.length <= maxWidth) return line;
  const overflow = line.length - maxWidth + 1;
  return line.slice(0, maxWidth - 1) + `…+${overflow}`;
  
}

function extractCodexStructured(text: string): string|null {
  const summaryMatch = text.match(/summary:\s*"([\s\S]*?)"\s*(?:sections\s*\{|$)/);
  const contentMatches = [...text.matchAll(/content:\s*"([\s\S]*?)"\s*\}/g)];
  if (!summaryMatch || contentMatches.length === 0) return null;
  
  const parts: string[] = [summaryMatch[1]];
  const sectionMatches = [...text.matchAll(/\d+:\s*"([^"]+)"\s*\{\s*content:\s*"([\s\S]*?)"\s*\}/g)];
  for (const m of sectionMatches) {
    parts.push(`\n## ${m[1]}\n${m[2]}`);
  }
  return parts.join('\n').replace(/\\n/g, '\n').trim();
  
}

function parseStreamJsonLine(trimmed: string): {action:'use'|'skip'|'keep', content?:string} {
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.type === 'assistant' && parsed.message?.content) {
      const content = typeof parsed.message.content === 'string'
        ? parsed.message.content
        : Array.isArray(parsed.message.content)
          ? parsed.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          : '';
      return content ? { action: 'use', content } : { action: 'skip' };
    }
    if (parsed.type === 'result' && parsed.result) {
      return { action: 'use', content: typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result) };
    }
    if (['system', 'hook_started', 'hook_response', 'tool_use', 'tool_result'].includes(parsed.type)) return { action: 'skip' };
    if (parsed.type?.startsWith('hook_')) return { action: 'skip' };
    if (parsed.subtype === 'system') return { action: 'skip' };
  } catch {
    // Not valid JSON — keep as text
  }
  return { action: 'keep' };
  
}

export function cleanEngineOutput(raw: string): string {
  const lines = raw.split('\n');
  const cleaned: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (cleaned.length === 0 && !trimmed) continue;
  
    if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
      const result = parseStreamJsonLine(trimmed);
      if (result.action === 'skip') continue;
      if (result.action === 'use') { cleaned.push(result.content!); continue; }
    }
  
    cleaned.push(line);
  }
  
  let result = cleaned.join('\n').trim();
  const codexResult = extractCodexStructured(result);
  if (codexResult) result = codexResult;
  return result;
  
}

