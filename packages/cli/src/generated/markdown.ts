export interface ContentSegment {
  type: 'prose'|'code'|'table';
  text: string|undefined;
  language: string|undefined;
  code: string|undefined;
  index: number|undefined;
  headers: string[]|undefined;
  rows: string[][]|undefined;
  alignments: ('left'|'center'|'right')[]|undefined;
}









export const FENCE_OPEN: RegExp = /^```(\w*)\s*$/;

export const FENCE_CLOSE: RegExp = /^```\s*$/;

function isTableSeparator(line: string): boolean {
  return /^\|[\s:_-]+(\|[\s:_-]+)*\|?\s*$/.test(line.trim());
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.includes('|', 1);
}

function parseTableAlignment(sepLine: string): ('left'|'center'|'right')[] {
  const cells = sepLine.trim().replace(/^\||\|$/g, '').split('|');
  return cells.map((c: string) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center' as const;
    if (t.endsWith(':')) return 'right' as const;
    return 'left' as const;
  });
}

function parseTableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c: string) => c.trim());
}

function emitProseWithTables(proseLines: string[], segments: ContentSegment[]): void {
  let i = 0;
  let buffered: string[] = [];
  
  function flushProse(): void {
    const text = buffered.join('\n');
    if (text.trim()) {
      segments.push({ type: 'prose', text, language: undefined, code: undefined, index: undefined, headers: undefined, rows: undefined, alignments: undefined });
    }
    buffered = [];
  }
  
  while (i < proseLines.length) {
    // Check for table: current line is a table row AND next line is a separator
    if (isTableRow(proseLines[i]) && i + 1 < proseLines.length && isTableSeparator(proseLines[i + 1])) {
      flushProse();
      const headers = parseTableCells(proseLines[i]);
      const alignments = parseTableAlignment(proseLines[i + 1]);
      const rows: string[][] = [];
      i += 2; // skip header + separator
      while (i < proseLines.length && isTableRow(proseLines[i]) && !isTableSeparator(proseLines[i])) {
        rows.push(parseTableCells(proseLines[i]));
        i++;
      }
      segments.push({ type: 'table', text: undefined, language: undefined, code: undefined, index: undefined, headers, rows, alignments });
      continue;
    }
  
    buffered.push(proseLines[i]);
    i++;
  }
  flushProse();
}

export const _mdCache: Map<string, ContentSegment[]> = new Map();

export const _MD_CACHE_MAX: number = 500;

export function parseMarkdownBlocks(text: string): ContentSegment[] {
  // LRU cache — avoid re-parsing identical content during streaming
  // Use djb2 hash for large strings to avoid collisions
  let key: string;
  if (text.length < 500) {
    key = text;
  } else {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    key = `h:${hash}:${text.length}`;
  }
  const cached = _mdCache.get(key);
  if (cached) return cached;
  
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
        emitProseWithTables(proseLines, segments);
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
          segments.push({ type: 'code', language: codeLang, code: codeLines.join('\n'), text: undefined, index: codeIndex, headers: undefined, rows: undefined, alignments: undefined });
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
    segments.push({ type: 'code', language: codeLang, code: codeLines.join('\n'), text: undefined, index: codeIndex, headers: undefined, rows: undefined, alignments: undefined });
  } else if (proseLines.length > 0) {
    emitProseWithTables(proseLines, segments);
  }
  
  // Store in cache, evict oldest if full
  if (_mdCache.size >= _MD_CACHE_MAX) {
    const firstKey = _mdCache.keys().next().value;
    if (firstKey !== undefined) _mdCache.delete(firstKey);
  }
  _mdCache.set(key, segments);
  
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
    if (!parsed.type) return { action: 'keep' };
  
    // Extract actual text content from streaming events
    if (parsed.type === 'assistant' && parsed.message?.content) {
      const content = typeof parsed.message.content === 'string'
        ? parsed.message.content
        : Array.isArray(parsed.message.content)
          ? parsed.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
          : '';
      return content ? { action: 'use', content } : { action: 'skip' };
    }
  
    // OpenCode: text events with actual content in part.text
    if (parsed.type === 'text' && parsed.part?.text) {
      return { action: 'use', content: parsed.part.text };
    }
  
    // Result events — extract content if present, skip error metadata
    if (parsed.type === 'result') {
      if (parsed.subtype === 'error_max_turns' || parsed.is_error) return { action: 'skip' };
      if (parsed.result && typeof parsed.result === 'string') return { action: 'use', content: parsed.result };
      return { action: 'skip' };
    }
  
    // Skip ALL known streaming metadata types (Claude, OpenCode, Codex, Gemini)
    const skipTypes = [
      'system', 'hook_started', 'hook_response', 'tool_use', 'tool_result',
      'user', 'rate_limit_event', 'message_start', 'message_stop', 'message_delta',
      'content_block_start', 'content_block_stop', 'content_block_delta',
      'step_start', 'step_finish', 'step-start', 'step-finish',
      'ping', 'error', 'init', 'session_start', 'session_end',
    ];
    if (skipTypes.includes(parsed.type)) return { action: 'skip' };
    if (parsed.type?.startsWith('hook_')) return { action: 'skip' };
    if (parsed.type?.startsWith('step_')) return { action: 'skip' };
    if (parsed.subtype === 'system') return { action: 'skip' };
  
    // Any JSON with sessionID, session_id, or uuid is streaming metadata — skip
    if (parsed.sessionID || parsed.session_id || parsed.uuid) return { action: 'skip' };
  
  } catch {
    // Not valid JSON — keep as text
  }
  return { action: 'keep' };
}

function deduplicateInline(line: string): string {
  // Check if the line is a repeated substring (e.g. "abcabc" → "abc")
  const len = line.length;
  if (len < 10) return line;
  for (let half = Math.floor(len / 2); half >= 5; half--) {
    const candidate = line.slice(0, half);
    // Check if the rest of the line starts with the same candidate
    if (line.slice(half).startsWith(candidate)) {
      return candidate + line.slice(half + candidate.length);
    }
  }
  return line;
}

function deduplicateParagraphs(text: string): string {
  // First: deduplicate within each line (streaming chunk concatenation artifacts)
  const lines = text.split('\n');
  const dedupedLines = lines.map((l: string) => deduplicateInline(l));
  const joined = dedupedLines.join('\n');
  
  // Then: deduplicate consecutive paragraphs
  const paragraphs = joined.split(/\n{2,}/);
  const seen = new Set<string>();
  const deduped: string[] = [];
  
  for (const para of paragraphs) {
    const normalized = para.trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(para.trim());
  }
  
  return deduped.join('\n\n');
}

function stripBuddyThinkingNoise(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
  
    // Skip raw command output metadata from Codex
    if (trimmed.startsWith('Command:') && trimmed.includes('/bin/')) continue;
    if (trimmed.startsWith('Chunk ID:')) continue;
    if (trimmed.startsWith('Wall time:')) continue;
    if (trimmed.startsWith('Process exited with code')) continue;
    if (trimmed.startsWith('Original token count:')) continue;
    if (trimmed === 'Output:') continue;
  
    // Skip lines that are exact substrings of the next line (progressive thinking)
    if (i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (trimmed.length > 20 && next.startsWith(trimmed)) continue;
    }
  
    result.push(line);
  }
  
  return result.join('\n');
}

function shortenFilePaths(text: string): string {
  // Only shorten paths in prose — skip fenced code blocks
  const fenceRe = /^```[\s\S]*?^```/gm;
  const fences: Array<{ start: number; end: number }> = [];
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(text)) !== null) {
    fences.push({ start: fm.index, end: fm.index + fm[0].length });
  }
  function insideFence(pos: number): boolean {
    return fences.some(f => pos >= f.start && pos < f.end);
  }
  
  const cwd = process.cwd();
  const home = process.env.HOME ?? '';
  
  const exts = 'tsx|jsx|ts|js|json|kern|md|py|rs|go|yaml|yml|toml|sh|css|html|svelte|vue|rb|java|cpp|c|h';
  const pathRe = new RegExp('(?<!`)(?:~/|/)[A-Za-z0-9._\\-/]+\\.(?:' + exts + ')(?::[0-9]+(?::[0-9]+)?|#L[0-9]+)?(?!`)', 'g');
  
  return text.replace(pathRe, (match, offset: number) => {
    // Never rewrite paths inside fenced code blocks
    if (insideFence(offset)) return match;
    // Skip if too short or doesn't look like a real path
    if (match.length < 10) return match;
    if (!match.includes('/')) return match;
  
    let shortened = match;
  
    // Expand ~/ to home
    if (shortened.startsWith('~/') && home) {
      shortened = home + shortened.slice(1);
    }
  
    // Strip cwd prefix → relative path
    if (shortened.startsWith(cwd + '/')) {
      shortened = shortened.slice(cwd.length + 1);
    }
    // Strip home prefix → ~/...
    else if (home && shortened.startsWith(home + '/')) {
      shortened = '~/' + shortened.slice(home.length + 1);
    }
  
    // Collapse to just filename:line for inline references
    // packages/cli/src/generated/handlers-cesar-brain.ts:91 → handlers-cesar-brain.ts:91
    const parts = shortened.split('/');
    if (parts.length > 2) {
      shortened = parts[parts.length - 1];
    }
  
    // Wrap in backticks for inline-code (purple) styling
    return '`' + shortened + '`';
  });
}

function addParagraphBreaks(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const result: string[] = [];
  
  for (const para of paragraphs) {
    const lines = para.split('\n');
    // Skip if already structured or short enough
    const isStructured = lines.some(l => /^[#\-*>|`\d+\.]/.test(l.trimStart()));
    const totalLen = lines.reduce((sum, l) => sum + l.length, 0);
    if (isStructured || totalLen < 400) {
      result.push(para);
      continue;
    }
  
    // Only split genuine walls — 5+ sentences crammed together
    const joined = lines.join(' ');
    const sentences = joined.split(/(?<=\.\s)(?=[A-Z])/);
    if (sentences.length <= 4) {
      result.push(para);
      continue;
    }
  
    // Group into chunks of 3-4 sentences
    const chunks: string[] = [];
    let current = '';
    let count = 0;
    for (const sentence of sentences) {
      current += sentence;
      count++;
      if (count >= 4 || current.length > 350) {
        chunks.push(current.trim());
        current = '';
        count = 0;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    result.push(chunks.join('\n\n'));
  }
  
  return result.join('\n\n');
}

export const _cleanCache: Map<number, string> = new Map();

export function cleanEngineOutput(raw: string): string {
  // Cache by length — during streaming, content only grows
  const cacheKey = raw.length;
  const cached = _cleanCache.get(cacheKey);
  if (cached !== undefined) return cached;
  
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
  
  // Clean buddy streaming artifacts
  result = stripBuddyThinkingNoise(result);
  result = deduplicateParagraphs(result);
  
  // Break dense walls of text into paragraphs at sentence boundaries
  result = addParagraphBreaks(result);
  
  // Shorten absolute file paths → relative, backtick-wrapped for purple styling
  result = shortenFilePaths(result);
  
  // Cache and evict old entries
  if (_cleanCache.size > 200) _cleanCache.clear();
  _cleanCache.set(cacheKey, result);
  
  return result;
}

