// Pins the research helpers. The pure parts (buildResearchPrompt,
// formatResearchResult) are fixture-tested; runResearch is exercised only on its
// no-network early-exit paths (empty question / no keyless lane) — the full
// discover→fetch→draft→verify happy path needs a live engine + egress and is
// verified by a real run, not here.
import { describe, it, expect } from 'vitest';
import {
  buildResearchPrompt,
  formatResearchResult,
  runResearch,
} from '../../packages/forge/src/generated/research.js';
import type { ResearchResult } from '../../packages/forge/src/generated/research.js';

describe('buildResearchPrompt', () => {
  it('includes the question, numbered sources with URLs + content, and citation rules', () => {
    const prompt = buildResearchPrompt('How does fetch work?', [
      { title: 'fetch()', url: 'https://mdn.example/fetch', content: 'The fetch() method starts a request.' },
      { title: 'Using Fetch', url: 'https://mdn.example/using', snippet: 'a guide' },
    ]);
    expect(prompt).toContain('How does fetch work?');
    expect(prompt).toContain('[1] fetch()');
    expect(prompt).toContain('https://mdn.example/fetch');
    expect(prompt).toContain('The fetch() method starts a request.');
    expect(prompt).toContain('[2] Using Fetch');
    expect(prompt).toMatch(/cite/i);
    expect(prompt).toMatch(/Sources:/);
    expect(prompt).toMatch(/ONLY the SOURCES/i);
  });

  it('falls back to the snippet when no fetched content is present', () => {
    const prompt = buildResearchPrompt('q', [{ title: 'T', url: 'https://x', snippet: 'snippet text' }]);
    expect(prompt).toContain('snippet text');
  });
});

const ok = (over: Partial<ResearchResult>): ResearchResult => ({
  ok: true,
  question: 'q',
  intent: 'standard',
  engineId: 'codex',
  answer: 'The answer [1].',
  sources: [{ title: 'Doc A', url: 'https://a.example', snippet: '', fetched: true }],
  citations: { total: 1, verified: 1, blocked: 0, rejected: 0, results: [{ url: 'https://a.example', verdict: 'verified', httpStatus: 200, finalUrl: 'https://a.example', detail: 'HTTP 200' }] },
  outputDir: '/tmp',
  ...over,
});

describe('formatResearchResult', () => {
  it('renders the cited answer, source list, and a verified summary', () => {
    const out = formatResearchResult(ok({}));
    expect(out).toContain('The answer [1].');
    expect(out).toContain('1/1 verified');
    expect(out).toContain('[1] Doc A');
    expect(out).toContain('https://a.example');
    expect(out).not.toMatch(/Unverified/);
  });

  it('flags unverified citations', () => {
    const out = formatResearchResult(ok({
      citations: { total: 1, verified: 0, blocked: 0, rejected: 1, results: [{ url: 'https://dead.example', verdict: 'dead', httpStatus: 404, finalUrl: 'https://dead.example', detail: 'HTTP 404' }] },
    }));
    expect(out).toMatch(/Unverified citations/);
    expect(out).toContain('✗ [dead] https://dead.example — HTTP 404');
  });

  it('separates a blocked citation from genuine failures (not disproven)', () => {
    const out = formatResearchResult(ok({
      citations: {
        total: 2,
        verified: 1,
        blocked: 1,
        rejected: 0,
        results: [
          { url: 'https://a.example', verdict: 'verified', httpStatus: 200, finalUrl: 'https://a.example', detail: 'HTTP 200' },
          { url: 'https://www.npmjs.com/package/p-retry', verdict: 'blocked', httpStatus: 403, finalUrl: 'https://www.npmjs.com/package/p-retry', detail: 'HTTP 403 — access blocked or rate-limited (citation not disproven)' },
        ],
      },
    }));
    expect(out).toMatch(/1\/2 verified · 1 blocked/);
    expect(out).toMatch(/Could not verify/);
    expect(out).toContain('⚠ [blocked] https://www.npmjs.com/package/p-retry');
    // a blocked citation must NOT be filed under the genuine-failure "✗" list
    expect(out).not.toMatch(/Unverified citations/);
  });

  it('renders a failure note when ok is false', () => {
    const out = formatResearchResult({ ok: false, question: 'q', intent: 'general', engineId: '', answer: '', sources: [], citations: { total: 0, verified: 0, blocked: 0, rejected: 0, results: [] }, outputDir: '/tmp', note: 'no engine available' });
    expect(out).toMatch(/no grounded answer/i);
    expect(out).toContain('no engine available');
  });
});

describe('runResearch (no-network early exits)', () => {
  const base = { engines: [] as string[], registry: {} as never, adapter: {} as never, timeout: 1, outputDir: '/tmp' };

  it('returns guidance for a general query that has no keyless lane', async () => {
    const r = await runResearch({ ...base, question: 'best pizza near me tonight' });
    expect(r.ok).toBe(false);
    expect(r.intent).toBe('general');
    expect(r.note).toMatch(/no keyless authoritative lane/i);
  });

  it('rejects an empty question before any work', async () => {
    const r = await runResearch({ ...base, question: '   ' });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/empty question/i);
  });
});
