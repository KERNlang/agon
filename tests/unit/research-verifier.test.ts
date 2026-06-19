// Pins the citation-verifier helpers. The DECISION logic (extractCitations,
// judgeProbe, formatCitationReport) is pure and fixture-tested; verifyCitations
// is exercised against a stubbed global fetch so no real network is touched.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractCitations,
  judgeProbe,
  formatCitationReport,
  verifyCitations,
  probeCitation,
} from '../../packages/core/src/generated/tools/research-verifier.js';
import type { CitationProbe } from '../../packages/core/src/generated/tools/research-verifier.js';

const probe = (over: Partial<CitationProbe>): CitationProbe => ({
  url: 'https://example.com/a',
  ok: true,
  status: 200,
  finalUrl: 'https://example.com/a',
  crossHostRedirect: false,
  sample: '',
  ...over,
});

describe('extractCitations', () => {
  it('pulls bare and markdown-link URLs and de-dupes', () => {
    const text = 'See https://a.com/x and [docs](https://b.org/y). Also https://a.com/x again.';
    expect(extractCitations(text)).toEqual(['https://a.com/x', 'https://b.org/y']);
  });

  it('trims trailing sentence punctuation and unbalanced brackets', () => {
    expect(extractCitations('ref: https://x.com/page.')).toEqual(['https://x.com/page']);
    expect(extractCitations('(see https://x.com/page)')).toEqual(['https://x.com/page']);
    expect(extractCitations('"https://x.com/q"')).toEqual(['https://x.com/q']);
  });

  it('keeps balanced parentheses inside a URL (Wikipedia-style)', () => {
    expect(extractCitations('see https://en.wikipedia.org/wiki/Example_(disambiguation)'))
      .toEqual(['https://en.wikipedia.org/wiki/Example_(disambiguation)']);
    // wrapped in an extra paren: drop only the unbalanced outer one
    expect(extractCitations('(ref https://en.wikipedia.org/wiki/Foo_(bar))'))
      .toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });

  it('ignores non-http(s) tokens and respects the cap', () => {
    expect(extractCitations('ftp://nope.com mailto:a@b.com no urls here')).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `https://h${i}.com`).join(' ');
    expect(extractCitations(many, 5)).toHaveLength(5);
  });
});

describe('judgeProbe', () => {
  it('verifies a live 200 with no cross-host redirect', () => {
    expect(judgeProbe(probe({ status: 200 })).verdict).toBe('verified');
  });

  it('marks >=400 as dead and network failures as unreachable', () => {
    expect(judgeProbe(probe({ status: 404 })).verdict).toBe('dead');
    expect(judgeProbe(probe({ status: 500 })).verdict).toBe('dead');
    expect(judgeProbe(probe({ ok: false, status: 0, error: 'dns' })).verdict).toBe('unreachable');
  });

  it('marks access-denied / rate-limited / bot-block statuses as blocked, not dead', () => {
    // npmjs.com and friends bot-block our re-fetch UA with 403 — the citation is
    // valid, just unconfirmable. 401/429/999 are the same "denied, not gone" shape.
    for (const status of [401, 403, 429, 999]) {
      const v = judgeProbe(probe({ status }));
      expect(v.verdict).toBe('blocked');
      expect(v.detail).toContain(String(status));
    }
  });

  it('marks a cross-host redirect (or unresolved 3xx) as redirected', () => {
    expect(judgeProbe(probe({ status: 200, crossHostRedirect: true })).verdict).toBe('redirected');
    expect(judgeProbe(probe({ status: 302 })).verdict).toBe('redirected');
  });

  it('marks a live page as irrelevant when no claim term appears', () => {
    const terms = ['quantum', 'entanglement'];
    expect(judgeProbe(probe({ sample: 'a page about cooking pasta' }), terms).verdict).toBe('irrelevant');
    expect(judgeProbe(probe({ sample: 'intro to quantum mechanics' }), terms).verdict).toBe('verified');
  });

  it('ignores claim terms shorter than 3 chars', () => {
    expect(judgeProbe(probe({ sample: 'nothing relevant' }), ['ab']).verdict).toBe('verified');
  });
});

describe('formatCitationReport', () => {
  it('summarizes verified/total and lists rejections with reasons', () => {
    const out = formatCitationReport({
      total: 2,
      verified: 1,
      blocked: 0,
      rejected: 1,
      results: [
        { url: 'https://ok.com', verdict: 'verified', httpStatus: 200, finalUrl: 'https://ok.com', detail: 'HTTP 200' },
        { url: 'https://dead.com', verdict: 'dead', httpStatus: 404, finalUrl: 'https://dead.com', detail: 'HTTP 404' },
      ],
    });
    expect(out).toMatch(/1\/2 verified/);
    expect(out).toContain('✓ [verified] https://ok.com');
    expect(out).toContain('✗ [dead] https://dead.com — HTTP 404');
  });

  it('notes blocked citations separately and marks them ⚠ (not ✗)', () => {
    const out = formatCitationReport({
      total: 2,
      verified: 1,
      blocked: 1,
      rejected: 0,
      results: [
        { url: 'https://ok.com', verdict: 'verified', httpStatus: 200, finalUrl: 'https://ok.com', detail: 'HTTP 200' },
        { url: 'https://www.npmjs.com/package/p-retry', verdict: 'blocked', httpStatus: 403, finalUrl: 'https://www.npmjs.com/package/p-retry', detail: 'HTTP 403 — access blocked' },
      ],
    });
    expect(out).toMatch(/1\/2 verified · 1 blocked/);
    expect(out).toContain('⚠ [blocked] https://www.npmjs.com/package/p-retry');
    expect(out).not.toContain('✗ [blocked]');
  });

  it('handles an empty report', () => {
    expect(formatCitationReport({ total: 0, verified: 0, blocked: 0, rejected: 0, results: [] })).toMatch(/no citations/i);
  });
});

// ── async path against a stubbed fetch ──
function mockFetch(map: Record<string, { status?: number; location?: string; contentType?: string; body?: string }>) {
  return vi.fn(async (url: string) => {
    const e = map[url] ?? { status: 200, contentType: 'text/plain', body: 'ok' };
    const status = e.status ?? 200;
    const headers = new Map<string, string>([['content-type', e.contentType ?? 'text/plain']]);
    if (e.location) headers.set('location', e.location);
    let read = false;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true, value: undefined };
            read = true;
            return { done: false, value: new TextEncoder().encode(e.body ?? '') };
          },
          cancel: async () => {},
        }),
      },
    };
  });
}

describe('verifyCitations (stubbed fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('probes each URL, judges it, and aggregates the report in input order', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'https://live.com/': { status: 200, body: 'all good' },
      'https://gone.com/': { status: 404, body: 'not found' },
    }));
    const report = await verifyCitations(['https://live.com/', 'https://gone.com/']);
    expect(report.total).toBe(2);
    expect(report.verified).toBe(1);
    expect(report.rejected).toBe(1);
    expect(report.results[0].verdict).toBe('verified');
    expect(report.results[1].verdict).toBe('dead');
  });

  it('counts a 403 bot-block as blocked (inconclusive), not rejected', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'https://live.com/': { status: 200, body: 'all good' },
      'https://blocked.com/': { status: 403, body: 'forbidden' },
    }));
    const report = await verifyCitations(['https://live.com/', 'https://blocked.com/']);
    expect(report.total).toBe(2);
    expect(report.verified).toBe(1);
    expect(report.blocked).toBe(1);
    expect(report.rejected).toBe(0);
    expect(report.results[1].verdict).toBe('blocked');
  });

  it('short-circuits an SSRF-blocked URL without a verified verdict', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const report = await verifyCitations(['http://169.254.169.254/latest/meta-data']);
    expect(report.verified).toBe(0);
    expect(report.results[0].verdict).toBe('unreachable');
  });

  it('honors an already-aborted signal (no verified results)', async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal('fetch', mockFetch({ 'https://live.com/': { status: 200, body: 'x' } }));
    const report = await verifyCitations(['https://live.com/'], undefined, 4, ac.signal);
    expect(report.verified).toBe(0);
  });

  it('probeCitation rejects a non-http scheme as unreachable', async () => {
    const p = await probeCitation('ftp://files.example.com/x');
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/http/i);
  });
});
