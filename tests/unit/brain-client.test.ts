import { describe, it, expect } from 'vitest';

import {
  conservativeControlCapabilities,
  type BrainEvent,
  type ControlAck,
  type ControlCapabilities,
  type BrainTurnRequest,
  type ClientRef,
} from '../../packages/core/src/generated/sessions/brain-client.js';

// The BrainClient contract makes two load-bearing promises the doc strings can
// only assert: (1) the v1 host declares a known-conservative capability matrix,
// and (2) every wire value is FULLY SERIALIZABLE — no `resolve` callback, no
// AbortSignal, no Date/Map/Symbol — because it crosses the daemon's event
// ledger and a socket. These tests lock both so an accidental edit (renaming an
// axis, or adding a non-JSON-safe field to a BrainEvent variant) fails CI.

// Assert a value survives a JSON round-trip unchanged.
function roundTrips<T>(value: T): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

describe('brain-client — conservativeControlCapabilities (v1 host matrix)', () => {
  it('declares the documented conservative matrix on all six axes', () => {
    expect(conservativeControlCapabilities()).toEqual({
      concurrentTurns: 'per-session-serialized',
      concurrentSteering: 'host-only',
      approvalArbitration: 'host-only',
      questionArbitration: 'host-only',
      clientCapabilities: 'supported',
      cancellation: 'per-turn',
    } satisfies ControlCapabilities);
  });

  it('keeps client-provided capabilities supported in v1 (the frontend-inspector path)', () => {
    // The browser-extension screenshot/page-content path must work even while
    // steering/approvals are host-only — else the headline use case breaks.
    expect(conservativeControlCapabilities().clientCapabilities).toBe('supported');
  });

  it('returns a fresh object each call (no shared mutable singleton)', () => {
    expect(conservativeControlCapabilities()).not.toBe(conservativeControlCapabilities());
  });
});

describe('brain-client — BrainEvent is fully JSON-serializable (no callbacks)', () => {
  // One representative instance per variant. If a future edit adds a non-JSON-
  // safe field (Date/Map/Symbol/callback) to any variant, its round-trip breaks.
  const samples: BrainEvent[] = [
    { kind: 'text', content: 'hi' },
    { kind: 'engine', engineId: 'claude', content: 'thinking' },
    { kind: 'tool', engineId: 'codex', tool: 'Read', status: 'done', input: 'x', output: 'y' },
    { kind: 'notice', level: 'warning', message: 'heads up' },
    { kind: 'recap', engineId: 'claude', mode: 'build', outcome: 'done', durationMs: 1200, confidence: 90, toolCount: 4 },
    { kind: 'confidence', value: null },
    { kind: 'context', pct: 42, used: 4200, limit: 10000 },
    { kind: 'approval-request', requestId: 'r1', tool: 'Bash', command: 'rm x', reason: 'cleanup' },
    { kind: 'question-request', requestId: 'r2', prompt: 'pick', choices: [{ key: 'a', label: 'A', color: 'green' }], defaultChoiceKey: 'a' },
    { kind: 'capability-request', requestId: 'r3', capability: 'screenshot', input: { selector: 'body' }, targetClientId: 'c-browser' },
  ];

  for (const ev of samples) {
    it(`round-trips '${ev.kind}'`, () => roundTrips(ev));
  }

  it('replaces in-process callbacks with a requestId on every *-request variant', () => {
    const controlKinds: BrainEvent['kind'][] = ['approval-request', 'question-request', 'capability-request'];
    const controlEvents = samples.filter((s) => controlKinds.includes(s.kind));
    expect(controlEvents).toHaveLength(3);
    for (const ev of controlEvents) {
      // the crux: a correlation id stands in for the stripped resolve callback
      expect((ev as { requestId?: string }).requestId).toBeTruthy();
      expect(typeof (ev as Record<string, unknown>).resolve).toBe('undefined');
    }
  });

  it('preserves question menu metadata so remote clients keep constrained prompts', () => {
    const q = samples.find((s) => s.kind === 'question-request');
    // codex review: dropping choices/defaultChoiceKey would degrade fork/escalation/plan menus to free-text
    expect(q && 'choices' in q && q.choices?.[0]?.key).toBe('a');
    expect(q && 'defaultChoiceKey' in q && q.defaultChoiceKey).toBe('a');
  });
});

describe('brain-client — ControlAck carries the honest unsupported arm', () => {
  const acks: ControlAck[] = [
    { status: 'accepted' },
    { status: 'rejected', reason: 'stale requestId' },
    { status: 'unsupported', reason: 'v1 host-only' },
  ];
  for (const ack of acks) it(`round-trips '${ack.status}'`, () => roundTrips(ack));

  it('exhaustive switch over status compiles (the contract is closed)', () => {
    const render = (a: ControlAck): string => {
      switch (a.status) {
        case 'accepted': return 'ok';
        case 'rejected': return a.reason;
        case 'unsupported': return a.reason;
        default: { const _never: never = a; return _never; }
      }
    };
    expect(acks.map(render)).toEqual(['ok', 'stale requestId', 'v1 host-only']);
  });
});

describe('brain-client — turn provenance', () => {
  it('a turn request names its originating client (security provenance) and round-trips', () => {
    const req: BrainTurnRequest = {
      sessionId: 's1', turnId: 't1', clientId: 'c-cli', input: 'do it',
      images: ['data:image/png;base64,AAAA'], hintClass: 'code',
    };
    expect(req.clientId).toBe('c-cli');
    roundTrips(req);
  });

  it('a ClientRef tags its surface for arbitration/capability routing', () => {
    const ref: ClientRef = { clientId: 'c-browser', surface: 'browser', label: 'Chrome tab' };
    roundTrips(ref);
    expect(ref.surface).toBe('browser');
  });
});
