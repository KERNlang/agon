// RED test for WebSearch (other half of Cesar gap #2). Pins the pure,
// provider-agnostic helpers before wiring the tool: request construction and
// result parsing for Brave + Tavily. No network in these tests — the live
// path is keyed and covered by a smoke check separately.
import { describe, it, expect } from 'vitest';
import {
  buildSearchRequest,
  parseSearchResults,
  formatSearchResults,
  createWebSearchTool,
} from '../../packages/core/src/generated/tools/tool-web-search.js';

describe('buildSearchRequest', () => {
  it('builds a Brave GET with the subscription-token header', () => {
    const r = buildSearchRequest('brave', 'rust async traits', 'KEY123', 5);
    expect(r.method).toBe('GET');
    expect(r.url).toContain('api.search.brave.com');
    expect(r.url).toContain('q=rust+async+traits');
    expect(r.url).toContain('count=5');
    expect(r.headers['X-Subscription-Token']).toBe('KEY123');
    expect(r.body).toBeUndefined();
  });

  it('builds a Tavily POST with the key + query in the body', () => {
    const r = buildSearchRequest('tavily', 'rust async traits', 'KEY123', 5);
    expect(r.method).toBe('POST');
    expect(r.url).toContain('api.tavily.com');
    const body = JSON.parse(r.body ?? '{}');
    expect(body.api_key).toBe('KEY123');
    expect(body.query).toBe('rust async traits');
    expect(body.max_results).toBe(5);
  });
});

describe('parseSearchResults', () => {
  it('normalizes Brave JSON to {title,url,snippet}', () => {
    const raw = JSON.stringify({ web: { results: [
      { title: 'Rust Async', url: 'https://rust-lang.org/async', description: 'Async in Rust' },
    ] } });
    expect(parseSearchResults('brave', raw)).toEqual([
      { title: 'Rust Async', url: 'https://rust-lang.org/async', snippet: 'Async in Rust' },
    ]);
  });

  it('normalizes Tavily JSON to {title,url,snippet}', () => {
    const raw = JSON.stringify({ results: [
      { title: 'Tokio', url: 'https://tokio.rs', content: 'Async runtime' },
    ] });
    expect(parseSearchResults('tavily', raw)).toEqual([
      { title: 'Tokio', url: 'https://tokio.rs', snippet: 'Async runtime' },
    ]);
  });

  it('returns [] for malformed payloads', () => {
    expect(parseSearchResults('brave', 'not json')).toEqual([]);
    expect(parseSearchResults('tavily', '{}')).toEqual([]);
  });
});

describe('formatSearchResults', () => {
  it('renders a numbered, readable list', () => {
    const out = formatSearchResults([
      { title: 'A', url: 'https://a', snippet: 'first' },
      { title: 'B', url: 'https://b', snippet: 'second' },
    ]);
    expect(out).toContain('1.');
    expect(out).toContain('A');
    expect(out).toContain('https://a');
    expect(out).toContain('first');
  });

  it('handles an empty result set', () => {
    expect(formatSearchResults([])).toMatch(/no results/i);
  });
});

describe('createWebSearchTool', () => {
  it('exposes a read-only WebSearch definition', () => {
    const tool = createWebSearchTool();
    expect(tool.definition.name).toBe('WebSearch');
    expect(tool.definition.isReadOnly).toBe(true);
  });

  it('validate requires a non-empty query', () => {
    const tool = createWebSearchTool();
    const ctx = { cwd: process.cwd(), readFileState: new Map() } as never;
    expect(tool.validate({ query: '' }, ctx)).toBeTruthy();
    expect(tool.validate({ query: 'hello' }, ctx)).toBeNull();
  });
});
