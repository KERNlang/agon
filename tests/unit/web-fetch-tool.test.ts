// RED test for Cesar gap #2 (web access): WebFetch tool.
// Pins the two pure, security-critical helpers before the tool is wired:
//   - parseAndValidateUrl: scheme + SSRF guard (block private/loopback/link-local/metadata)
//   - htmlToText: strip <script>/<style> + tags, keep readable text, cap length
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseAndValidateUrl,
  htmlToText,
  createWebFetchTool,
} from '../../packages/core/src/generated/tools/tool-web-fetch.js';

const ctx = () => ({ cwd: process.cwd(), readFileState: new Map() }) as never;

const streamFrom = (s: string): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(s);
  return new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(bytes); c.close(); },
  });
};

// Emits `total` bytes in fixed-size chunks — to exercise the streaming byte cap
// when no content-length header is present.
const bigStream = (total: number, chunk = 256 * 1024): ReadableStream<Uint8Array> => {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) { c.close(); return; }
      const n = Math.min(chunk, total - sent);
      c.enqueue(new Uint8Array(n));
      sent += n;
    },
  });
};

describe('parseAndValidateUrl — scheme + SSRF guard', () => {
  it('accepts public http(s) URLs', () => {
    expect(parseAndValidateUrl('https://example.com/docs').ok).toBe(true);
    expect(parseAndValidateUrl('http://example.com').ok).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(parseAndValidateUrl('file:///etc/passwd').ok).toBe(false);
    expect(parseAndValidateUrl('ftp://example.com').ok).toBe(false);
    expect(parseAndValidateUrl('data:text/html,<x>').ok).toBe(false);
  });

  it('rejects garbage / non-URLs', () => {
    expect(parseAndValidateUrl('not a url').ok).toBe(false);
    expect(parseAndValidateUrl('').ok).toBe(false);
  });

  it('blocks loopback and localhost', () => {
    expect(parseAndValidateUrl('http://localhost:8080').ok).toBe(false);
    expect(parseAndValidateUrl('http://127.0.0.1').ok).toBe(false);
    expect(parseAndValidateUrl('http://[::1]/').ok).toBe(false);
  });

  it('blocks private ranges', () => {
    expect(parseAndValidateUrl('http://10.0.0.5').ok).toBe(false);
    expect(parseAndValidateUrl('http://192.168.1.1').ok).toBe(false);
    expect(parseAndValidateUrl('http://172.16.0.1').ok).toBe(false);
  });

  it('blocks link-local and the cloud metadata endpoint', () => {
    const r = parseAndValidateUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.ok).toBe(false);
    expect(String(r.reason ?? '')).toMatch(/private|link-local|blocked|metadata/i);
  });

  // WHATWG URL serialises IPv4-mapped IPv6 to hex (::ffff:127.0.0.1 -> ::ffff:7f00:1),
  // so the guard must decode the embedded v4 — not just inspect the first hextet.
  it('blocks IPv4-mapped IPv6 literals (mapped to private/loopback/metadata)', () => {
    expect(parseAndValidateUrl('http://[::ffff:127.0.0.1]/').ok).toBe(false);
    expect(parseAndValidateUrl('http://[::ffff:169.254.169.254]/').ok).toBe(false);
    expect(parseAndValidateUrl('http://[::ffff:10.0.0.1]/').ok).toBe(false);
    expect(parseAndValidateUrl('http://[0:0:0:0:0:ffff:192.168.1.1]/').ok).toBe(false);
  });

  it('allows IPv4-mapped IPv6 of a public address', () => {
    expect(parseAndValidateUrl('http://[::ffff:8.8.8.8]/').ok).toBe(true);
  });

  it('blocks the GCP metadata DNS name and trailing-dot loopback', () => {
    expect(parseAndValidateUrl('http://metadata.google.internal/computeMetadata/').ok).toBe(false);
    expect(parseAndValidateUrl('http://127.0.0.1./').ok).toBe(false);
  });

  // Decimal / hex / octal / shorthand IPv4 are normalised by URL to dotted-quad,
  // so the existing octet guard already catches them — pin that it stays true.
  it('blocks obfuscated IPv4 encodings (URL-normalised to dotted-quad)', () => {
    expect(parseAndValidateUrl('http://2130706433/').ok).toBe(false); // 127.0.0.1
    expect(parseAndValidateUrl('http://0x7f000001/').ok).toBe(false); // 127.0.0.1
    expect(parseAndValidateUrl('http://127.1/').ok).toBe(false);      // 127.0.0.1
    expect(parseAndValidateUrl('http://0/').ok).toBe(false);          // 0.0.0.0
  });
});

describe('WebFetch execute — SSRF via redirects', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not follow a 3xx redirect to an internal host', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url));
      return {
        status: 302,
        ok: false,
        statusText: 'Found',
        type: 'basic',
        headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
        body: null,
      } as unknown as Response;
    }));
    const res = await createWebFetchTool().execute({ url: 'https://example.com/redir' }, ctx());
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/redirect|blocked|169\.254/i);
    // The internal target must never have been requested.
    expect(seen.some((u) => u.includes('169.254.169.254'))).toBe(false);
  });

  it('caps the number of redirect hops', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 302,
      ok: false,
      statusText: 'Found',
      type: 'basic',
      headers: new Headers({ location: 'https://example.com/next' }),
      body: null,
    } as unknown as Response)));
    const res = await createWebFetchTool().execute({ url: 'https://example.com/loop' }, ctx());
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/redirect/i);
  });
});

describe('WebFetch execute — response size cap', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an oversized response declared via content-length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      statusText: 'OK',
      type: 'basic',
      headers: new Headers({ 'content-type': 'text/plain', 'content-length': String(50 * 1024 * 1024) }),
      body: streamFrom('ignored'),
    } as unknown as Response)));
    const res = await createWebFetchTool().execute({ url: 'https://example.com/huge' }, ctx());
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/large|size|exceed/i);
  });

  it('caps an oversized streamed body with no content-length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      statusText: 'OK',
      type: 'basic',
      headers: new Headers({ 'content-type': 'text/plain' }),
      body: bigStream(8 * 1024 * 1024),
    } as unknown as Response)));
    const res = await createWebFetchTool().execute({ url: 'https://example.com/stream' }, ctx());
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/large|size|exceed/i);
  });

  it('reports a caller abort distinctly from a timeout, honoring an already-aborted signal', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { signal?: AbortSignal }) => {
      if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return { status: 200, ok: true, statusText: 'OK', type: 'basic', headers: new Headers(), body: streamFrom('x') } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const ac = new AbortController();
    ac.abort();
    const c = { cwd: process.cwd(), readFileState: new Map(), abortSignal: ac.signal } as never;
    const res = await createWebFetchTool().execute({ url: 'https://example.com/x' }, c);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/abort/i);
    expect(String(res.error)).not.toMatch(/timed out/i);
  });

  it('returns text for a normal small streamed body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      statusText: 'OK',
      type: 'basic',
      headers: new Headers({ 'content-type': 'text/plain' }),
      body: streamFrom('hello from the web'),
    } as unknown as Response)));
    const res = await createWebFetchTool().execute({ url: 'https://example.com/ok' }, ctx());
    expect(res.ok).toBe(true);
    expect(res.content).toContain('hello from the web');
  });
});

describe('htmlToText', () => {
  it('strips script/style content and tags but keeps text', () => {
    const html = '<html><head><style>.x{color:red}</style></head><body><script>steal()</script><p>Hello <b>world</b></p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Hello world');
    expect(text).not.toContain('steal()');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('<');
  });

  it('caps output length', () => {
    const html = '<p>' + 'a'.repeat(5000) + '</p>';
    expect(htmlToText(html, 100).length).toBeLessThanOrEqual(120); // cap + small marker slack
  });
});

describe('createWebFetchTool', () => {
  it('exposes a read-only, concurrency-safe WebFetch definition', () => {
    const tool = createWebFetchTool();
    expect(tool.definition.name).toBe('WebFetch');
    expect(tool.definition.isReadOnly).toBe(true);
    expect(tool.definition.isConcurrencySafe).toBe(true);
  });

  it('validate rejects a blocked URL before any network call', () => {
    const tool = createWebFetchTool();
    const ctx = { cwd: process.cwd(), readFileState: new Map() } as never;
    expect(tool.validate({ url: 'http://169.254.169.254/' }, ctx)).toBeTruthy();
    expect(tool.validate({ url: 'https://example.com' }, ctx)).toBeNull();
  });
});
