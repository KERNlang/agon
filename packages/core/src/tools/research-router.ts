import type { SearchResult, SearchRequest } from './tool-web-search.js';

import type { ResearchIntent } from '@kernlang/agon-mod-research/query-policy';
export { classifyQuery } from '@kernlang/agon-mod-research/query-policy';
export type { ResearchIntent } from '@kernlang/agon-mod-research/query-policy';

/**
 * Strip the routing/meta words (github, repo, npm, package, library, ...), leading question openers (who/what/when...), and a leading article (a/an/the) that selected the lane or only pollute the first-party search. Falls back to the trimmed original when stripping would empty a non-blank query, so it returns '' only for blank input. Pure.
 */
export function cleanQuery(query: string): string {
  const original = String(query ?? '').trim();
  let s = original;
  s = s.replace(/^(who|what|when|where|why|how)(\s+(is|are|was|were|did|does|do))?\s+/i, '');
  s = s.replace(/\b(github|repositor(?:y|ies)|repos?|pull[ -]?requests?|prs?|issues?|commits?|npm|pypi|pip|packages?|librar(?:y|ies)|modules?|dependenc(?:y|ies)|crate|gem)\b/gi, ' ');
  s = s.replace(/\b(mdn|rfc|ietf|w3c|whatwg|ecma|specs?|specification|standards?|caniuse|stack\s?overflow|stackexchange)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Drop a leading article the strips above may have surfaced
  // ('a charting library' -> 'a charting' -> 'charting') so it doesn't
  // pollute the first-party search ranking.
  s = s.replace(/^(an?|the)\s+/i, '').replace(/\s+/g, ' ').trim();
  // If stripping reduced the query to nothing meaningful — e.g. a slug like
  // 'github/github' collapsing to '/' — keep the original rather than search
  // garbage. Only return '' for genuinely blank input.
  return /[a-z0-9]/i.test(s) ? s : original;
}

/**
 * Build the keyless first-party search request for an intent, or null only for 'general' (which has no keyless authoritative lane and falls through to the keyed provider / no-key guidance). All lanes serve JSON over plain GET; a descriptive User-Agent is sent (GitHub and Wikimedia require one).
 */
export function buildAuthoritativeRequest(intent: ResearchIntent, query: string, count?: number): SearchRequest | null {
  const n = typeof count === 'number' && count > 0 ? Math.min(count, 10) : 5;
  const q = String(query ?? '').trim();
  if (!q) return null;
  const enc = encodeURIComponent(cleanQuery(q));
  const ua = 'agon-research/0.1 (+https://github.com/KERNlang/agon)';
  if (intent === 'package') {
    return {
      url: `https://registry.npmjs.org/-/v1/search?text=${enc}&size=${n}`,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ua },
    };
  }
  if (intent === 'github') {
    return {
      url: `https://api.github.com/search/repositories?q=${enc}&per_page=${n}`,
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': ua },
    };
  }
  if (intent === 'fact') {
    return {
      url: `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${enc}&limit=${n}`,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ua },
    };
  }
  if (intent === 'standard') {
    // MDN web-platform docs search (keyless JSON API).
    return {
      url: `https://developer.mozilla.org/api/v1/search?q=${enc}`,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ua },
    };
  }
  if (intent === 'rfc') {
    // IETF datatracker — prefer an explicit RFC number (rfc 7231 -> rfc7231)
    // for a precise hit; otherwise search document names by the cleaned text.
    const num = q.match(/\brfc\s*0*(\d{1,5})\b/i);
    const term = num ? `rfc${num[1]}` : cleanQuery(q);
    return {
      url: `https://datatracker.ietf.org/api/v1/doc/document/?format=json&limit=${n}&name__icontains=${encodeURIComponent(term)}`,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ua },
    };
  }
  if (intent === 'qa') {
    // Stack Overflow via the keyless Stack Exchange API (responses are gzip'd;
    // fetch decompresses automatically).
    return {
      url: `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=${n}&q=${enc}`,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ua },
    };
  }
  // general — no keyless first-party lane; caller falls through.
  return null;
}

/**
 * Normalize a first-party JSON response to SearchResult[] per intent (npm/GitHub/Wikipedia/MDN/IETF/Stack Overflow). Defensive: returns [] on malformed payloads, a shape mismatch, or an intent with no keyless lane — so a drifted endpoint degrades to a clean fall-through rather than emitting garbage.
 */
export function parseAuthoritativeResults(intent: ResearchIntent, raw: string): SearchResult[] {
  let data: any;
  try { data = JSON.parse(raw); } catch { return []; }
  const stripTags = (s: string): string => String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&rsquo;|&lsquo;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();

  if (intent === 'package') {
    const objs = Array.isArray(data?.objects) ? data.objects : [];
    return objs.map((o: any) => {
      const p = o?.package ?? {};
      const name = String(p?.name ?? '');
      const url = String(p?.links?.npm ?? p?.links?.homepage ?? (name ? `https://www.npmjs.com/package/${name}` : ''));
      return { title: name, url, snippet: String(p?.description ?? '') };
    }).filter((r: SearchResult) => r.url);
  }
  if (intent === 'github') {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((i: any) => ({
      title: String(i?.full_name ?? ''),
      url: String(i?.html_url ?? ''),
      snippet: String(i?.description ?? ''),
    })).filter((r: SearchResult) => r.url);
  }
  if (intent === 'fact') {
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    return pages.map((pg: any) => {
      const key = String(pg?.key ?? '');
      return {
        title: String(pg?.title ?? ''),
        url: key ? `https://en.wikipedia.org/wiki/${encodeURIComponent(key)}` : '',
        snippet: stripTags(String(pg?.description ?? pg?.excerpt ?? '')),
      };
    }).filter((r: SearchResult) => r.url);
  }
  if (intent === 'standard') {
    // MDN search → { documents: [{ mdn_url, title, summary }] }
    const docs = Array.isArray(data?.documents) ? data.documents : [];
    return docs.map((d: any) => {
      const slug = String(d?.mdn_url ?? '');
      const url = slug ? (slug.startsWith('http') ? slug : `https://developer.mozilla.org${slug}`) : '';
      return { title: String(d?.title ?? ''), url, snippet: stripTags(String(d?.summary ?? '')) };
    }).filter((r: SearchResult) => r.url);
  }
  if (intent === 'rfc') {
    // IETF datatracker → { objects: [{ name, title }] }
    const objs = Array.isArray(data?.objects) ? data.objects : [];
    return objs.map((o: any) => {
      const name = String(o?.name ?? '');
      const title = String(o?.title ?? '');
      return {
        title: (name ? name.toUpperCase() : title) + (name && title ? ` — ${title}` : ''),
        url: name ? `https://datatracker.ietf.org/doc/${encodeURIComponent(name)}/` : '',
        snippet: title || stripTags(String(o?.abstract ?? '')),
      };
    }).filter((r: SearchResult) => r.url);
  }
  if (intent === 'qa') {
    // Stack Exchange → { items: [{ title, link, score, is_answered }] }
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((it: any) => ({
      title: stripTags(String(it?.title ?? '')),
      url: String(it?.link ?? ''),
      snippet: `${it?.is_answered ? 'answered' : 'unanswered'} · score ${Number(it?.score ?? 0)}`,
    })).filter((r: SearchResult) => r.url);
  }
  return [];
}
