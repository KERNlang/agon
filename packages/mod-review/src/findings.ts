const REVIEW_SENTINEL = '<!--AGON_REVIEW_FINDINGS_v1-->';

export function extractReviewFindings(response: string): Array<{severity?:string, blocking?:boolean}> | null {
  if (!response || response.trim().length === 0) return null;
  
  const sentinel = REVIEW_SENTINEL;
  const lastSentinelIdx = response.lastIndexOf(sentinel);
  if (lastSentinelIdx < 0) return null;
  
  const tail = response.slice(lastSentinelIdx + sentinel.length).trim();
  if (!tail) return null;
  
  // Engine-AGNOSTIC JSON tolerance. LLMs routinely emit *almost*-JSON: a
  // trailing comma before the closing bracket (e.g. kimi's `...}]`→`...},]`),
  // // or /* */ comments annotating findings, etc. Rather than special-casing
  // any one engine, we strict-parse first and, ONLY on failure, retry against
  // a string-aware "relaxed" copy. The relax pass is string-aware (it never
  // touches commas/slashes inside a JSON string value), so it can't corrupt
  // findings text.
  const relaxJsonString = (raw: string): string => {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) {
        out += ch;
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; out += ch; continue; }
      if (ch === '/' && raw[i + 1] === '/') { i += 1; while (i + 1 < raw.length && raw[i + 1] !== '\n') i += 1; continue; }
      if (ch === '/' && raw[i + 1] === '*') { i += 1; while (i + 1 < raw.length && !(raw[i + 1] === '*' && raw[i + 2] === '/')) i += 1; i += 2; continue; }
      if (ch === ',') {
        let j = i + 1;
        while (j < raw.length && /\s/.test(raw[j])) j += 1;
        if (j < raw.length && (raw[j] === ']' || raw[j] === '}')) continue;
      }
      out += ch;
    }
    return out;
  };
  
  // Parse the first balanced [...] array found in `text`. String-aware so
  // brackets inside string values don't skew the depth count. Returns the
  // array or null (no array / unbalanced / invalid JSON / non-array).
  const tryArrayFrom = (text: string): Array<{ severity?: string; blocking?: boolean }> | null => {
    const start = text.indexOf('[');
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;
    const candidate = text.slice(start, end + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      try { parsed = JSON.parse(relaxJsonString(candidate)); }
      catch { return null; }
    }
    if (!Array.isArray(parsed)) return null;
    return parsed as Array<{ severity?: string; blocking?: boolean }>;
  };
  
  // Tolerant extraction (A): the first balanced [...] array anywhere in the
  // post-sentinel tail, ignoring surrounding scaffolding (a ```json fence or
  // trailing prose). Only text AFTER the LAST sentinel is considered, so
  // attacker brackets injected earlier in the diff are never seen.
  const primary = tryArrayFrom(tail);
  if (primary) return primary;
  
  // Fallback (b): retry on the body of the LAST fenced code block in the tail
  // — engines that wrap machine output in ```json usually put the array there.
  const fences = [...tail.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fences.length - 1; i >= 0; i--) {
    const fenced = tryArrayFrom(fences[i][1] ?? '');
    if (fenced) return fenced;
  }
  
  return null;
}
