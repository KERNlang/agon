import { describe, it, expect } from 'vitest';

import {
  encodeDaemonRequest,
  encodeDaemonResponse,
  parseDaemonRequest,
  parseDaemonResponse,
  splitFrames,
  type DaemonRequest,
  type DaemonResponse,
} from '../../packages/core/src/generated/sessions/daemon-protocol.js';

// ── encode — one message → one newline-terminated JSON line ──────────────────

describe('daemon-protocol — encode', () => {
  it('encodes a request as exactly one newline-terminated JSON line', () => {
    const wire = encodeDaemonRequest({ type: 'prompt', text: 'hello' });
    expect(wire.endsWith('\n')).toBe(true);
    expect(wire.indexOf('\n')).toBe(wire.length - 1); // the only newline is the trailer
    expect(JSON.parse(wire.trim())).toEqual({ type: 'prompt', text: 'hello' });
  });

  it('encodes a response as exactly one newline-terminated JSON line', () => {
    const wire = encodeDaemonResponse({ type: 'pong', sessionId: 'daemon-1', uptime: 1234 });
    expect(wire.endsWith('\n')).toBe(true);
    expect(JSON.parse(wire.trim())).toEqual({ type: 'pong', sessionId: 'daemon-1', uptime: 1234 });
  });
});

// ── round-trip — encode then parse is identity for every variant ─────────────

describe('daemon-protocol — round-trip', () => {
  const requests: DaemonRequest[] = [
    { type: 'prompt', text: 'refactor auth' },
    { type: 'ping' },
    { type: 'shutdown' },
  ];
  for (const req of requests) {
    it(`request "${req.type}" survives encode → parse`, () => {
      const parsed = parseDaemonRequest(encodeDaemonRequest(req));
      expect(parsed).toEqual(req);
    });
  }

  const responses: DaemonResponse[] = [
    { type: 'ack', seq: 7 },
    { type: 'pong', sessionId: 'daemon-42', uptime: 999 },
    { type: 'busy' },
    { type: 'bye' },
    { type: 'error', message: 'boom' },
  ];
  for (const res of responses) {
    it(`response "${res.type}" survives encode → parse`, () => {
      const parsed = parseDaemonResponse(encodeDaemonResponse(res));
      expect(parsed).toEqual(res);
    });
  }
});

// ── tolerant parse — garbage never throws ────────────────────────────────────

describe('daemon-protocol — tolerant parse', () => {
  it('returns null for a blank / whitespace-only line', () => {
    expect(parseDaemonRequest('')).toBeNull();
    expect(parseDaemonRequest('   ')).toBeNull();
    expect(parseDaemonResponse('\t')).toBeNull();
  });

  it('maps malformed JSON to an error message instead of throwing', () => {
    expect(parseDaemonRequest('{not json')).toEqual({ type: 'error', message: 'malformed JSON' });
    expect(parseDaemonResponse('}{')).toEqual({ type: 'error', message: 'malformed JSON' });
  });

  it('maps a non-object JSON value to an error', () => {
    expect(parseDaemonRequest('42')).toEqual({ type: 'error', message: 'not an object' });
    expect(parseDaemonResponse('"hello"')).toEqual({ type: 'error', message: 'not an object' });
  });

  it('maps an unknown request type to an error carrying the type', () => {
    const parsed = parseDaemonRequest(JSON.stringify({ type: 'frobnicate' }));
    expect(parsed?.type).toBe('error');
    expect(parsed && parsed.type === 'error' && parsed.message).toContain('frobnicate');
  });

  it('coerces a non-string prompt text to a string', () => {
    const parsed = parseDaemonRequest(JSON.stringify({ type: 'prompt', text: 123 }));
    expect(parsed).toEqual({ type: 'prompt', text: '123' });
  });

  it('coerces a stringified seq / uptime to a number', () => {
    expect(parseDaemonResponse(JSON.stringify({ type: 'ack', seq: '5' }))).toEqual({ type: 'ack', seq: 5 });
    const pong = parseDaemonResponse(JSON.stringify({ type: 'pong', sessionId: 's', uptime: '88' }));
    expect(pong).toEqual({ type: 'pong', sessionId: 's', uptime: 88 });
  });

  it('snaps a non-finite seq to 0 (never NaN on the wire)', () => {
    expect(parseDaemonResponse(JSON.stringify({ type: 'ack', seq: 'nope' }))).toEqual({ type: 'ack', seq: 0 });
  });
});

// ── splitFrames — stream framing ─────────────────────────────────────────────

describe('daemon-protocol — splitFrames', () => {
  it('returns complete lines and carries the unterminated tail forward', () => {
    const { lines, rest } = splitFrames('a\nb\nc');
    expect(lines).toEqual(['a', 'b']);
    expect(rest).toBe('c');
  });

  it('returns an empty rest when the buffer ends on a newline', () => {
    const { lines, rest } = splitFrames('a\nb\n');
    expect(lines).toEqual(['a', 'b']);
    expect(rest).toBe('');
  });

  it('returns no lines and the whole buffer as rest when there is no newline', () => {
    const { lines, rest } = splitFrames('partial frame');
    expect(lines).toEqual([]);
    expect(rest).toBe('partial frame');
  });

  it('reassembles a request split across two stream chunks', () => {
    // Simulate a socket delivering one encoded request in two arbitrary chunks.
    const wire = encodeDaemonRequest({ type: 'prompt', text: 'across the wire' });
    const cut = Math.floor(wire.length / 2);
    let buffer = '';
    const collected: (DaemonRequest | null)[] = [];
    for (const chunk of [wire.slice(0, cut), wire.slice(cut)]) {
      buffer += chunk;
      const { lines, rest } = splitFrames(buffer);
      buffer = rest;
      for (const line of lines) collected.push(parseDaemonRequest(line));
    }
    expect(collected).toEqual([{ type: 'prompt', text: 'across the wire' }]);
    expect(buffer).toBe(''); // fully consumed after the trailing newline
  });

  it('frames multiple messages arriving in a single chunk', () => {
    const wire =
      encodeDaemonRequest({ type: 'ping' }) +
      encodeDaemonRequest({ type: 'prompt', text: 'x' }) +
      encodeDaemonRequest({ type: 'shutdown' });
    const { lines, rest } = splitFrames(wire);
    expect(rest).toBe('');
    expect(lines.map((l) => parseDaemonRequest(l))).toEqual([
      { type: 'ping' },
      { type: 'prompt', text: 'x' },
      { type: 'shutdown' },
    ]);
  });
});
