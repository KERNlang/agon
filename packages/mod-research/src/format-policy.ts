export interface ResearchFormatInput {
  ok: boolean;
  answer: string;
  intent: string;
  engineId: string;
  sources: Array<{ title: string; url: string }>;
  citations: {
    total: number;
    verified: number;
    blocked: number;
    results: Array<{ url: string; verdict: string; detail: string }>;
  };
  note?: string | undefined;
}

export function formatResearchResult<T extends ResearchFormatInput>(r: T): string {
  if (!r.ok) return r.note ? `Research produced no grounded answer — ${r.note}` : 'Research produced no grounded answer.';
  const lines: string[] = [];
  lines.push(r.answer);
  lines.push('');
  const blockedNote = r.citations.blocked ? ` · ${r.citations.blocked} blocked` : '';
  lines.push(`Sources (${r.sources.length}) · citations ${r.citations.verified}/${r.citations.total} verified${blockedNote} · ${r.intent} · engine ${r.engineId}`);
  r.sources.forEach((s, i) => {
    lines.push(`  [${i + 1}] ${s.title || s.url}`);
    lines.push(`      ${s.url}`);
  });
  // Genuinely-bad citations (dead/redirected/unreachable/irrelevant) are a trust
  // problem; `blocked` ones (host refused OUR re-fetch) are merely unconfirmed —
  // keep them visually distinct so a bot-blocked-but-valid link isn't read as broken.
  const failed = r.citations.results.filter((c) => c.verdict !== 'verified' && c.verdict !== 'blocked');
  if (failed.length > 0) {
    lines.push('');
    lines.push('⚠ Unverified citations:');
    failed.forEach((c) => lines.push(`  ✗ [${c.verdict}] ${c.url} — ${c.detail}`));
  }
  const blocked = r.citations.results.filter((c) => c.verdict === 'blocked');
  if (blocked.length > 0) {
    lines.push('');
    lines.push('ⓘ Could not verify (host blocked our re-fetch — citation not disproven):');
    blocked.forEach((c) => lines.push(`  ⚠ [${c.verdict}] ${c.url} — ${c.detail}`));
  }
  return lines.join('\n');
}


