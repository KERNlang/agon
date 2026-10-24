import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
import { classifyQuery, formatResearchResult, isBlockedAddress, resolvePublicHost, runResearch, validateUrl } from './implementation.js';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });
const context = { invocationId: 'r', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
function services(answer = 'Supported claim [1].') {
  return { identity: {}, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record: vi.fn(async () => 'r') },
    permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() },
    runs: { start: vi.fn(async () => ({ id: 'run', path: '/tmp/run', mode: 'research', startedAt: '2026-01-01T00:00:00Z' })), finish: vi.fn(async () => undefined) },
    engines: { listActive: vi.fn(async () => ['writer']), dispatch: vi.fn(async () => ({ exitCode: 0, stdout: answer })) } } as unknown as ModServices;
}
describe('physical research mod', () => {
  it('rejects a hostname if any resolved address enters private space', async () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true); expect(isBlockedAddress('100.64.0.1')).toBe(true); expect(isBlockedAddress('fe80::1')).toBe(true);
    await expect(resolvePublicHost('public.example', vi.fn(async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]) as any)).rejects.toThrow(/blocked address/);
  });
  it('discovers, reads, drafts from, and independently rechecks citations', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ objects: [{ package: { name: 'pkg', description: 'desc', links: { npm: 'https://www.npmjs.com/package/pkg' } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('<h1>Pkg</h1><p>Evidence</p>', { status: 200 }))
      .mockResolvedValueOnce(new Response('Evidence', { status: 200 })) as any;
    const s = services();
    const out = await runResearch({ question: 'npm package pkg' }, context, s);
    expect(out.exitCode).toBe(0); expect((out.result as any).citations.verified).toBe(1); expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(s.runs!.finish).toHaveBeenCalledWith(expect.objectContaining({ id: 'run' }), expect.objectContaining({ ok: true, mode: 'research' }), context);
  });
  it('rejects unsafe URLs, unsupported lanes, and fabricated source numbers', async () => {
    expect(validateUrl('http://127.0.0.1/x')).toBeNull(); expect(classifyQuery('invent a poem')).toBe('general');
    expect((await runResearch({ question: 'invent a poem' }, context, services())).exitCode).toBe(1);
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ pages: [{ title: 'X', key: 'X' }] }), { status: 200 })).mockResolvedValueOnce(new Response('x', { status: 200 })) as any;
    const out = await runResearch({ question: 'what is x' }, context, services('Unsupported [9].'));
    expect(out.exitCode).toBe(1); expect((out.result as any).citations.invalidNumbers).toEqual([9]);
  });
  it('uses host ranking when no engine is forced and preserves quiet/json/human presentations', async () => {
    const source = { title: 'pkg', url: 'https://www.npmjs.com/package/pkg', snippet: 'desc', fetched: true };
    const readable = formatResearchResult({ ok: true, question: 'q', intent: 'package', engineId: 'ranked', answer: 'Claim [1].', sources: [source], citations: { total: 1, verified: 1, blocked: 0, rejected: 0, invalidNumbers: [], results: [{ url: source.url, verdict: 'verified', httpStatus: 200, detail: 'ok' }] } } as any);
    expect(readable).toContain('citations 1/1 verified');
    const s = services();
    s.engines.listActive = vi.fn(async () => ['first', 'ranked']);
    s.engines.rank = vi.fn(async () => [{ engineId: 'ranked', reason: 'top-rated', scope: 'global' }]);
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ objects: [{ package: { name: 'pkg', description: 'desc', links: { npm: source.url } } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('Evidence', { status: 200 }))
      .mockResolvedValueOnce(new Response('Evidence', { status: 200 })) as any;
    const quiet = await runResearch({ question: 'npm package pkg', quiet: true }, context, s);
    expect((quiet.result as any).engineId).toBe('ranked');
    expect(quiet.stdout).toBe('Supported claim [1].\n');
  });
});
