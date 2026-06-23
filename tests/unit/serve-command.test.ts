import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

// Point AGON_HOME at a throwaway home BEFORE anything resolves a path (the event
// ledger + agonPath resolve at call time, so setting it pre-import is enough).
process.env.AGON_HOME = mkdtempSync(join(tmpdir(), 'agon-serve-cmd-test-'));

import {
  parseOrigins,
  newServeSessionId,
  resolveServeEngine,
  validateServeEngine,
  seedServeSession,
  recordServeReady,
  serveConnectionPath,
  writeServeConnectionFile,
  removeServeConnectionFile,
  emitServeConnectionLine,
  buildServeRuntime,
  runServe,
} from '../../packages/cli/src/generated/commands/serve.js';
import { resolveBuiltinEnginesDir } from '../../packages/cli/src/generated/lib/engines-dir.js';
import { createAgonServe } from '../../packages/cli/src/generated/bridge/agon-serve.js';
import { EngineRegistry, getSessionHost } from '@kernlang/agon-core';
import type { BrainClient } from '@kernlang/agon-core';

describe('agon serve — pure helpers', () => {
  it('parseOrigins: comma-separated string → trimmed, deduped list', () => {
    expect(parseOrigins('https://a.x, https://b.x ,https://a.x')).toEqual(['https://a.x', 'https://b.x']);
  });

  it('parseOrigins: repeated-flag array is flattened + comma-split', () => {
    expect(parseOrigins(['https://a.x', 'https://b.x,https://c.x'])).toEqual(['https://a.x', 'https://b.x', 'https://c.x']);
  });

  it('parseOrigins: empty / undefined → [] (deny-by-default for browsers)', () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('')).toEqual([]);
    expect(parseOrigins('  ,  ')).toEqual([]);
  });

  it('newServeSessionId: serve-<ts> shape', () => {
    expect(newServeSessionId(1700000000000)).toBe('serve-1700000000000');
  });

  it('resolveServeEngine: an explicit engine wins and is trimmed', () => {
    expect(resolveServeEngine('  codex  ', process.cwd())).toBe('codex');
  });

  it('resolveServeEngine: no explicit → a non-empty configured/default engine', () => {
    expect(resolveServeEngine(undefined, process.cwd())).toBeTruthy();
  });
});

describe('agon serve — engine validation (fail-fast vs registry)', () => {
  let registry: EngineRegistry;
  beforeAll(() => {
    registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());
  });

  it('accepts a builtin engine (claude)', () => {
    expect(() => validateServeEngine(registry, 'claude')).not.toThrow();
  });

  it('rejects an unknown engine with the available list', () => {
    expect(() => validateServeEngine(registry, 'definitely-not-an-engine')).toThrow(/Unknown engine/);
  });
});

describe('agon serve — session seeding + ready frame', () => {
  it('seedServeSession registers a kind="serve" session visible to the host', () => {
    const sessionId = newServeSessionId(1700000000001);
    seedServeSession(sessionId, 'claude');
    const found = getSessionHost().listSessions().find((s) => s.id === sessionId);
    expect(found).toBeTruthy();
    expect(found!.kind).toBe('serve');
    const events = getSessionHost().replay(sessionId, 0);
    expect(events.some((e) => JSON.stringify(e.event).includes('agon serve session started'))).toBe(true);
  });

  it('recordServeReady appends a provenance frame carrying engine + url', () => {
    const sessionId = newServeSessionId(1700000000002);
    seedServeSession(sessionId, 'claude');
    recordServeReady(sessionId, 'codex', 'http://127.0.0.1:54321', ['https://ext.example']);
    const events = getSessionHost().replay(sessionId, 0);
    const ready = events.find((e) => JSON.stringify(e.event).includes('agon serve ready'));
    expect(ready).toBeTruthy();
    const ev = ready!.event as { engineId?: string; url?: string };
    expect(ev.engineId).toBe('codex');
    expect(ev.url).toBe('http://127.0.0.1:54321');
  });
});

describe('agon serve — machine-readable connection line (--emit-connection)', () => {
  it('emits exactly one __AGON_CONNECTION__ JSON line carrying url+token+session to stdout', () => {
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error narrow stub of stdout.write for capture
    process.stdout.write = (chunk: string | Uint8Array): boolean => { writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')); return true; };
    try {
      emitServeConnectionLine('http://127.0.0.1:8787', 'tok-xyz', 'serve-42', 'claude', ['chrome-extension://abc'], '/p/serve-42.json');
    } finally {
      process.stdout.write = orig;
    }
    const out = writes.join('');
    expect(out.startsWith('__AGON_CONNECTION__ ')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.match(/__AGON_CONNECTION__/g)?.length).toBe(1); // exactly one line
    const json = JSON.parse(out.slice('__AGON_CONNECTION__ '.length));
    expect(json).toMatchObject({ url: 'http://127.0.0.1:8787', token: 'tok-xyz', sessionId: 'serve-42', engineId: 'claude' });
  });
});

describe('agon serve — 0600 connection file', () => {
  it('writes a 0600 JSON file with the token + url and removes it', () => {
    const sessionId = newServeSessionId(1700000000003);
    const path = writeServeConnectionFile(sessionId, 'http://127.0.0.1:8787', 'tok-abc', 'claude', ['https://ext.example']);
    expect(path).toBe(serveConnectionPath(sessionId));
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const body = JSON.parse(readFileSync(path, 'utf-8'));
    expect(body.token).toBe('tok-abc');
    expect(body.url).toBe('http://127.0.0.1:8787');
    expect(body.sessionId).toBe(sessionId);
    expect(body.allowedOrigins).toEqual(['https://ext.example']);
    removeServeConnectionFile(sessionId);
    expect(existsSync(path)).toBe(false);
  });
});

describe('agon serve — runtime wiring (integration)', () => {
  it('buildServeRuntime assembles a real brain+bridge over a seeded session; /attach honors the token', async () => {
    const runtime = await buildServeRuntime({ engineId: 'claude', cwd: process.cwd(), allowedOrigins: ['https://ext.example'] });
    expect(runtime.sessionId).toMatch(/^serve-\d+$/);
    expect(runtime.engineId).toBe('claude');

    const { url, token } = await runtime.serve.start(0);
    try {
      // No token → 401.
      expect((await fetch(`${url}/attach`, { method: 'POST' })).status).toBe(401);

      // Authorized /attach returns the owned session + a cursor past the seed event.
      const r = await fetch(`${url}/attach`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://ext.example' } });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.sessionId).toBe(runtime.sessionId);
      expect(body.lastSeq).toBeGreaterThanOrEqual(1);
      // The roster + bound default drive the panel's engine selector.
      expect(Array.isArray(body.engines)).toBe(true);
      expect(body.engines).toContain('claude');
      expect(body.engineId).toBe('claude');

      // SSE replay shows the seeded boot event (fan-out off the ledger, no live engine).
      const ctrl = new AbortController();
      const ev = await fetch(`${url}/events?from=0`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      expect(ev.status).toBe(200);
      const reader = ev.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (let i = 0; i < 8; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        if (buf.includes('agon serve session started')) break;
      }
      ctrl.abort();
      expect(buf).toContain('agon serve session started');
    } finally {
      await runtime.serve.close();
      await runtime.brain.close();
    }
  });

  it('buildServeRuntime rejects an unknown engine before binding', async () => {
    await expect(
      buildServeRuntime({ engineId: 'definitely-not-an-engine', cwd: process.cwd(), allowedOrigins: [] }),
    ).rejects.toThrow(/Unknown engine/);
  });

  it('register-capability validates the spec + accepts a valid one (the AGENTIC brain is wired, not the unsupported v1)', async () => {
    const runtime = await buildServeRuntime({ engineId: 'claude', cwd: process.cwd(), allowedOrigins: ['https://ext.example'] });
    const { url, token } = await runtime.serve.start(0);
    const H = { Authorization: `Bearer ${token}`, Origin: 'https://ext.example', 'Content-Type': 'application/json' };
    try {
      // A spec missing name/description → 400 (the spec is client-supplied/untrusted).
      const bad = await fetch(`${url}/register-capability`, { method: 'POST', headers: H, body: JSON.stringify({ clientId: 'c', spec: { description: 'x' } }) });
      expect(bad.status).toBe(400);
      // A valid spec → 200 accepted. The headless v1 returned { unsupported } here; an
      // 'accepted' proves serve now binds the agentic tool-loop brain.
      const good = await fetch(`${url}/register-capability`, { method: 'POST', headers: H, body: JSON.stringify({ clientId: 'c', spec: { name: 'readPage', description: 'read the page', inputSchema: {}, isReadOnly: true } }) });
      expect(good.status).toBe(200);
      expect(await good.json()).toEqual({ status: 'accepted' });
      // /approval validates the decision enum.
      const badDec = await fetch(`${url}/approval`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'r', decision: 'maybe' }) });
      expect(badDec.status).toBe(400);
      // A stale capability-result is a 200 carrying a rejected ack (no pending request).
      const stale = await fetch(`${url}/capability-result`, { method: 'POST', headers: H, body: JSON.stringify({ requestId: 'nope', ok: true }) });
      expect(stale.status).toBe(200);
      expect((await stale.json()).status).toBe('rejected');
    } finally {
      await runtime.serve.close();
      await runtime.brain.close();
    }
  });

  it('capability round-trip over the wire: send blocks on a capability-request (SSE) until /capability-result lands — no deadlock', async () => {
    // A fake agentic brain: runTurn yields a capability-request, AWAITS its result via
    // provideCapabilityResult, then yields the answer. Proves AgonServe ships the request
    // over SSE while /send still holds the turn lock, and the separate /capability-result
    // endpoint resolves that suspended turn (the whole reason control endpoints bypass turnTail).
    const pending = new Map<string, (r: { ok: boolean; output?: string }) => void>();
    const fakeBrain = {
      runTurn: async function* (req: { turnId: string }) {
        yield { kind: 'capability-request', requestId: 'cap-req-1', capability: 'readPage', input: {}, targetClientId: 'c-ext' };
        const r = await new Promise<{ ok: boolean; output?: string }>((resolve) => pending.set('cap-req-1', resolve));
        yield { kind: 'engine', engineId: 'x', content: `the page says: ${r.output ?? ''}` };
        return { turnId: req.turnId, delegated: false, responded: true, engineId: 'x' };
      },
      provideCapabilityResult: async (res: { requestId: string; ok: boolean; output?: string }) => {
        const resolve = pending.get(res.requestId);
        if (!resolve) return { status: 'rejected', reason: 'none' };
        pending.delete(res.requestId);
        resolve({ ok: res.ok, output: res.output });
        return { status: 'accepted' };
      },
    } as unknown as BrainClient;

    const sessionId = newServeSessionId(1700000009999);
    seedServeSession(sessionId, 'x'); // give the SSE replay a floor
    const serve = createAgonServe({ brain: fakeBrain, sessionId, allowedOrigins: ['https://ext.example'], engines: ['x'], engineId: 'x' });
    const { url, token } = await serve.start(0);
    const H = { Authorization: `Bearer ${token}`, Origin: 'https://ext.example' };
    const ctrl = new AbortController();
    try {
      const ev = await fetch(`${url}/events?from=0`, { headers: { ...H }, signal: ctrl.signal });
      const reader = ev.body!.getReader();
      const dec = new TextDecoder();

      // Fire /send but DON'T await — it cannot resolve until we answer the capability.
      const sendP = fetch(`${url}/send`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'what is on the page', clientId: 'c-ext' }) });

      // Read SSE frames until the capability-request arrives.
      let buf = '';
      let reqId = '';
      for (let i = 0; i < 60 && !reqId; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        for (const line of buf.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const entry = JSON.parse(line.slice(6)) as { event?: { kind?: string; requestId?: string } };
            if (entry.event?.kind === 'capability-request') reqId = entry.event.requestId ?? '';
          } catch { /* partial frame — next read completes it */ }
        }
      }
      expect(reqId).toBe('cap-req-1');

      // Answer the capability via its own endpoint while /send is still pending.
      const capRes = await fetch(`${url}/capability-result`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: reqId, ok: true, output: 'HELLO WORLD', clientId: 'c-ext' }) });
      expect(capRes.status).toBe(200);
      expect((await capRes.json()).status).toBe('accepted');

      // NOW /send completes, carrying the brain's terminal result.
      const sendRes = await sendP;
      expect(sendRes.status).toBe(200);
      const body = await sendRes.json();
      expect(body.result).toMatchObject({ responded: true, engineId: 'x' });
    } finally {
      ctrl.abort();
      await serve.close();
    }
  }, 15000);

  it('runServe fails CLOSED (exit 2) when the port is in use — no crash, no hang, brain torn down', async () => {
    // Occupy a loopback port so AgonServe.start(port) rejects (EADDRINUSE).
    const blocker = createServer(() => {});
    const port: number = await new Promise((res) =>
      blocker.listen(0, '127.0.0.1', () => res((blocker.address() as { port: number }).port)),
    );
    const prevExit = process.exitCode;
    try {
      // Must RESOLVE (not reject/hang): the bind failure is caught, the opened
      // brain is closed, and the command fails closed with exit 2.
      await runServe(port, 'claude', [], false);
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = prevExit; // don't poison the test runner's exit code
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  }, 15000);
});
