// RED test for Cesar gap #2 (web access): WebFetch tool.
// Pins the two pure, security-critical helpers before the tool is wired:
//   - parseAndValidateUrl: scheme + SSRF guard (block private/loopback/link-local/metadata)
//   - htmlToText: strip <script>/<style> + tags, keep readable text, cap length
import { describe, it, expect } from 'vitest';
import {
  parseAndValidateUrl,
  htmlToText,
  createWebFetchTool,
} from '../../packages/core/src/generated/tools/tool-web-fetch.js';

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
