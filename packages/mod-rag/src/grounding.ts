import type { RagHit, RagQueryResult } from './types.js';

export const RAG_GROUNDED_MIN_SCORE = 0.35;

export function isGrounded(hits: RagHit[]): boolean {
  return hits.length > 0 && hits[0].score >= RAG_GROUNDED_MIN_SCORE;
}

export function formatCitedBlocks(result: RagQueryResult): string {
  if (!result.grounded || result.hits.length === 0) return `(no grounded context for: ${result.query})`;
  return result.hits.map((hit, index) => {
    const excerpt = hit.text.length > 400 ? `${hit.text.slice(0, 400)}…` : hit.text;
    return `[${index + 1}] ${hit.source} L${hit.startLine}-${hit.endLine} (score ${hit.score.toFixed(2)})\n${excerpt.split('\n').map((line) => `    ${line}`).join('\n')}`;
  }).join('\n');
}

export function formatCitationFootnotes(hits: RagHit[]): string {
  return hits.map((hit, index) => `[${index + 1}] ${hit.source} L${hit.startLine}-${hit.endLine}`).join('\n');
}
