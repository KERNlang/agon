import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type Socket } from 'node:net';

// Throwaway AGON_HOME before the event ledger resolves any path (set pre-import,
// matching the sibling bridge tests — the generated modules resolve paths at call
// time). Captured so afterAll can remove it instead of leaking a temp dir per run.
const TMP_HOME = mkdtempSync(join(tmpdir(), 'agon-serve-conformance-'));
process.env.AGON_HOME = TMP_HOME;

import { createAgonServe } from '../../packages/cli/src/generated/bridge/agon-serve.js';
import type { BrainClient } from '@kernlang/agon-core';

// ─────────────────────────────────────────────────────────────────────────────
// Conformance harness for the AgonServe wire contract (the "does the bridge
// survive a real client" gate the Agon-Everywhere council named #2). The unit
// tests prove the bridge WORKS on the happy path; this proves the four adversarial
// wire properties a browser/Electron client will actually inflict on it:
//
//   1. fan-out      — N concurrent subscribers see the SAME events in the SAME order
//   2. reconnect    — drop + resume from a cursor: no missed events, no duplicates
//   3. dup/order    — replay→LIVE-subscribe handoff never double-delivers; order kept
//   4. backpressure — a wedged consumer never blocks LIVE delivery to a healthy one
//
// Driven by a deterministic counting brain (each /send emits N ordered engine
// events) so ordering/counting/dedup are exactly assertable, over real loopback
// HTTP + SSE — the same fetch/ReadableStream API a browser extension uses. Each
// test gets its OWN bridge (fresh session + ephemeral port) so a `?from=0` replay
// only ever sees that test's events. The "live" tests (dup, backpressure) send the
// second turn only AFTER the subscriber confirms it is connected (saw the first
// turn), so they exercise the LIVE subscribe path, not just replay.
// ─────────────────────────────────────────────────────────────────────────────

const EVENTS_PER_TURN = 3;

afterAll(() => { try { rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

// A brain whose every turn emits EVENTS_PER_TURN ordered engine events
// `<input>#0..<input>#N-1` — deterministic, so the wire's ordering + dedup are
// exactly checkable. AgonServe only calls runTurn + cancel (minimal stub, as in
// the sibling agon-serve.test.ts).
function countingBrain(): BrainClient {
  return {
    async *runTurn(req: { turnId: string; input: string }) {
      for (let i = 0; i < EVENTS_PER_TURN; i++) {
        yield { kind: 'engine', engineId: 'claude', content: `${req.input}#${i}` };
      }
      return { turnId: req.turnId, delegated: false, responded: true, engineId: 'claude' };
    },
    async cancel() { return { status: 'accepted' as const }; },
  } as unknown as BrainClient;
}

async function freshBridge(sessionId: string): Promise<{ serve: ReturnType<typeof createAgonServe>; url: string; token: string }> {
  const serve = createAgonServe({ brain: countingBrain(), sessionId, allowedOrigins: [] });
  const { url, token } = await serve.start(0);
  return { serve, url, token };
}

type LoggedFrame = { seq: number; event: { kind?: string; content?: string; clientId?: string } };

const engineContents = (frames: LoggedFrame[]): string[] =>
  frames.filter((f) => f.event?.kind === 'engine').map((f) => f.event.content ?? '');
const seqsOf = (frames: LoggedFrame[]): number[] => frames.map((f) => f.seq);

// Read an SSE stream, collecting parsed LoggedEvent frames, until `until(frames)`
// is satisfied or `timeoutMs` elapses; then abort + return what was collected.
// `onProgress` fires after each read batch (used to send the LIVE turn only once
// the subscriber is confirmed connected). Surfaces protocol regressions loudly:
// a non-2xx /events, a missing body, or a malformed COMPLETE `data:` frame throw
// rather than masquerade as a timeout. Skips `: ping` comment frames.
async function readEvents(
  url: string,
  token: string,
  opts: { from?: number; until?: (frames: LoggedFrame[]) => boolean; onProgress?: (frames: LoggedFrame[]) => void; timeoutMs?: number } = {},
): Promise<LoggedFrame[]> {
  const { from = 0, until, onProgress, timeoutMs = 9000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const frames: LoggedFrame[] = [];
  try {
    const res = await fetch(`${url}/events?from=${from}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`/events returned HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      if (until && until(frames)) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (frame.startsWith('data:')) {
          // A complete \n\n-delimited data: frame is a full SSE event — a parse
          // failure here is a protocol regression, not a partial chunk, so let it throw.
          frames.push(JSON.parse(frame.slice(frame.startsWith('data: ') ? 6 : 5)));
        }
      }
      if (onProgress) onProgress(frames);
      if (until && until(frames)) break;
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return frames;
}

async function send(url: string, token: string, input: string): Promise<Response> {
  return fetch(`${url}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
}

describe('AgonServe — wire conformance (reconnect / fan-out / backpressure / dup-suppress)', () => {
  it('fan-out: 3 concurrent subscribers receive identical, ordered event streams', async () => {
    const { serve, url, token } = await freshBridge('sess-fanout');
    try {
      // All three subscribe from 0; whichever events the turn produces, every
      // subscriber must see the same engine events in the same order (replay covers
      // any that connect after the append; live subscribe covers the rest).
      const subs = [0, 1, 2].map(() =>
        readEvents(url, token, { from: 0, until: (f) => engineContents(f).length >= EVENTS_PER_TURN, timeoutMs: 9000 }),
      );
      expect((await send(url, token, 'fan')).status).toBe(200);

      const streams = await Promise.all(subs);
      const expected = ['fan#0', 'fan#1', 'fan#2'];
      for (const s of streams) expect(engineContents(s)).toEqual(expected);
      // The per-/send provenance frame is part of the wire — every subscriber sees it.
      for (const s of streams) expect(s.some((f) => f.event?.kind === 'provenance' && f.event.clientId)).toBe(true);
    } finally {
      await serve.close();
    }
  }, 15000);

  it('reconnect: resume from the last-seen cursor with no gaps and no duplicates', async () => {
    const { serve, url, token } = await freshBridge('sess-reconnect');
    try {
      expect((await send(url, token, 'A')).status).toBe(200);

      // Subscriber drains turn A, then "drops" — assert it got A in full, then
      // record the highest seq it saw as the resume cursor.
      const first = await readEvents(url, token, { from: 0, until: (f) => engineContents(f).includes('A#2'), timeoutMs: 9000 });
      expect(engineContents(first)).toEqual(['A#0', 'A#1', 'A#2']);
      const lastSeen = Math.max(...seqsOf(first));

      expect((await send(url, token, 'B')).status).toBe(200);

      // Reconnect from the cursor: must get turn B and ONLY turn B (strictly greater
      // than lastSeen → no A redelivered = no dup; all three B events = no gap).
      const resumed = await readEvents(url, token, { from: lastSeen, until: (f) => engineContents(f).includes('B#2'), timeoutMs: 9000 });
      expect(engineContents(resumed)).toEqual(['B#0', 'B#1', 'B#2']);
      expect(seqsOf(resumed).every((s) => s > lastSeen)).toBe(true);
      expect(engineContents(resumed).some((c) => c.startsWith('A#'))).toBe(false);
    } finally {
      await serve.close();
    }
  }, 20000);

  it('dup-suppress + ordering: replay→LIVE-subscribe handoff delivers each seq exactly once', async () => {
    const { serve, url, token } = await freshBridge('sess-dup');
    try {
      expect((await send(url, token, 'C')).status).toBe(200);
      // Genuine replay→live handoff: connect + drain C (replay), and only ONCE C is
      // fully received (proving the subscriber is live) send D so it arrives LIVE on
      // the same stream. The handoff must not double-deliver the boundary event.
      let dSent = false;
      const frames = await readEvents(url, token, {
        from: 0,
        until: (f) => engineContents(f).length >= 2 * EVENTS_PER_TURN,
        onProgress: (f) => { if (!dSent && engineContents(f).includes('C#2')) { dSent = true; void send(url, token, 'D'); } },
        timeoutMs: 12000,
      });

      expect(engineContents(frames)).toEqual(['C#0', 'C#1', 'C#2', 'D#0', 'D#1', 'D#2']);
      const allSeqs = seqsOf(frames);
      expect(new Set(allSeqs).size).toBe(allSeqs.length); // no seq delivered twice
      for (let i = 1; i < allSeqs.length; i++) expect(allSeqs[i]).toBeGreaterThan(allSeqs[i - 1]); // monotonic
    } finally {
      await serve.close();
    }
  }, 20000);

  it('backpressure: a wedged SSE consumer never blocks LIVE delivery to a healthy subscriber', async () => {
    const { serve, url, token } = await freshBridge('sess-backpressure');
    const u = new URL(url);
    // A genuinely STUCK consumer: a raw TCP socket that issues a valid /events
    // request and then NEVER reads the response (a non-draining peer). A raw socket,
    // not fetch, so it's independent of undici's client connection pool. The proven
    // property is DECOUPLING: /send writes to the LEDGER and SSE delivery is a
    // separate poll, so a wedged peer can neither stall a turn nor block LIVE fan-out
    // to a healthy subscriber (not buffer saturation — just non-draining).
    const stalled: Socket = connect(Number(u.port), u.hostname);
    stalled.on('error', () => { /* a wedged socket may RST on teardown — never crash */ });
    try {
      await new Promise<void>((res, rej) => {
        stalled.once('connect', () => res());
        stalled.once('error', rej);
      });
      stalled.write(`GET /events?from=0 HTTP/1.1\r\nHost: ${u.host}\r\nAuthorization: Bearer ${token}\r\n\r\n`);
      stalled.pause(); // never drain the response

      // Warm-up turn so the healthy subscriber can confirm it is CONNECTED + live;
      // only then send E, so E is delivered LIVE while the raw peer stays wedged.
      expect((await send(url, token, 'W')).status).toBe(200);
      let eSent = false;
      const healthy = await readEvents(url, token, {
        from: 0,
        until: (f) => engineContents(f).includes('E#2'),
        onProgress: (f) => { if (!eSent && engineContents(f).includes('W#2')) { eSent = true; void send(url, token, 'E'); } },
        timeoutMs: 12000,
      });

      // E arrived LIVE (after the healthy peer was confirmed live) while the wedged
      // peer never drained — live fan-out is unaffected by the stuck consumer.
      expect(engineContents(healthy)).toEqual(['W#0', 'W#1', 'W#2', 'E#0', 'E#1', 'E#2']);
    } finally {
      stalled.destroy();
      await serve.close();
    }
  }, 20000);
});
