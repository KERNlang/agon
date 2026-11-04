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
