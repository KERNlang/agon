import type { SearchResult } from './tool-web-search.js';
export { cleanQuery, buildAuthoritativeRequest } from '@kernlang/agon-mod-research/discovery-policy';

export type ResearchIntent = 'package' | 'github' | 'standard' | 'rfc' | 'qa' | 'fact' | 'general';

/**
 * Heuristic intent classification for keyless routing. Precedence: qa -> github -> package -> rfc -> standard -> fact -> general (explicit tool-y keywords beat natural-language 'how/what' openers). The github lane is repo-search ONLY and the package lane is npm-ONLY — queries naming another ecosystem (PyPI/crates/RubyGems/...) or another GitHub entity (issues/PRs/commits) deliberately fall through rather than return wrong-target hits. Pure + deterministic.
 */
export function classifyQuery(query: string): ResearchIntent {
  const q = String(query ?? '').toLowerCase();
  // Explicit Q&A site mention → Stack Overflow lane (Stack Exchange API).
  if (/\b(stack\s?overflow|stackexchange)\b/.test(q)) return 'qa';
  // Repo lane = GitHub repository search ONLY. If the query names a GitHub
  // entity we can't keyless-search (issues/PRs/commits), do NOT claim it —
  // even when 'github'/'repo' also appears — so it falls through instead of
  // returning repositories for an issue/PR query and short-circuiting fallback.
  const githubEntity = /\b(pull[ -]?requests?|prs?|issues?|commits?)\b/.test(q);
  if (!githubEntity && /\b(github|repositor(?:y|ies)|repos?)\b/.test(q)) return 'github';
  // The package lane serves the npm registry ONLY. If the query names another
  // ecosystem (PyPI/crates/RubyGems/Maven/...), do NOT route to package — we'd
  // return wrong-ecosystem npm hits and short-circuit fallback. Let it through.
  const otherEcosystem = /\b(pypi|pip|python|cargo|crate|crates|rust|ruby|gem|gems|maven|gradle|composer|packagist|golang|go get|nuget)\b/.test(q);
  if (!otherEcosystem && /\b(npm|node|yarn|pnpm|packages?|librar(?:y|ies)|modules?|dependenc(?:y|ies))\b/.test(q)) return 'package';
  // IETF/RFC documents → datatracker; other web standards/specs → MDN search.
  if (/\brfc\b|\bietf\b|rfc\s*\d/.test(q)) return 'rfc';
  if (/\b(specs?|specification|standards?|w3c|whatwg|ecma|mdn|caniuse)\b/.test(q)) return 'standard';
  if (/^(who|what|when|where|why|how)\b/.test(q) || /\b(history of|definition of|meaning of|biography|wiki(?:pedia)?)\b/.test(q)) return 'fact';
  return 'general';
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
