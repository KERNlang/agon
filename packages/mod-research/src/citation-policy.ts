export type CitationStatus = 'verified' | 'dead' | 'redirected' | 'unreachable' | 'irrelevant' | 'blocked';

export interface CitationProbe {
  url: string;
  ok: boolean;
  status: number;
  finalUrl: string;
  crossHostRedirect: boolean;
  sample: string;
  error?: string;
}

export interface CitationVerdict {
  url: string;
  verdict: CitationStatus;
  httpStatus: number;
  finalUrl: string;
  detail: string;
}

export interface CitationReport {
  total: number;
  verified: number;
  rejected: number;
  blocked: number;
  results: CitationVerdict[];
}

/**
 * Pull the http(s) URLs out of a (markdown or plain) answer — covers markdown links and bare URLs. KEEPS balanced parens/brackets inside a URL (e.g. .../Example_(disambiguation)) but trims trailing sentence punctuation and an UNbalanced closing bracket/paren (from `(see https://x)`). De-dupes case-insensitively, caps the count (default 20, hard max 50). Pure.
 */
export function extractCitations(text: string, max?: number): string[] {
  const cap = typeof max === 'number' && max > 0 ? Math.min(max, 50) : 20;
  const s = String(text ?? '');
  const urls: string[] = [];
  const seen = new Set<string>();
  // Allow brackets/parens in the body (Wikipedia-style URLs); only whitespace,
  // angle brackets and quotes terminate the match. Unbalanced trailing brackets
  // are trimmed afterwards so a wrapping `(…)`/`[…]` doesn't corrupt the URL.
  const re = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  const count = (str: string, ch: string): number => {
    let k = 0;
    for (const c of str) if (c === ch) k++;
    return k;
  };
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    let u = m[0].replace(/[.,;:!?]+$/, '');
    // Drop trailing closers that have no matching opener inside the URL.
    let trimmed = true;
    while (trimmed && u.length > 0) {
      trimmed = false;
      const last = u[u.length - 1];
      const opener = closers[last];
      if (opener && count(u, last) > count(u, opener)) {
        u = u.slice(0, -1).replace(/[.,;:!?]+$/, '');
        trimmed = true;
      }
    }
    if (!u) continue;
    const key = u.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      urls.push(u);
      if (urls.length >= cap) break;
    }
  }
  return urls;
}

/**
 * Classify a probe outcome into a verdict. unreachable (no response) -> blocked (401/403/429/999: access denied / rate-limited / bot-block — NOT disproven) -> dead (other >=400: gone) -> redirected (unresolved 3xx OR resolved to a different host) -> irrelevant (claimTerms given but none appear in the page sample) -> verified. Pure + deterministic. The blocked/dead split matters: bot-protected hosts (e.g. npmjs.com) 403 our re-fetch even though the citation is perfectly valid — calling that 'dead' is a false negative.
 */
export function judgeProbe(probe: CitationProbe, claimTerms?: string[]): CitationVerdict {
  const base = { url: probe.url, httpStatus: probe.status, finalUrl: probe.finalUrl || probe.url };
  if (!probe.ok) {
    return { ...base, verdict: 'unreachable', detail: probe.error || 'no response' };
  }
  // Auth / forbidden / rate-limit / bot-block: the resource almost certainly
  // EXISTS — access was denied or throttled. That is inconclusive, not dead.
  if (probe.status === 401 || probe.status === 403 || probe.status === 429 || probe.status === 999) {
    return { ...base, verdict: 'blocked', detail: `HTTP ${probe.status} — access blocked or rate-limited (citation not disproven)` };
  }
  if (probe.status >= 400) {
    return { ...base, verdict: 'dead', detail: `HTTP ${probe.status}` };
  }
  if (probe.status >= 300) {
    return { ...base, verdict: 'redirected', detail: `unresolved redirect (HTTP ${probe.status})` };
  }
  if (probe.crossHostRedirect) {
    return { ...base, verdict: 'redirected', detail: `redirected to a different host: ${probe.finalUrl}` };
  }
  // Only run the relevance check against claim terms long enough to be
  // meaningful (>2 chars). If every supplied term is noise, skip the check
  // rather than reject a live page on no real signal.
  const usableTerms = (Array.isArray(claimTerms) ? claimTerms : [])
    .map((t) => String(t ?? '').toLowerCase().trim())
    .filter((k) => k.length > 2);
  if (usableTerms.length > 0) {
    const hay = String(probe.sample ?? '').toLowerCase();
    if (!usableTerms.some((k) => hay.includes(k))) {
      return { ...base, verdict: 'irrelevant', detail: 'page text does not mention the cited terms' };
    }
  }
  return { ...base, verdict: 'verified', detail: `HTTP ${probe.status}` };
}

/**
 * Render a CitationReport as a readable verified/total summary (plus a `· N blocked` note when any host refused our re-fetch) and one line per citation: ✓ verified, ⚠ blocked (inconclusive), ✗ + reason otherwise.
 */
export function formatCitationReport(report: CitationReport): string {
  if (!report || report.total === 0) return 'No citations to verify.';
  const lines = report.results.map((r) => {
    const mark = r.verdict === 'verified' ? '✓' : r.verdict === 'blocked' ? '⚠' : '✗';
    const why = r.verdict === 'verified' ? '' : ` — ${r.detail}`;
    return `${mark} [${r.verdict}] ${r.url}${why}`;
  });
  const blocked = report.blocked ? ` · ${report.blocked} blocked` : '';
  return `Citations: ${report.verified}/${report.total} verified${blocked}\n` + lines.join('\n');
}
