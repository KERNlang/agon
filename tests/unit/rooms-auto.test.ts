import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { createRoom, roomDir } from '../../packages/core/src/generated/rooms/store.js';
import { acquireTurnLease, releaseTurnLease, readActiveLease } from '../../packages/core/src/generated/rooms/leases.js';
import { detectTrigger, detectPingPong, evaluateStop } from '../../packages/core/src/generated/rooms/auto-policy.js';
import type { RoomEvent, AutoConfig, AutoState } from '../../packages/core/src/generated/rooms/types.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-auto-')); process.env.AGON_HOME = home; });
afterEach(() => { delete process.env.AGON_HOME; rmSync(home, { recursive: true, force: true }); });

const ev = (seq: number, callsign: string, body: string, opts: { mentions?: string[]; auto?: boolean; human?: boolean; ageMs?: number; kind?: string } = {}): RoomEvent => ({
  seq, id: `e${seq}`, roomId: 'r', kind: opts.kind ?? 'post',
  createdAt: new Date(Date.now() - (opts.ageMs ?? 0)).toISOString(),
  actor: { actorId: callsign, callsign, kind: opts.human ? 'human' : 'external-cli', cli: 'cli', humanOwner: 'x' },
  repoHint: 'x', body, mentions: opts.mentions ?? [], replyTo: null, auto: opts.auto ?? false,
});

const cfg = (over: Partial<AutoConfig> = {}): AutoConfig => ({
  callsign: 'me', openFloor: false, quietMs: 1500, maxTurns: 3, maxWallMs: 600000, stopPhrase: '', untilHuman: false, ...over,
});
const state = (over: Partial<AutoState> = {}): AutoState => ({ turns: 0, startedAtMs: Date.now(), lastSelfSeq: 0, ...over });

describe('rooms turn leases', () => {
  it('gives the floor to one holder at a time, frees on release', () => {
    createRoom('r');
    const a = acquireTurnLease('r', 'alice', 1, 30000);
    expect(a).not.toBeNull();
    expect(acquireTurnLease('r', 'bob', 1, 30000)).toBeNull(); // floor held by alice
    expect(readActiveLease('r')?.holder).toBe('alice');
    releaseTurnLease('r', a!.leaseId);
    expect(readActiveLease('r')).toBeNull();
    expect(acquireTurnLease('r', 'bob', 2, 30000)).not.toBeNull(); // now free
  });

  it('treats an expired lease as free (stealable)', () => {
    createRoom('r');
    writeFileSync(join(roomDir('r'), 'leases.json'), JSON.stringify({ leaseId: 'old', holder: 'ghost', triggerSeq: 1, acquiredAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(readActiveLease('r')).toBeNull(); // expired
    expect(acquireTurnLease('r', 'bob', 5, 30000)).not.toBeNull();
  });
});

describe('detectTrigger', () => {
  it('mention-only: fires on a mention of me, ignores non-mentions', () => {
    expect(detectTrigger([ev(1, 'codex', 'hey @me', { mentions: ['me'] })], 'me', false, 1500)).toMatchObject({ trigger: true, reason: 'mentioned', triggerSeq: 1 });
    expect(detectTrigger([ev(1, 'codex', 'just chatting')], 'me', false, 1500)).toMatchObject({ trigger: false, reason: 'not-mentioned' });
  });
  it('never answers my own latest post', () => {
    expect(detectTrigger([ev(1, 'codex', 'hi @me'), ev(2, 'me', 'on it')], 'me', false, 1500)).toMatchObject({ trigger: false, reason: 'self-latest' });
  });
  it('open-floor fires only after the quiet window', () => {
    expect(detectTrigger([ev(1, 'codex', 'anyone?', { ageMs: 3000 })], 'me', true, 1500)).toMatchObject({ trigger: true, reason: 'open-floor' });
    expect(detectTrigger([ev(1, 'codex', 'anyone?', { ageMs: 200 })], 'me', true, 1500)).toMatchObject({ trigger: false, reason: 'waiting-quiet' });
  });
});

describe('detectPingPong', () => {
  it('flags A→B→A→B between two auto agents', () => {
    expect(detectPingPong([ev(1, 'a', '1', { auto: true }), ev(2, 'b', '2', { auto: true }), ev(3, 'a', '3', { auto: true }), ev(4, 'b', '4', { auto: true })])).toBe(true);
  });
  it('does NOT flag when a human is involved or pattern breaks', () => {
    expect(detectPingPong([ev(1, 'a', '1', { auto: true }), ev(2, 'b', '2'), ev(3, 'a', '3', { auto: true }), ev(4, 'b', '4', { auto: true })])).toBe(false); // b#2 is human
    expect(detectPingPong([ev(1, 'a', '1', { auto: true }), ev(2, 'a', '2', { auto: true }), ev(3, 'b', '3', { auto: true }), ev(4, 'b', '4', { auto: true })])).toBe(false); // not alternating
    expect(detectPingPong([ev(1, 'a', '1', { auto: true }), ev(2, 'b', '2', { auto: true })])).toBe(false); // too few
  });
});

describe('evaluateStop', () => {
  it('hard caps: max-turns, max-wall, ping-pong always stop', () => {
    expect(evaluateStop(state({ turns: 3 }), cfg({ maxTurns: 3 }), [])).toMatchObject({ stop: true, reason: expect.stringContaining('max-turns') });
    expect(evaluateStop(state({ startedAtMs: Date.now() - 700000 }), cfg({ maxWallMs: 600000 }), [])).toMatchObject({ stop: true, reason: 'max-wall-time' });
    const pp = [ev(1, 'a', '1', { auto: true }), ev(2, 'b', '2', { auto: true }), ev(3, 'a', '3', { auto: true }), ev(4, 'b', '4', { auto: true })];
    expect(evaluateStop(state(), cfg(), pp)).toMatchObject({ stop: true, reason: 'ping-pong-halt' });
  });
  it('until-human stops only after I have taken a turn and a human replies', () => {
    const events = [ev(5, 'human', 'thanks, I got it', { human: true })];
    expect(evaluateStop(state({ turns: 0, lastSelfSeq: 0 }), cfg({ untilHuman: true }), events)).toMatchObject({ stop: false }); // not my turn yet
    expect(evaluateStop(state({ turns: 1, lastSelfSeq: 4 }), cfg({ untilHuman: true }), events)).toMatchObject({ stop: true, reason: 'human-replied' });
  });
  it('stop-phrase halts on a matching post from someone else', () => {
    expect(evaluateStop(state(), cfg({ stopPhrase: 'STOP' }), [ev(1, 'human', 'ok STOP now', { human: true })])).toMatchObject({ stop: true, reason: 'stop-phrase' });
  });
  it('returns no-stop when nothing matches', () => {
    expect(evaluateStop(state({ turns: 1 }), cfg(), [ev(1, 'codex', 'hello', { auto: true })])).toMatchObject({ stop: false });
  });
});
