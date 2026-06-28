import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listServeConnections,
  pickServeConnection,
  parseSseChunk,
  agentActivityLabel,
  approvalTargetsClient,
  renderDriveEvent,
} from '../../packages/cli/src/generated/commands/drive.js';

// ── Connection discovery ──────────────────────────────────────────────────────

function tmpServeDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-drive-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

describe('listServeConnections', () => {
  it('returns [] for a missing directory', () => {
    expect(listServeConnections(join(tmpdir(), 'does-not-exist-agon-xyz'))).toEqual([]);
  });

  it('reads well-formed connection files and skips partial/garbled ones', () => {
    const dir = tmpServeDir({
      'serve-1.json': { url: 'http://127.0.0.1:8787', token: 'tok1', sessionId: 'serve-1', engineId: 'claude', startedAt: '2026-06-23T10:00:00Z' },
      'serve-2.json': { url: 'http://127.0.0.1:9999', token: 'tok2', sessionId: 'serve-2', engineId: 'codex', startedAt: '2026-06-23T11:00:00Z' },
      'partial.json': { url: 'http://x', token: '' },              // missing token → skipped
      'noid.json': { url: 'http://x', token: 't' },                // missing sessionId → skipped
      'garbled.json': '{ not json',                                // unparseable → skipped
      'ignore.txt': 'not a json file',                             // not .json → ignored
    });
    const conns = listServeConnections(dir);
    expect(conns.map((c) => c.sessionId).sort()).toEqual(['serve-1', 'serve-2']);
    const one = conns.find((c) => c.sessionId === 'serve-1')!;
    expect(one.url).toBe('http://127.0.0.1:8787');
    expect(one.token).toBe('tok1');
    expect(one.engineId).toBe('claude');
    expect(one.file.endsWith('serve-1.json')).toBe(true);
  });
});

describe('pickServeConnection', () => {
  const a = { url: 'u1', token: 't1', sessionId: 'serve-100', engineId: '', startedAt: '2026-06-23T10:00:00Z', file: 'a' };
  const b = { url: 'u2', token: 't2', sessionId: 'serve-200', engineId: '', startedAt: '2026-06-23T12:00:00Z', file: 'b' };

  it('errors (no throw) when nothing is running', () => {
    const r = pickServeConnection([], undefined);
    expect(r.conn).toBeUndefined();
    expect(r.error).toMatch(/no running .*agon serve/i);
  });

  it('returns the sole connection when only one is running', () => {
    expect(pickServeConnection([a], undefined).conn).toBe(a);
  });

  it('picks the most-recently-started when several run and no --session given', () => {
    expect(pickServeConnection([a, b], undefined).conn).toBe(b); // b started later
  });

  it('matches --session by exact id', () => {
    expect(pickServeConnection([a, b], 'serve-100').conn).toBe(a);
  });

  it('matches --session by unique substring', () => {
    expect(pickServeConnection([a, b], '200').conn).toBe(b);
  });

  it('errors on an ambiguous --session substring', () => {
    const r = pickServeConnection([a, b], 'serve-');
    expect(r.conn).toBeUndefined();
    expect(r.error).toMatch(/ambiguous/i);
  });

  it('errors on a --session that matches nothing', () => {
    const r = pickServeConnection([a, b], 'nope');
    expect(r.error).toMatch(/no serve session matches/i);
  });
});

// ── SSE frame parsing ──────────────────────────────────────────────────────────

describe('parseSseChunk', () => {
  it('extracts a complete data frame and leaves no remainder', () => {
    const { frames, rest } = parseSseChunk('data: {"seq":1,"event":{"kind":"text","content":"hi"}}\n\n');
    expect(frames).toHaveLength(1);
    expect((frames[0] as { seq: number }).seq).toBe(1);
    expect(rest).toBe('');
  });

  it('carries an unterminated frame forward as the remainder', () => {
    const { frames, rest } = parseSseChunk('data: {"seq":1,"event":{}}\n\ndata: {"seq":2');
    expect(frames).toHaveLength(1);
    expect(rest).toBe('data: {"seq":2');
  });

  it('reassembles across two reads', () => {
    const first = parseSseChunk('data: {"seq":1,"ev');
    expect(first.frames).toHaveLength(0);
    const second = parseSseChunk(first.rest + 'ent":{}}\n\n');
    expect(second.frames).toHaveLength(1);
    expect((second.frames[0] as { seq: number }).seq).toBe(1);
  });

  it('skips `:` comment pings and drops garbled blocks', () => {
    const { frames } = parseSseChunk(': ping\n\ndata: not-json\n\ndata: {"seq":3}\n\n');
    expect(frames).toHaveLength(1);
    expect((frames[0] as { seq: number }).seq).toBe(3);
  });

  it('parses a CRLF-delimited frame (normalized to LF)', () => {
    const { frames, rest } = parseSseChunk('data: {"seq":5}\r\n\r\n');
    expect(frames).toHaveLength(1);
    expect((frames[0] as { seq: number }).seq).toBe(5);
    expect(rest).toBe('');
  });
});

// ── Activity labels + approval routing ──────────────────────────────────────────

describe('agentActivityLabel', () => {
  it('maps known page tools to readable labels', () => {
    expect(agentActivityLabel('readPage')).toBe('reading the page');
    expect(agentActivityLabel('navigate')).toBe('navigating');
    expect(agentActivityLabel('click')).toBe('clicking');
  });
  it('falls back for an unknown tool', () => {
    expect(agentActivityLabel('frobnicate')).toBe('running frobnicate');
    expect(agentActivityLabel('')).toBe('running a tool');
  });
});

describe('approvalTargetsClient', () => {
  it('is false for non-approval events', () => {
    expect(approvalTargetsClient({ kind: 'tool' }, 'me')).toBe(false);
  });
  it('is true when targetClientId equals my id', () => {
    expect(approvalTargetsClient({ kind: 'approval-request', targetClientId: 'me' }, 'me')).toBe(true);
  });
  it('is false when targetClientId names another client', () => {
    expect(approvalTargetsClient({ kind: 'approval-request', targetClientId: 'other' }, 'me')).toBe(false);
  });
  it('is true (legacy broadcast) when targetClientId is absent', () => {
    expect(approvalTargetsClient({ kind: 'approval-request' }, 'me')).toBe(true);
  });
});

// ── Event rendering ─────────────────────────────────────────────────────────────

describe('renderDriveEvent', () => {
  const strip = (s: string | null): string | null => (s == null ? null : s.replace(/\x1b\[[0-9;]*m/g, ''));

  it('renders an engine answer with the engine id', () => {
    expect(strip(renderDriveEvent({ kind: 'engine', engineId: 'claude', content: 'the hero is fine' })))
      .toBe('◆ claude the hero is fine');
  });

  it('renders plain text, skipping empties', () => {
    expect(strip(renderDriveEvent({ kind: 'text', content: 'hello' }))).toBe('hello');
    expect(renderDriveEvent({ kind: 'text', content: '   ' })).toBeNull();
  });

  it('shows a capability-request as browser activity', () => {
    expect(strip(renderDriveEvent({ kind: 'capability-request', capability: 'navigate' })))
      .toBe('  ↪ browser: navigating…');
  });

  it('renders tool running / done / error distinctly', () => {
    expect(strip(renderDriveEvent({ kind: 'tool', tool: 'navigate', status: 'running', input: 'to x.com' }))).toBe('  ⚒ navigate to x.com');
    expect(strip(renderDriveEvent({ kind: 'tool', tool: 'readPage', status: 'done' }))).toBe('  ⚒ readPage ✓');
    expect(strip(renderDriveEvent({ kind: 'tool', tool: 'click', status: 'error', output: 'no match' }))).toBe('  ⚒ click — no match');
  });

  it('renders notice levels', () => {
    expect(strip(renderDriveEvent({ kind: 'notice', level: 'error', message: 'boom' }))).toBe('▲ boom');
    expect(strip(renderDriveEvent({ kind: 'notice', level: 'warning', message: 'careful' }))).toBe('▲ careful');
    expect(strip(renderDriveEvent({ kind: 'notice', level: 'info', message: 'fyi' }))).toBe('fyi');
  });

  it('skips approval-request (the prompt renders it) and unknown kinds', () => {
    expect(renderDriveEvent({ kind: 'approval-request', tool: 'click' })).toBeNull();
    expect(renderDriveEvent({ kind: 'confidence' })).toBeNull();
    expect(renderDriveEvent({ kind: 'provenance', clientId: 'x' })).toBeNull();
  });
});
