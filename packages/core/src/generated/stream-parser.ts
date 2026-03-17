export interface ParsedChunk {
  type: 'text'|'status'|'result'|'raw';
  content: string;
}



export function parseStreamChunk(chunk: string): ParsedChunk[] {
  const results: ParsedChunk[] = [];
  
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
  
    try {
      const msg = JSON.parse(line);
  
      // Claude Code stream-json: assistant message with content blocks
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            results.push({ type: 'text', content: block.text });
          }
        }
        continue;
      }
  
      // Claude Code stream-json: final result
      if (msg.type === 'result') {
        if (msg.result) {
          results.push({ type: 'result', content: typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result) });
        }
        // Also capture error (e.g. "Reached max turns")
        if (msg.is_error || msg.error) {
          const errMsg = msg.error ?? msg.result ?? 'Unknown error';
          results.push({ type: 'status', content: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg) });
        }
        continue;
      }
  
      // Claude Code stream-json: system status
      if (msg.type === 'system') {
        if (msg.message) results.push({ type: 'status', content: msg.message });
        continue;
      }
  
      // Unknown JSON — skip
      continue;
    } catch {
      // Not JSON — treat as raw text (Codex, Gemini, etc.)
      results.push({ type: 'raw', content: line });
    }
  }
  
  return results;
  
}

