import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fetch as fetchPinned } from 'undici';
vi.mock('undici', async (importOriginal) => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: vi.fn((input, init) => globalThis.fetch(input, init)),
}));
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
  it.each([
    '198.18.0.0', '198.19.255.255', '192.0.0.1', '192.0.0.170',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    'ff02::1', 'fec0::1', 'feff:ffff::1', '::7f00:1',
    '64:ff9b:1::808:808', '64:ff9b::7f00:1', '64:ff9b::a00:1',
    '2002:7f00:1::', '2002:c0a8:101::', '::ffff:198.18.0.1',
    '0064:ff9b:0000:0000:0000:0000:7f00:0001',
    '2002:7f00:0001:1234:5678:abcd:0000:0001', 'fe80::1%eth0',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '2001:db8::1', '3fff::1',
    '::ffff:192.0.2.1', '64:ff9b::c633:6401', '2002:cb00:7101::1',
  ])('rejects non-public research destinations %s', async (address) => {
    expect(isBlockedAddress(address)).toBe(true);
    await expect(resolvePublicHost('source.example', vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address, family: address.includes(':') ? 6 : 4 },
    ]) as any)).rejects.toThrow(/blocked address/);
  });
  it.each([
    '192.0.0.9', '192.0.0.10', '198.17.255.255', '198.20.0.0',
    '64:ff9b::808:808', '64:ff9b::8.8.8.8', '2002:808:808::1',
    '::ffff:192.0.0.9', '2606:4700:4700::1111',
  ])('preserves public research destinations %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
  it('refuses a translated private destination before fetching source content', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '64:ff9b::7f00:1', family: 6 }] as any);
    const discovered = { objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] };
    globalThis.fetch = vi.fn(async (input) => new Response(
      String(input).startsWith('https://registry.npmjs.org/') ? JSON.stringify(discovered) : 'Evidence',
      { status: 200 },
    ));
    const out = await runResearch({ question: 'npm package pkg' }, context, services());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).citations.verified).toBe(0);
  });
  it('rechecks a public source redirect before contacting a reserved destination', async () => {
    vi.mocked(lookup).mockImplementation(async (hostname) => [{
      address: hostname === 'source.example' ? '93.184.216.34' : '198.18.0.1', family: 4,
    }] as any);
    const discovered = { objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] };
    globalThis.fetch = vi.fn(async (input) => String(input).startsWith('https://registry.npmjs.org/')
      ? new Response(JSON.stringify(discovered), { status: 200 })
      : new Response(null, { status: 302, headers: { location: 'https://reserved.example/private' } }));
    const out = await runResearch({ question: 'npm package pkg' }, context, services());
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => String(input).includes('reserved.example'))).toBe(false);
    expect(vi.mocked(lookup).mock.calls.some(([hostname]) => hostname === 'reserved.example')).toBe(true);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).citations.verified).toBe(0);
  });
  it('starts with an isolated public DNS fixture', async () => {
    expect(vi.mocked(lookup).mock.calls).toHaveLength(0);
    await expect(resolvePublicHost('reserved.example')).resolves.toEqual({ address: '93.184.216.34', family: 4 });
  });
  it.each(['8.8.8.8', '[2606:4700:4700::1111]'])('validates literal %s without DNS', async (hostname) => {
    const resolver = vi.fn(async () => { throw new Error('literal reached DNS'); });
    await expect(resolvePublicHost(hostname, resolver as any)).resolves.toEqual({
      address: hostname.replace(/^\[|\]$/g, ''), family: hostname.includes(':') ? 6 : 4,
    });
    expect(resolver).not.toHaveBeenCalled();
  });
  it.each(['127.0.0.1', '[64:ff9b::7f00:1]', '[2001:db8::1]'])('blocks literal %s without DNS', async (hostname) => {
    const resolver = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
    await expect(resolvePublicHost(hostname, resolver as any)).rejects.toThrow(/blocked address/);
    expect(resolver).not.toHaveBeenCalled();
  });
  it.each([
    '0.255.255.255', '10.255.255.255', '127.255.255.255',
    '169.254.255.255', '172.16.0.0', '172.31.255.255', '192.168.255.255',
    '100.64.0.0', '100.127.255.255', '::', '::1', 'fc00::', 'fdff:ffff::1',
    'fe80::', 'febf:ffff::1', '::ffff:100.64.0.1', '[::FFFF:7F00:1]',
  ])('blocks reserved range address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });
  it.each([
    '1.0.0.0', '9.255.255.255', '11.0.0.0', '126.255.255.255', '128.0.0.0',
    '169.253.255.255', '169.255.0.0', '172.15.255.255', '172.32.0.0',
    '192.167.255.255', '192.169.0.0', '100.63.255.255', '100.128.0.0',
    '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808',
  ])('allows address outside blocked ranges %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
  it.each(['', 'not-an-address', '127.0.0.999', '::ffff:xyz'])('fails closed on invalid address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });
  it.each(['::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:a00:1', '0:0:0:0:0:0:0:1'])('rejects private address spelling %s', async (address) => {
    expect(isBlockedAddress(address)).toBe(true);
    await expect(resolvePublicHost('public.example', vi.fn(async () => [
      { address: '93.184.216.34', family: 4 }, { address, family: 6 },
    ]) as any)).rejects.toThrow(/blocked address/);
  });
  it('never fetches a source resolved to mapped loopback', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: '::ffff:7f00:1', family: 6 }] as any)
      .mockResolvedValueOnce([{ address: '::ffff:7f00:1', family: 6 }] as any);
    const discovered = { objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] };
    globalThis.fetch = vi.fn(async (input) => new Response(
      String(input).startsWith('https://registry.npmjs.org/') ? JSON.stringify(discovered) : 'Evidence',
      { status: 200 },
    ));
    const out = await runResearch({ question: 'npm package pkg' }, context, services());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(out.exitCode).toBe(1);
    expect((out.result as any).citations.verified).toBe(0);
  });
  it.each(['null', '{"items":{}}', '{"items":[null]}'])('treats malformed discovery payload %s as no sources', async (payload) => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    const s = services();
    const out = await runResearch({ question: 'github repo parser' }, context, s);
    expect(out).toEqual({ exitCode: 1, stderr: 'No authoritative sources found.\n' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(s.engines.dispatch).not.toHaveBeenCalled();
    expect(s.runs!.finish).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run' }),
      expect.objectContaining({ ok: false, summary: 'no authoritative sources found' }),
      context,
    );
  });
  it.each([
    ['RFC 9110', 'https://datatracker.ietf.org/api/v1/doc/document/?format=json&limit=5&name__icontains=rfc9110'],
    ['RFC 07231', 'https://datatracker.ietf.org/api/v1/doc/document/?format=json&limit=5&name__icontains=rfc7231'],
    ['npm a charting library', 'https://registry.npmjs.org/-/v1/search?text=charting&size=5'],
  ])('preserves the authoritative discovery request for %s', async (question, url) => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ objects: [] }), { status: 200 }));
    const s = services();
    const out = await runResearch({ question }, context, s);
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toBe('No authoritative sources found.\n');
    expect(s.engines.dispatch).not.toHaveBeenCalled();
  });
  it.each([[0, 5], [99, 10]])('preserves legacy discovery count %s as %s', async (count, expected) => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ objects: [] }), { status: 200 }));
    await runResearch({ question: 'npm package yaml', count }, context, services());
    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(
      `https://registry.npmjs.org/-/v1/search?text=yaml&size=${expected}`,
      expect.objectContaining({ headers: { Accept: 'application/json', 'User-Agent': 'agon-research/0.1 (+https://github.com/KERNlang/agon)' } }),
    );
  });
  it('does not fetch npm or dispatch an engine for a Python pip module query', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ objects: [] }), { status: 200 })) as any;
    const s = services();
    const out = await runResearch({ question: 'pip module for parsing yaml' }, context, s);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain('No keyless authoritative lane for general research');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(s.engines.dispatch).not.toHaveBeenCalled();
  });
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
  it('connects using the checked DNS answer for source and citation reads', async () => {
    const transport = await vi.importActual<typeof import('undici')>('undici');
    let requests = 0;
    const server = createServer((_request, response) => { requests++; response.end('Evidence'); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as net.AddressInfo).port;
    const connect = net.connect;
    const pinned: string[] = [];
    const transportErrors: string[] = [];
    vi.mocked(fetchPinned).mockImplementation((...args) => transport.fetch(...args).catch(error => {
      transportErrors.push(String(error.cause ?? error));
      throw error;
    }));
    // Inspect the real connector, then route its verified address to the local fixture.
    vi.spyOn(net, 'connect').mockImplementation(((options: net.NetConnectOpts) => {
      const target = options as net.TcpNetConnectOpts;
      expect(target.host).toBe('source.example');
      expect(Number(target.port)).toBe(port);
      expect(target.lookup).toBeTypeOf('function');
      const checkedLookup = target.lookup!;
      return connect({ ...target, lookup: (hostname, lookupOptions, callback) => {
        checkedLookup(hostname, lookupOptions, (error, address, family) => {
          const records = lookupOptions.all ? address as unknown as Array<{ address: string; family: number }> : [{ address, family }];
          expect(error).toBeNull();
          expect(records).toEqual([{ address: '93.184.216.34', family: 4 }]);
          pinned.push(records[0]!.address);
          if (lookupOptions.all) (callback as any)(null, [{ address: '127.0.0.1', family: 4 }]);
          else callback(null, '127.0.0.1', 4);
        });
      } });
    }) as typeof net.connect);
    globalThis.fetch = vi.fn(async (input, init) => String(input).startsWith('https://registry.npmjs.org/')
      ? new Response(JSON.stringify({ objects: [{ package: { name: 'pkg', links: { npm: `http://source.example:${port}/pkg` } } }] }))
      : original(input, init).catch(error => {
        transportErrors.push(String(error.cause ?? error));
        throw error;
      }));
    try {
      const out = await runResearch({ question: 'npm package pkg' }, context, services());
      expect(out.exitCode, JSON.stringify({ out, pinned, requests, transportErrors })).toBe(0);
      expect(pinned).toEqual(['93.184.216.34', '93.184.216.34']);
      expect(requests).toBe(2);
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
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
