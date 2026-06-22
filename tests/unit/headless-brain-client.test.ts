import { describe, it, expect } from 'vitest';

import {
  HeadlessTurnBrainClient,
  createHeadlessTurnBrainClient,
} from '../../packages/cli/src/generated/bridge/headless-brain-client.js';
import type { BrainEvent, BrainTurnResult, EngineAdapter, EngineRegistry } from '@kernlang/agon-core';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The v1 BrainClient runs a real engine subprocess via adapter.dispatch. To unit-
// test the BRAIN logic (event projection, single-writer guard, cancellation,
// honest control acks) we inject a fake adapter and a stub registry — no engine
// is spawned. The dispatch contract we fake: { exitCode, stdout, stderr,
// durationMs, timedOut }.

type FakeDispatch = (opts: { signal?: AbortSignal; mode?: string; prompt?: string; images?: unknown }) => Promise<unknown>;

function makeClient(dispatch: FakeDispatch): HeadlessTurnBrainClient {
  const registry = { get: (id: string) => ({ id }) } as unknown as EngineRegistry;
  const client = new HeadlessTurnBrainClient(registry);
  (client as unknown as { adapter: EngineAdapter }).adapter = {
    dispatch,
    isAvailable: async () => true,
  } as unknown as EngineAdapter;
  return client;
}

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', durationMs: 1, timedOut: false });
const req = (turnId: string) => ({ sessionId: 's', turnId, clientId: 'c-cli', input: 'hi' });

async function drain(gen: AsyncGenerator<BrainEvent, BrainTurnResult, void>) {
  const events: BrainEvent[] = [];
  let r = await gen.next();
  while (!r.done) { events.push(r.value); r = await gen.next(); }
  return { events, result: r.value };
}

describe('HeadlessTurnBrainClient — single-engine turn streaming', () => {
  it('streams working notice → engine answer → responded result', async () => {
    const client = makeClient(async (opts) => {
      expect(opts.mode).toBe('exec');
      expect(opts.prompt).toBe('hi');
      return ok('the answer');
    });
    await client.open({ sessionId: 's', engineId: 'codex', cwd: '/tmp' });

    const { events, result } = await drain(client.runTurn(req('t1')));
    expect(events[0]).toMatchObject({ kind: 'notice', level: 'info' });
    expect(events.find((e) => e.kind === 'engine')).toMatchObject({ kind: 'engine', engineId: 'codex', content: 'the answer' });
    expect(result).toMatchObject({ turnId: 't1', delegated: false, responded: true, engineId: 'codex' });
    // back to idle
    expect((await client.health()).activeTurnId).toBeNull();
  });

  it('reports no-answer and timeout as failure results, not a crash', async () => {
    const noAnswer = makeClient(async () => ({ exitCode: 1, stdout: '', stderr: 'boom', durationMs: 1, timedOut: false }));
    await noAnswer.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    const r1 = await drain(noAnswer.runTurn(req('t1')));
    expect(r1.result.responded).toBe(false);
    expect(r1.result.reason).toMatch(/no answer/);

    const timedOut = makeClient(async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: true }));
    await timedOut.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    const r2 = await drain(timedOut.runTurn(req('t2')));
    expect(r2.result.reason).toMatch(/timed out/);
  });

  it('a thrown dispatch becomes a failure result, not an unhandled rejection', async () => {
    const client = makeClient(async () => { throw new Error('spawn EACCES'); });
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    const { result } = await drain(client.runTurn(req('t1')));
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/turn failed: spawn EACCES/);
  });

  it('a missing engine surfaces as a failure result, not a crash', async () => {
    const registry = { get: () => { throw new Error('engine not found'); } } as unknown as EngineRegistry;
    const client = new HeadlessTurnBrainClient(registry);
    (client as unknown as { adapter: EngineAdapter }).adapter = { dispatch: async () => ok('x'), isAvailable: async () => true } as unknown as EngineAdapter;
    await client.open({ sessionId: 's', engineId: 'ghost', cwd: '/tmp' });
    const { result } = await drain(client.runTurn(req('t1')));
    expect(result.responded).toBe(false);
    expect(result.reason).toMatch(/turn failed: engine not found/);
  });

  it('forwards a user-supplied screenshot as a vision image (the frontend-inspector path)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-bc-'));
    const png = join(dir, 'shot.png');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG magic
    let seen: unknown;
    const client = makeClient(async (opts) => { seen = opts.images; return ok('the layout looks cramped'); });
    await client.open({ sessionId: 's', engineId: 'claude', cwd: process.cwd() });

    const { result } = await drain(client.runTurn({ sessionId: 's', turnId: 't1', clientId: 'c-browser', input: 'review this UX', images: [png] }));
    expect(result.responded).toBe(true);
    expect(Array.isArray(seen)).toBe(true);
    expect((seen as unknown[]).length).toBe(1);
    expect((seen as Array<{ path: string }>)[0].path).toBe(png);
  });

  it('materializes a base64 data-URL screenshot (the browser inspector path) to a scratch file and forwards it', async () => {
    // A browser sends a base64 data URL, not a path; the brain must decode + write
    // it to its per-turn scratch dir, then forward the FILE (not the data URL).
    const pngDataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
    let seen: unknown;
    const client = makeClient(async (opts) => { seen = opts.images; return ok('the spacing is tight'); });
    await client.open({ sessionId: 's', engineId: 'claude', cwd: process.cwd() });

    const { result } = await drain(client.runTurn({ sessionId: 's', turnId: 't-img', clientId: 'c-browser', input: 'review this UI', images: [pngDataUrl] }));
    expect(result.responded).toBe(true);
    expect(Array.isArray(seen)).toBe(true);
    expect((seen as unknown[]).length).toBe(1);
    expect((seen as Array<{ path: string }>)[0].path).toMatch(/agon-brain-turns.*[/\\]img-0\.png$/);
  });

  it('drops a malformed data-URL image (bad MIME) and still answers, no attachment forwarded', async () => {
    const badDataUrl = `data:text/plain;base64,${Buffer.from('not an image').toString('base64')}`;
    let seen: unknown;
    const client = makeClient(async (opts) => { seen = opts.images; return ok('answered without the image'); });
    await client.open({ sessionId: 's', engineId: 'claude', cwd: process.cwd() });

    const { result } = await drain(client.runTurn({ sessionId: 's', turnId: 't-bad', clientId: 'c-browser', input: 'review', images: [badDataUrl] }));
    expect(result.responded).toBe(true);
    expect(seen).toBeUndefined(); // no valid images → dispatch gets `undefined`, not an empty array
  });
});

describe('HeadlessTurnBrainClient — single-writer + cancellation', () => {
  it('rejects a concurrent turn while one is active', async () => {
    const client = makeClient(async () => ok('x'));
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });

    const gen1 = client.runTurn(req('t1'));
    await gen1.next(); // pause at the 'working' yield — activeTurnId is now t1

    const { events, result } = await drain(client.runTurn(req('t2')));
    expect(result.responded).toBe(false);
    expect(events.some((e) => e.kind === 'notice' && /busy/.test((e as { message: string }).message))).toBe(true);

    await drain(gen1); // let t1 finish, restoring idle
    expect((await client.health()).activeTurnId).toBeNull();
  });

  it('cancel: rejected for an unknown turn, accepted + cancelled for the active one', async () => {
    const client = makeClient(async (opts) =>
      opts.signal?.aborted
        ? { exitCode: 1, stdout: '', stderr: 'aborted', durationMs: 1, timedOut: false }
        : ok('x'),
    );
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });

    expect(await client.cancel({ sessionId: 's', turnId: 'nope', clientId: 'c-cli' }))
      .toEqual({ status: 'rejected', reason: expect.stringContaining('nope') });

    const gen1 = client.runTurn(req('t1'));
    await gen1.next(); // abort controller for t1 is registered
    expect(await client.cancel({ sessionId: 's', turnId: 't1', clientId: 'c-cli' })).toEqual({ status: 'accepted' });

    const { events, result } = await drain(gen1);
    expect(result.responded).toBe(false);
    expect(result.reason).toBe('cancelled by client');
    expect(events.some((e) => e.kind === 'notice' && (e as { level: string }).level === 'warning')).toBe(true);
  });

  it('a dispatch that REJECTS on abort still reads as cancelled, not a failure', async () => {
    const client = makeClient((opts) =>
      new Promise<unknown>((_resolve, reject) => {
        if (opts.signal?.aborted) { reject(new Error('AbortError')); return; }
        opts.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
      }),
    );
    await client.open({ sessionId: 's', engineId: 'claude', cwd: '/tmp' });
    const gen = client.runTurn(req('t1'));
    await gen.next();           // 'working' yield; abort controller registered
    const pending = gen.next(); // dispatch in-flight, pending on the abort listener
    await client.cancel({ sessionId: 's', turnId: 't1', clientId: 'c-cli' });

    const ev = await pending;   // the cancelled notice (the rejected dispatch was caught)
    expect(ev.done).toBe(false);
    expect((ev.value as { message: string }).message).toBe('cancelled by client');
    const fin = await gen.next();
    expect(fin.done).toBe(true);
    expect((fin.value as BrainTurnResult).reason).toBe('cancelled by client');
  });
});

describe('HeadlessTurnBrainClient — honest capability surface', () => {
  it('declares a stricter-than-baseline matrix (no steering/approvals/capabilities; cancel only)', () => {
    const client = makeClient(async () => ok('x'));
    expect(client.controlCapabilities).toEqual({
      concurrentTurns: 'per-session-serialized',
      concurrentSteering: 'unsupported',
      approvalArbitration: 'unsupported',
      questionArbitration: 'unsupported',
      clientCapabilities: 'unsupported',
      cancellation: 'per-turn',
    });
  });

  it('every control path beyond cancel returns an honest unsupported ack', async () => {
    const client = makeClient(async () => ok('x'));
    const acks = [
      await client.steer({ sessionId: 's', clientId: 'c', input: 'left a bit' }),
      await client.provideApproval({ sessionId: 's', requestId: 'r', clientId: 'c', decision: 'approve' }),
      await client.provideAnswer({ sessionId: 's', requestId: 'r', clientId: 'c', answer: 'y' }),
      await client.registerCapability({ sessionId: 's', clientId: 'c', spec: { name: 'screenshot', description: '', inputSchema: {}, isReadOnly: true } }),
      await client.unregisterCapability({ sessionId: 's', clientId: 'c', name: 'screenshot' }),
      await client.provideCapabilityResult({ sessionId: 's', requestId: 'r', clientId: 'c', ok: true }),
    ];
    for (const ack of acks) expect(ack.status).toBe('unsupported');
  });

  it('factory builds an interface-conformant client reporting liveness', async () => {
    const client = createHeadlessTurnBrainClient({ get: (id: string) => ({ id }) } as unknown as EngineRegistry);
    const h = await client.health();
    expect(h.alive).toBe(true);
    expect(h.activeTurnId).toBeNull();
    expect(h.queuedTurns).toBe(0);
    expect(typeof h.uptimeMs).toBe('number');
  });
});
