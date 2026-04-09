// @kern-source: stream-parser:1
export interface ParsedChunk {
  type: 'text'|'status'|'result'|'raw';
  content: string;
}

// @kern-source: stream-parser:2

// @kern-source: stream-parser:3

// @kern-source: stream-parser:5
/**
 * Buffered NDJSON parser that handles partial JSON lines spanning multiple chunks.
 */
export class StreamParser {
  private buffer: string;

  constructor() {
    this.buffer = '';
  }

  feed(chunk: string): ParsedChunk[] {
    this.buffer += chunk;
    const results: ParsedChunk[] = [];
    const lines = this.buffer.split('\n');
    
    // Keep the last element — it may be an incomplete line
    this.buffer = lines.pop() ?? '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      results.push(...this._parseLine(trimmed));
    }
    
    return results;
  }

  flush(): ParsedChunk[] {
    const results: ParsedChunk[] = [];
    const remaining = this.buffer.trim();
    this.buffer = '';
    
    if (!remaining) return results;
    results.push(...this._parseLine(remaining));
    return results;
  }

  private _parseLine(line: string): ParsedChunk[] {
    const results: ParsedChunk[] = [];
    
    try {
      const msg = JSON.parse(line);
    
      // Claude Code stream-json: assistant message with content blocks
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            results.push({ type: 'text', content: block.text });
          }
        }
        return results;
      }
    
      // Claude Code stream-json: final result
      if (msg.type === 'result') {
        if (msg.result) {
          results.push({ type: 'result', content: typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result) });
        }
        if (msg.is_error || msg.error) {
          const errMsg = msg.error ?? msg.result ?? 'Unknown error';
          results.push({ type: 'status', content: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) });
        }
        return results;
      }
    
      // Claude Code stream-json: system status
      if (msg.type === 'system') {
        if (msg.message) results.push({ type: 'status', content: msg.message });
        return results;
      }
    
      // Unknown JSON — skip
      return results;
    } catch {
      // Not JSON — treat as raw text (Codex, Gemini, etc.)
      results.push({ type: 'raw', content: line });
      return results;
    }
  }
}

// @kern-source: stream-parser:87
/**
 * Stateless convenience wrapper. For streaming use, prefer StreamParser.feed() + flush().
 */
export function parseStreamChunk(chunk: string): ParsedChunk[] {
  const parser = new StreamParser();
  const results = parser.feed(chunk);
  results.push(...parser.flush());
  return results;
}

