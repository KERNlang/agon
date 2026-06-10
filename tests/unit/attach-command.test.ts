import { describe, it, expect } from 'vitest';

import {
  attachCommand,
  sortSessionsByRecency,
  renderLoggedEvent,
} from '../../packages/cli/src/generated/commands/attach.js';
import type { SessionDescriptor, LoggedEvent } from '../../packages/core/src/generated/sessions/session-host.js';

// Strip ANSI so assertions read on the visible text, not the color codes.
const plain = (s: string | null): string | null =>
  s === null ? null : s.replace(/\x1b\[[0-9;]*m/g, '');

const desc = (id: string, createdAt: string, lastSeq = 0): SessionDescriptor => ({
  id,
  createdAt,
  kind: 'repl',
  lastSeq,
  active: false,
});

const logged = (event: unknown, seq = 1): LoggedEvent => ({ seq, ts: Date.now(), event });

describe('agon attach — command registration', () => {
  it('registers as a citty command named "attach" with --self/--latest/sessionId', () => {
    expect(attachCommand?.meta?.name).toBe('attach');
    expect(attachCommand?.args?.self?.type).toBe('boolean');
    expect(attachCommand?.args?.latest?.type).toBe('boolean');
    expect(attachCommand?.args?.sessionId?.type).toBe('positional');
    expect(typeof attachCommand?.run).toBe('function');
  });
});

describe('agon attach — sortSessionsByRecency', () => {
  it('orders newest createdAt first and is a non-mutating copy', () => {
    const input = [
      desc('old', '2026-01-01T00:00:00.000Z'),
      desc('new', '2026-06-01T00:00:00.000Z'),
      desc('mid', '2026-03-01T00:00:00.000Z'),
    ];
    const sorted = sortSessionsByRecency(input);
    expect(sorted.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
    // original array order untouched
    expect(input.map((s) => s.id)).toEqual(['old', 'new', 'mid']);
  });

  it('sorts sessions with an unparseable createdAt last', () => {
    const sorted = sortSessionsByRecency([
      desc('dated', '2026-06-01T00:00:00.000Z'),
      desc('undated', ''),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['dated', 'undated']);
  });
});

describe('agon attach — renderLoggedEvent', () => {
  it('renders the common OutputEvent shapes as one-line transcript text', () => {
    expect(plain(renderLoggedEvent(logged({ type: 'user-message', content: 'do it' })))).toBe('› you do it');
    expect(plain(renderLoggedEvent(logged({ type: 'text', content: 'hello' })))).toBe('hello');
    expect(plain(renderLoggedEvent(logged({ type: 'engine-block', engineId: 'claude', content: 'answer' })))).toBe('◆ claude answer');
    expect(plain(renderLoggedEvent(logged({ type: 'success', message: 'ok' })))).toBe('✓ ok');
    expect(plain(renderLoggedEvent(logged({ type: 'error', message: 'boom' })))).toBe('✗ boom');
    expect(plain(renderLoggedEvent(logged({ type: 'tool-call', tool: 'Read', input: 'a.ts', status: 'done' })))).toBe('  ⚒ Read(a.ts)');
  });

  it('renders unknown event types as a dim type marker, and skips empty text', () => {
    expect(plain(renderLoggedEvent(logged({ type: 'context-usage', pct: 12 })))).toBe('· context-usage');
    // empty text content collapses to null (skipped in the dump)
    expect(renderLoggedEvent(logged({ type: 'text', content: '   ' }))).toBeNull();
  });

  it('skips non-object / null payloads (defensive against placeholder writes)', () => {
    expect(renderLoggedEvent(logged(null))).toBeNull();
    expect(renderLoggedEvent(logged('[unserializable]'))).toBeNull();
    // a placeholder envelope { event: '[unserializable]' } has no type → faint marker
    expect(plain(renderLoggedEvent(logged({})))).toBe('· (unserializable event)');
  });
});
