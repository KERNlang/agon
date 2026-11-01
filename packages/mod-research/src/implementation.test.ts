import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { createServer } from 'node:http';
import { getEventListeners, once } from 'node:events';
import { fetch as fetchPinned } from 'undici';
vi.mock('undici', async (importOriginal) => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: vi.fn((input, init) => globalThis.fetch(input, init)),
}));
import { mkdtempSync, mkdirSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliRunRecordHost } from '../../cli/src/run-record-host.js';
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
  it('preserves a synchronous DNS failure and removes its listener', async () => {
    const controller = new AbortController();
    const failure = new Error('resolver failed synchronously');
    const resolver = vi.fn(() => { throw failure; });
    await expect(resolvePublicHost('source.example', resolver as any, controller.signal)).rejects.toBe(failure);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
  it('does not start DNS when cancelled before the resolver microtask', async () => {
    const controller = new AbortController();
    const resolver = vi.fn();
    const pending = resolvePublicHost('source.example', resolver as any, controller.signal);
    const failure = new Error('cancel before DNS');
    controller.abort(failure);
    await expect(pending).rejects.toBe(failure);
    expect(resolver).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
  it('rejects DNS resolution followed by abort before continuation', async () => {
    const controller = new AbortController();
    let resolveDns!: (records: Array<{ address: string; family: number }>) => void;
    const resolver = vi.fn(() => new Promise<Array<{ address: string; family: number }>>(resolve => { resolveDns = resolve; }));
    const pending = resolvePublicHost('source.example', resolver as any, controller.signal);
    await Promise.resolve();
    resolveDns([{ address: '93.184.216.34', family: 4 }]);
    const failure = new Error('cancel after DNS');
    controller.abort(failure);
    await expect(pending).rejects.toBe(failure);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
  it.each(['resolve', 'reject', 'abort'] as const)('removes the DNS abort listener after %s', async outcome => {
    const controller = new AbortController();
    let resolveDns!: (records: Array<{ address: string; family: number }>) => void;
    let rejectDns!: (error: Error) => void;
    const resolver = vi.fn(() => new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      resolveDns = resolve; rejectDns = reject;
    }));
    const pending = resolvePublicHost('source.example', resolver as any, controller.signal);
    const observed = pending.then(value => value, error => error);
    await Promise.resolve();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
    const failure = new Error('fixture stop');
    if (outcome === 'resolve') resolveDns([{ address: '93.184.216.34', family: 4 }]);
    else if (outcome === 'reject') rejectDns(failure);
    else controller.abort(failure);
    expect(await observed).toEqual(outcome === 'resolve' ? { address: '93.184.216.34', family: 4 } : failure);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    if (outcome === 'abort') rejectDns(new Error('late DNS failure'));
    await new Promise(resolve => setImmediate(resolve));
  });
  it.each(['selection', 'ranking', 'draft', 'citation'] as const)('stops after cancellation during %s', async stage => {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('fixture cancellation'));
    const s = services();
    s.engines.listActive = vi.fn(async () => { if (stage === 'selection') abort(); return ['writer']; });
    s.engines.rank = vi.fn(async () => { if (stage === 'ranking') abort(); return [{ engineId: 'writer', reason: 'fixture', scope: 'global' }]; });
    s.engines.dispatch = vi.fn(async () => { if (stage === 'draft') abort(); return { exitCode: 0, stdout: 'Evidence [1].' }; });
    let fetches = 0;
    globalThis.fetch = vi.fn(async () => {
      fetches++;
      if (stage === 'citation' && fetches === 3) abort();
      return new Response(fetches === 1
        ? JSON.stringify({ objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] })
        : 'Evidence');
    });
    const out = await runResearch({ question: 'npm package pkg' }, { ...context, signal: controller.signal }, s);
    expect(out.exitCode).toBe(1);
    expect(s.engines.dispatch).toHaveBeenCalledTimes(stage === 'selection' || stage === 'ranking' ? 0 : 1);
    if (stage === 'selection') expect(s.engines.rank).not.toHaveBeenCalled();
    expect(s.receipts.record).not.toHaveBeenCalled();
    expect(s.runs!.finish).toHaveBeenCalledTimes(1);
  });
  it('bounds DNS with the request deadline without disabling ordinary source fallback', async () => {
    const deadline = new AbortController();
    const timeout = AbortSignal.timeout;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 15000 ? deadline.signal : timeout(ms));
    let enterDns!: () => void;
    let releaseDns!: (records: Array<{ address: string; family: number }>) => void;
    const entered = new Promise<void>(resolve => { enterDns = resolve; });
    vi.mocked(lookup).mockImplementationOnce(() => { enterDns(); return new Promise(resolve => { releaseDns = resolve; }); });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] })));
    const s = services('');
    let settled = false;
    const running = runResearch({ question: 'npm package pkg' }, context, s).finally(() => { settled = true; });
    await entered;
    deadline.abort(new DOMException('request expired', 'TimeoutError'));
    await new Promise(resolve => setImmediate(resolve));
    const settledBeforeDns = settled;
    releaseDns([{ address: '93.184.216.34', family: 4 }]);
    expect((await running).exitCode).toBe(1);
    expect(settledBeforeDns).toBe(true);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(s.engines.dispatch).toHaveBeenCalledTimes(1);
  });
  it('does not start discovery for an already cancelled invocation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('fixture cancellation'));
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ objects: [] })));
    const s = services();
    const out = await runResearch({ question: 'npm package pkg' }, { ...context, signal: controller.signal }, s);
    expect(out.exitCode).toBe(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(s.engines.dispatch).not.toHaveBeenCalled();
  });
  it('settles cancellation during DNS without waiting for the answer or dispatching a draft', async () => {
    const controller = new AbortController();
    let enterDns!: () => void;
    let releaseDns!: (records: Array<{ address: string; family: number }>) => void;
    const entered = new Promise<void>(resolve => { enterDns = resolve; });
    vi.mocked(lookup).mockImplementationOnce(() => {
      enterDns();
      return new Promise(resolve => { releaseDns = resolve; });
    });
    globalThis.fetch = vi.fn(async input => new Response(String(input).startsWith('https://registry.npmjs.org/')
      ? JSON.stringify({ objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] })
      : 'Evidence'));
    const s = services();
    let settled = false;
    const running = runResearch({ question: 'npm package pkg' }, { ...context, signal: controller.signal }, s)
      .finally(() => { settled = true; });
    await entered;
    controller.abort(new Error('fixture cancellation'));
    await new Promise(resolve => setImmediate(resolve));
    const settledBeforeDns = settled;
    releaseDns([{ address: '93.184.216.34', family: 4 }]);
    const out = await running;
    await new Promise(resolve => setImmediate(resolve));
    expect(settledBeforeDns).toBe(true);
    expect(out.exitCode).toBe(1);
    expect(s.engines.dispatch).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
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
  it('still submits an ordinary discovery failure once', async () => {
    const failure = new Error('discovery unavailable');
    globalThis.fetch = vi.fn(async () => { throw failure; });
    const s = services();
    const out = await runResearch({ question: 'npm package pkg' }, context, s);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain(failure.message);
    expect(s.runs!.finish).toHaveBeenCalledTimes(1);
    expect(s.runs!.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), context);
    expect(s.engines.dispatch).not.toHaveBeenCalled();
  });
  it.each([
    { success: true, stage: 'before' }, { success: false, stage: 'before' },
    { success: true, stage: 'after' }, { success: false, stage: 'after' },
  ])('retains the original outcome when status persistence fails ($success/$stage)', async ({ success, stage }) => {
    const home = mkdtempSync(join(tmpdir(), 'research-status-'));
    const previousHome = process.env.AGON_HOME;
    const before = new Set(process.listeners('exit'));
    process.env.AGON_HOME = home;
    let handle: Awaited<ReturnType<typeof cliRunRecordHost.start>> | undefined;
    const submitted: unknown[] = [];
    const persistenceError = new Error('status persistence failed after publication');
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      globalThis.fetch = vi.fn(async input => new Response(String(input).startsWith('https://registry.npmjs.org/')
        ? JSON.stringify({ objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] }) : 'Evidence'));
      const s = services(success ? 'Evidence [1].' : '');
      s.runs = {
        ...cliRunRecordHost,
        start: async (...args) => {
          handle = await cliRunRecordHost.start(...args);
          if (stage === 'before') mkdirSync(join(handle.path, '.status.json.tmp'));
          return handle;
        },
        finish: async (...args) => {
          submitted.push(structuredClone(args[1]));
          await cliRunRecordHost.finish(...args);
          if (stage === 'after') throw persistenceError;
        },
      };
      const pending = runResearch({ question: 'npm package pkg' }, context, s);
      if (stage === 'after') await expect(pending).rejects.toBe(persistenceError);
      else await expect(pending).rejects.toThrow(/status.*persist/i);
      const publishedBytes = stage === 'after' ? readFileSync(join(handle!.path, 'status.json'), 'utf8') : undefined;
      if (stage === 'before') rmdirSync(join(handle!.path, '.status.json.tmp'));
      const added = process.listeners('exit').filter(listener => !before.has(listener));
      expect(added).toHaveLength(stage === 'before' ? 1 : 0);
      for (const listener of added) listener(0);
      const saved = JSON.parse(readFileSync(join(handle!.path, 'status.json'), 'utf8'));
      if (publishedBytes !== undefined) expect(readFileSync(join(handle!.path, 'status.json'), 'utf8')).toBe(publishedBytes);
      expect(submitted).toHaveLength(1);
      expect(saved).toEqual(submitted[0]);
      expect(saved.ok).toBe(success);
      expect(warning).toHaveBeenCalledTimes(stage === 'before' ? 1 : 0);
    } finally {
      for (const listener of process.listeners('exit').filter(listener => !before.has(listener))) listener(0);
      if (previousHome === undefined) delete process.env.AGON_HOME;
      else process.env.AGON_HOME = previousHome;
      warning.mockRestore();
      rmSync(home, { recursive: true, force: true });
    }
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
    expect(s.engines.dispatch).toHaveBeenCalledExactlyOnceWith('writer', expect.stringContaining('Evidence'), context,
      expect.objectContaining({ mode: 'exec', textOnly: true, timeoutSeconds: 120 }));
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
