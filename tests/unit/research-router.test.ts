// Pins the pure, keyless research-router helpers before they back WebSearch:
// intent classification, first-party request construction (npm/GitHub/Wikipedia),
// and JSON parsing. No network here — the live fetch lives in tool-web-search.
import { describe, it, expect } from 'vitest';
import {
  classifyQuery,
  cleanQuery,
  buildAuthoritativeRequest,
  parseAuthoritativeResults,
} from '../../packages/core/src/generated/tools/research-router.js';

describe('classifyQuery', () => {
  it('routes npm package/library queries to the package lane', () => {
    expect(classifyQuery('how do I install the express npm package')).toBe('package');
    expect(classifyQuery('best react charting library')).toBe('package');
    expect(classifyQuery('a node module for parsing yaml')).toBe('package');
  });

  it('does NOT route other-ecosystem package queries to the npm lane', () => {
    // npm-only lane in this slice — PyPI/crates/RubyGems queries must fall
    // through rather than be mis-served as npm hits (no keyless lane for them).
    expect(classifyQuery('pip module for parsing yaml')).toBe('general');
    expect(classifyQuery('a python package for parsing yaml')).toBe('general');
    expect(classifyQuery('rust crate for an async runtime')).toBe('general');
    expect(classifyQuery('ruby gem for http requests')).toBe('general');
  });

  it('routes repo queries to github', () => {
    expect(classifyQuery('sst/opencode github repo')).toBe('github');
    expect(classifyQuery('the vitest repository')).toBe('github');
  });

  it('does not claim github issue/PR search even when "github"/"repo" appears', () => {
    // repo lane only — an issue/PR/commit query falls through rather than
    // returning repositories (no keyless lane for those entities).
    expect(classifyQuery('list open pull requests')).toBe('general');
    expect(classifyQuery('github pull request for vitest')).toBe('general');
    expect(classifyQuery('open issues on the vitest repository')).toBe('general');
  });

  it('routes RFC/IETF queries to rfc and other specs to standard', () => {
    expect(classifyQuery('RFC 7231 HTTP semantics')).toBe('rfc');
    expect(classifyQuery('IETF draft for HTTP')).toBe('rfc');
    expect(classifyQuery('the WHATWG URL spec')).toBe('standard');
    expect(classifyQuery('the ECMAScript specification')).toBe('standard');
    expect(classifyQuery('MDN fetch documentation')).toBe('standard');
  });

  it('routes explicit Stack Overflow queries to qa', () => {
    expect(classifyQuery('stack overflow question on async await')).toBe('qa');
    expect(classifyQuery('stackexchange thread about regex')).toBe('qa');
  });

  it('routes natural-language questions to fact', () => {
    expect(classifyQuery('who is Ada Lovelace')).toBe('fact');
    expect(classifyQuery('what is the capital of France')).toBe('fact');
  });

  it('falls back to general for everything else', () => {
    expect(classifyQuery('best pizza near me tonight')).toBe('general');
    expect(classifyQuery('')).toBe('general');
  });

  it('lets tool-y keywords win over a question opener', () => {
    // "how" opener, but it is really a package query → package, not fact
    expect(classifyQuery('how to install the lodash npm package')).toBe('package');
  });
});

describe('cleanQuery', () => {
  it('strips routing/meta nouns that only pollute the search', () => {
    expect(cleanQuery('sst/opencode github repository')).toBe('sst/opencode');
    expect(cleanQuery('react query npm package')).toBe('react query');
  });

  it('drops a leading article surfaced by the noun strip', () => {
    expect(cleanQuery('a charting library')).toBe('charting');
  });

  it('strips leading question openers (and any leading article)', () => {
    expect(cleanQuery('who is Ada Lovelace')).toBe('Ada Lovelace');
    expect(cleanQuery('what is the capital of France')).toBe('capital of France');
  });

  it('never returns empty — falls back to the trimmed original', () => {
    expect(cleanQuery('npm package')).toBe('npm package');
    expect(cleanQuery('   ')).toBe('');
  });

  it('keeps the original when stripping would gut a slug to punctuation', () => {
    // 'github/github' would collapse to '/'; keep the original instead of
    // searching garbage (a routing word appearing inside a real identifier).
    expect(cleanQuery('github/github repository')).toBe('github/github repository');
  });
});

describe('buildAuthoritativeRequest', () => {
  it('strips routing words from the query before searching', () => {
    const r = buildAuthoritativeRequest('github', 'sst/opencode github repository', 3);
    expect(r!.url).toContain('q=sst%2Fopencode');
    expect(r!.url).not.toContain('repository');
  });

  it('builds a keyless npm registry GET for package intent', () => {
    const r = buildAuthoritativeRequest('package', 'react query', 5);
    expect(r).not.toBeNull();
    expect(r!.method).toBe('GET');
    expect(r!.url).toContain('registry.npmjs.org/-/v1/search');
    expect(r!.url).toContain('text=react%20query');
    expect(r!.url).toContain('size=5');
    expect(r!.headers['User-Agent']).toMatch(/agon-research/);
    expect(r!.body).toBeUndefined();
  });

  it('builds a keyless GitHub repo-search GET with a User-Agent', () => {
    const r = buildAuthoritativeRequest('github', 'vitest', 3);
    expect(r!.url).toContain('api.github.com/search/repositories');
    expect(r!.url).toContain('q=vitest');
    expect(r!.url).toContain('per_page=3');
    // GitHub rejects requests without a User-Agent
    expect(r!.headers['User-Agent']).toMatch(/agon-research/);
  });

  it('builds a keyless Wikipedia REST GET for fact intent', () => {
    const r = buildAuthoritativeRequest('fact', 'Ada Lovelace', 5);
    expect(r!.url).toContain('en.wikipedia.org/w/rest.php/v1/search/page');
    expect(r!.url).toContain('q=Ada%20Lovelace');
  });

  it('clamps count to 1..10', () => {
    expect(buildAuthoritativeRequest('package', 'x', 99)!.url).toContain('size=10');
    expect(buildAuthoritativeRequest('package', 'x', 0)!.url).toContain('size=5');
  });

  it('returns null only for general (every other intent now has a keyless lane)', () => {
    expect(buildAuthoritativeRequest('general', 'pizza', 5)).toBeNull();
  });

  it('builds keyless MDN / IETF / Stack Overflow GETs', () => {
    expect(buildAuthoritativeRequest('standard', 'fetch api', 3)!.url).toContain('developer.mozilla.org/api/v1/search');
    const rfc = buildAuthoritativeRequest('rfc', 'RFC 7231 semantics', 3)!;
    expect(rfc.url).toContain('datatracker.ietf.org/api/v1/doc/document');
    expect(rfc.url).toContain('name__icontains=rfc7231'); // explicit number extracted
    const qa = buildAuthoritativeRequest('qa', 'stack overflow how to debounce', 3)!;
    expect(qa.url).toContain('api.stackexchange.com');
    expect(qa.url).toContain('site=stackoverflow');
    expect(qa.url).toContain('pagesize=3');
  });

  it('returns null for an empty query', () => {
    expect(buildAuthoritativeRequest('package', '   ', 5)).toBeNull();
  });
});

describe('parseAuthoritativeResults', () => {
  it('normalizes npm registry search JSON', () => {
    const raw = JSON.stringify({
      objects: [
        { package: { name: 'react-query', description: 'Hooks for fetching', links: { npm: 'https://www.npmjs.com/package/react-query' } } },
      ],
    });
    expect(parseAuthoritativeResults('package', raw)).toEqual([
      { title: 'react-query', url: 'https://www.npmjs.com/package/react-query', snippet: 'Hooks for fetching' },
    ]);
  });

  it('falls back to a constructed npm URL when links are absent', () => {
    const raw = JSON.stringify({ objects: [{ package: { name: 'left-pad', description: 'pad' } }] });
    expect(parseAuthoritativeResults('package', raw)[0].url).toBe('https://www.npmjs.com/package/left-pad');
  });

  it('normalizes GitHub repo-search JSON', () => {
    const raw = JSON.stringify({
      items: [{ full_name: 'sst/opencode', html_url: 'https://github.com/sst/opencode', description: 'coding agent' }],
    });
    expect(parseAuthoritativeResults('github', raw)).toEqual([
      { title: 'sst/opencode', url: 'https://github.com/sst/opencode', snippet: 'coding agent' },
    ]);
  });

  it('normalizes Wikipedia REST JSON and strips excerpt HTML', () => {
    const raw = JSON.stringify({
      pages: [{ key: 'Ada_Lovelace', title: 'Ada Lovelace', excerpt: 'English <span class="searchmatch">mathematician</span>' }],
    });
    expect(parseAuthoritativeResults('fact', raw)).toEqual([
      { title: 'Ada Lovelace', url: 'https://en.wikipedia.org/wiki/Ada_Lovelace', snippet: 'English mathematician' },
    ]);
  });

  it('decodes HTML entities in Wikipedia excerpts', () => {
    const raw = JSON.stringify({
      pages: [{ key: 'Tom_and_Jerry', title: 'Tom and Jerry', excerpt: 'Tom &amp; Jerry &lt;cartoon&gt; &quot;classic&quot;' }],
    });
    expect(parseAuthoritativeResults('fact', raw)[0].snippet).toBe('Tom & Jerry <cartoon> "classic"');
  });

  it('normalizes MDN search JSON', () => {
    const raw = JSON.stringify({ documents: [{ mdn_url: '/en-US/docs/Web/API/fetch', title: 'fetch()', summary: 'The <code>fetch()</code> method' }] });
    expect(parseAuthoritativeResults('standard', raw)).toEqual([
      { title: 'fetch()', url: 'https://developer.mozilla.org/en-US/docs/Web/API/fetch', snippet: 'The fetch() method' },
    ]);
  });

  it('normalizes IETF datatracker JSON', () => {
    const raw = JSON.stringify({ objects: [{ name: 'rfc7231', title: 'HTTP/1.1 Semantics and Content' }] });
    const r = parseAuthoritativeResults('rfc', raw);
    expect(r[0].url).toBe('https://datatracker.ietf.org/doc/rfc7231/');
    expect(r[0].title).toContain('RFC7231');
    expect(r[0].snippet).toBe('HTTP/1.1 Semantics and Content');
  });

  it('normalizes Stack Overflow JSON and decodes entities in the title', () => {
    const raw = JSON.stringify({ items: [{ title: 'How to use Array&lt;T&gt;', link: 'https://stackoverflow.com/q/1', score: 42, is_answered: true }] });
    const r = parseAuthoritativeResults('qa', raw);
    expect(r[0].title).toBe('How to use Array<T>');
    expect(r[0].url).toBe('https://stackoverflow.com/q/1');
    expect(r[0].snippet).toContain('answered');
  });

  it('returns [] for malformed payloads and unrouted intents', () => {
    expect(parseAuthoritativeResults('package', 'not json')).toEqual([]);
    expect(parseAuthoritativeResults('github', '{}')).toEqual([]);
    expect(parseAuthoritativeResults('general', '{}')).toEqual([]);
  });
});
