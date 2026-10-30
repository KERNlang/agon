export interface Source {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  fetched: boolean;
}

/** Keep legacy prompt bytes stable while the runtime moves to its owner. */
export function buildResearchPrompt(question: string, sources: { title:string; url:string; snippet?:string; content?:string }[]): string {
  const lines: string[] = [];
  lines.push('You are a careful research assistant. Answer the QUESTION using ONLY the SOURCES below.');
  lines.push('Do NOT use prior knowledge or invent facts or URLs. If the sources do not answer the question, say so plainly.');
  lines.push('');
  lines.push('QUESTION:');
  lines.push(String(question ?? '').trim());
  lines.push('');
  lines.push('SOURCES:');
  (sources ?? []).forEach((s, i) => {
    lines.push(`[${i + 1}] ${s.title || s.url}`);
    lines.push(`    ${s.url}`);
    const body = String(s.content ?? '').trim() || String(s.snippet ?? '').trim();
    if (body) lines.push(`    ${body.replace(/\s+/g, ' ').slice(0, 3500)}`);
    lines.push('');
  });
  lines.push('INSTRUCTIONS:');
  lines.push('1. Answer the question directly and concisely, grounded in the sources.');
  lines.push('2. Cite every claim inline with the source number in brackets, e.g. [1], [2].');
  lines.push('3. Do not cite a source you did not use; do not invent sources or URLs.');
  lines.push('4. End with a "Sources:" section listing each [n] and its URL.');
  return lines.join('\n');
}

/** Keep the physical runtime format distinct until runtime convergence. */
export function buildPrompt(question: string, sources: Source[]) {
  return `Answer the QUESTION using ONLY the numbered SOURCES. Cite every factual claim inline as [n]. Never invent URLs or facts. If evidence is insufficient, say so.\n\nQUESTION:\n${question}\n\nSOURCES:\n${sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.content || s.snippet}`).join("\n\n")}`;
}
