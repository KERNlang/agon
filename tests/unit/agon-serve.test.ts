import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the event ledger at a throwaway AGON_HOME before anything touches it
// (event-log resolves paths at call time, so setting it pre-import is enough).
process.env.AGON_HOME = mkdtempSync(join(tmpdir(), 'agon-serve-test-'));

import { createAgonServe } from '../../packages/cli/src/generated/bridge/agon-serve.js';
import type { BrainClient } from '@kernlang/agon-core';

// Minimal fake brain — agon-serve only calls runTurn + cancel + (now) provideAnswer.
function fakeBrain(): BrainClient {
  return {
    async *runTurn(req: { turnId: string; input: string }) {
      yield { kind: 'notice', level: 'info', message: 'working' };
      yield { kind: 'engine', engineId: 'claude', content: `echo:${req.input}` };
      return { turnId: req.turnId, delegated: false, responded: true, engineId: 'claude' };
    },
    async cancel() { return { status: 'accepted' as const }; },
    async provideAnswer(res: { requestId: string; answer: string }) {
      return res.requestId ? { status: 'accepted' as const } : { status: 'rejected' as const, reason: 'no requestId' };
    },
  } as unknown as BrainClient;
}

describe('AgonServe — loopback HTTP bridge', () => {
  let url: string;
  let token: string;
  let serve: ReturnType<typeof createAgonServe>;

  beforeAll(async () => {
    serve = createAgonServe({ brain: fakeBrain(), sessionId: 'sess-test', allowedOrigins: ['https://ext.example'] });
    const started = await serve.start(); // ephemeral port
    url = started.url;
    token = started.token;
  });
  afterAll(async () => { await serve.close(); });

  const authed = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

  it('rejects requests without the bearer token', async () => {
    expect((await fetch(`${url}/attach`, { method: 'POST' })).status).toBe(401);
  });

  it('rejects a disallowed browser Origin even with the token', async () => {
    const r = await fetch(`${url}/attach`, { method: 'POST', headers: authed({ Origin: 'https://evil.example' }) });
    expect(r.status).toBe(401);
  });

  it('allows an allowlisted Origin with the token, returning the session cursor', async () => {
    const r = await fetch(`${url}/attach`, { method: 'POST', headers: authed({ Origin: 'https://ext.example' }) });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sessionId).toBe('sess-test');
    expect(typeof body.lastSeq).toBe('number');
  });

  it('answers a CORS preflight from an allowlisted Origin (204 + Allow-Origin, no auth required)', async () => {
    const r = await fetch(`${url}/send`, { method: 'OPTIONS', headers: { Origin: 'https://ext.example', 'Access-Control-Request-Method': 'POST' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://ext.example');
    expect(r.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('refuses a CORS preflight from a disallowed Origin (403)', async () => {
    const r = await fetch(`${url}/send`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    expect(r.status).toBe(403);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('POST /send drives the brain and returns the BrainTurnResult', async () => {
    const r = await fetch(`${url}/send`, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ input: 'hello', clientId: 'c-browser' }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.turnId).toContain('sess-test');
    expect(body.result.responded).toBe(true);
  });

  it('POST /send with no input is a 400', async () => {
    const r = await fetch(`${url}/send`, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('malformed JSON body is a 400, not a 500', async () => {
    const r = await fetch(`${url}/send`, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: '{not json',
    });
    expect(r.status).toBe(400);
  });

  it('serializes concurrent /send calls (single-writer), each with a distinct turnId', async () => {
    const send = (input: string) =>
      fetch(`${url}/send`, { method: 'POST', headers: authed({ 'Content-Type': 'application/json' }), body: JSON.stringify({ input }) }).then((r) => r.json());
    const [a, b] = await Promise.all([send('one'), send('two')]);
    expect(a.result.responded).toBe(true);
    expect(b.result.responded).toBe(true);
    expect(a.turnId).not.toBe(b.turnId);
  });

  it('POST /cancel returns the brain ack', async () => {
    const r = await fetch(`${url}/cancel`, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ turnId: 'sess-test-1' }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('accepted');
  });

  it('POST /answer forwards the user reply to BrainClient.provideAnswer (returns the ack)', async () => {
    const r = await fetch(`${url}/answer`, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ requestId: 'q1', answer: 'yes, do it' }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe('accepted');
  });

  it('POST /answer with no requestId is a 400', async () => {
    const r = await fetch(`${url}/answer`, {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ answer: 'orphan' }),
    });
    expect(r.status).toBe(400);
  });

  it('GET /events streams the ledger as SSE — a sent turn is visible to a later subscriber (fan-out)', async () => {
    // self-contained: drive a fresh turn, then a NEW subscriber must see it via replay
    await fetch(`${url}/send`, { method: 'POST', headers: authed({ 'Content-Type': 'application/json' }), body: JSON.stringify({ input: 'sse-probe' }) });

    const ctrl = new AbortController();
    const r = await fetch(`${url}/events?from=0`, { headers: authed(), signal: ctrl.signal });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/event-stream');

    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (let i = 0; i < 8; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      if (buf.includes('echo:sse-probe')) break;
    }
    ctrl.abort();
    expect(buf).toContain('data:');
    expect(buf).toContain('"kind":"engine"');
    expect(buf).toContain('echo:sse-probe');
  });
});

// Multi-extension-ID allowlist: `agon serve --origin a,b` (or the browser-host/ext
// pairing paths, once they union the dev id with a configured second/store id) passes
// AgonServe TWO allowed origins. allowedOrigins is already a plain array checked via
// .includes — this locks in that BOTH members are accepted, not just the first.
describe('AgonServe — multi-origin allowlist (dev id + a second/store id)', () => {
  let url: string;
  let token: string;
  let serve: ReturnType<typeof createAgonServe>;
  const DEV_ORIGIN = 'chrome-extension://gekhacageioplmjhdgapelpepdmphfeo';
  const STORE_ORIGIN = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';

  beforeAll(async () => {
    serve = createAgonServe({ brain: fakeBrain(), sessionId: 'sess-multi-origin', allowedOrigins: [DEV_ORIGIN, STORE_ORIGIN] });
    const started = await serve.start();
    url = started.url;
    token = started.token;
  });
  afterAll(async () => { await serve.close(); });

  const authed = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

  it('accepts the first configured origin (dev id)', async () => {
    const r = await fetch(`${url}/attach`, { method: 'POST', headers: authed({ Origin: DEV_ORIGIN }) });
    expect(r.status).toBe(200);
  });

  it('ALSO accepts the second configured origin (e.g. a published Chrome-Web-Store id)', async () => {
    const r = await fetch(`${url}/attach`, { method: 'POST', headers: authed({ Origin: STORE_ORIGIN }) });
    expect(r.status).toBe(200);
  });

  it('still rejects an origin that is in neither allowed entry', async () => {
    const r = await fetch(`${url}/attach`, { method: 'POST', headers: authed({ Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }) });
    expect(r.status).toBe(401);
  });

  it('CORS preflight succeeds for either allowed origin', async () => {
    const r1 = await fetch(`${url}/send`, { method: 'OPTIONS', headers: { Origin: DEV_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    expect(r1.status).toBe(204);
    expect(r1.headers.get('access-control-allow-origin')).toBe(DEV_ORIGIN);
    const r2 = await fetch(`${url}/send`, { method: 'OPTIONS', headers: { Origin: STORE_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    expect(r2.status).toBe(204);
    expect(r2.headers.get('access-control-allow-origin')).toBe(STORE_ORIGIN);
  });
});
