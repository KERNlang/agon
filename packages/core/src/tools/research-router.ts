import type { SearchRequest } from './tool-web-search.js';

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

export { parseAuthoritativeResults } from '@kernlang/agon-mod-research/response-policy';
