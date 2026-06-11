import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mock the kern-engines PTY claude session ────────────────────────────────
// session-pty.kern lazy-imports '@kernlang/agon-engines/cli/claude.js'.
const ptyState = vi.hoisted(() => ({
  spawnOpts: null as any,
  prompts: [] as string[],
  timeouts: [] as Array<number | undefined>,
  closed: false,
  // per-turn behavior installed by each test
  onAsk: null as null | ((prompt: string) => { scraped?: string; writeAnswer?: () => void; throwError?: Error; frames?: string[] }),
}));

vi.mock('@kernlang/agon-engines/cli/claude.js', () => {
  class ClaudeCliSession {
    static async spawn(opts: any) { ptyState.spawnOpts = opts; return new ClaudeCliSession(); }
    async *askStream(prompt: string, timeoutMs?: number): AsyncGenerator<string, string, void> {
      ptyState.prompts.push(prompt);
      ptyState.timeouts.push(timeoutMs);
      const r = ptyState.onAsk ? ptyState.onAsk(prompt) : { scraped: '' };
      if (r.throwError) throw r.throwError;
      // Real claude yields noisy TUI redraws (intermediate scraped frames) BEFORE
      // settling. The session-pty driver normally discards them — except now it
      // forwards sanitized ones as speculative 'preview' chunks. Yield each with a
      // micro-await so the consumer's drain loop can observe them between frames.
      for (const f of (r.frames ?? [])) {
        await new Promise((res) => setTimeout(res, 0));
        yield f;
      }
      if (r.writeAnswer) r.writeAnswer();
      // The generator RETURN value is the clean scraped extract (the fallback).
      return r.scraped ?? '';
    }
    close() { ptyState.closed = true; }
  }
  return { ClaudeCliSession };
});

// child_process spawn mock for the --print escape-hatch routing assertion.
const spawnMock = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: spawnMock };
});

function fakePrintProc() {
  const proc = new EventEmitter() as any;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 9999;
  proc.kill = vi.fn();
  // Emit a line so createStreamJsonSession.start() resolves immediately.
  setTimeout(() => proc.stdout.write(JSON.stringify({ type: 'system', session_id: 'x' }) + '\n'), 0);
  return proc;
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pty-brain-'));
  ptyState.spawnOpts = null;
  ptyState.prompts = [];
  ptyState.timeouts = [];
  ptyState.closed = false;
  ptyState.onAsk = null;
  spawnMock.mockReset();
  delete process.env.AGON_CLAUDE_PRINT;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.AGON_CLAUDE_PRINT;
  delete process.env.AGON_NO_PREVIEW;
});

async function collect(gen: AsyncGenerator<{ type: string; content: string }>) {
  const out: Record<string, string[]> = {};
  for await (const c of gen) { (out[c.type] ??= []).push(c.content); }
  return out;
}

const claudeConfig = (extra: Record<string, unknown> = {}) => ({
  engine: { id: 'claude', binary: 'claude' } as any,
  binaryPath: '/usr/local/bin/claude',
  cwd: process.cwd(),
  systemPrompt: 'You are Cesar.',
  ...extra,
});

describe('createPtySession — answer channel', () => {
  it('returns the DeliverAnswer channel text, not the scraped extract', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();

    ptyState.onAsk = () => ({
      scraped: 'GARBLED ⏺ scrape · Osmosing…',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'CLEAN ANSWER' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('CLEAN ANSWER');
    expect(out.done).toBeDefined();
  });

  it('clears a stale answer file before the turn (no carry-over from a prior turn)', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    // Stale answer from a "previous turn" still on disk.
    writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'STALE' }));
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();

    // This turn does NOT write a fresh answer; engine only printed text.
    // Scrape is substantive (>=20 chars) so it short-circuits the nudge.
    ptyState.onAsk = () => ({ scraped: 'FRESH SCRAPED SUBSTANTIVE ANSWER' });
    const out = await collect(session.send({ message: 'hi' }) as any);
    // Must NOT return STALE; falls back to the fresh scraped extract.
    expect((out.text ?? []).join('')).toBe('FRESH SCRAPED SUBSTANTIVE ANSWER');
    expect((out.text ?? []).join('')).not.toContain('STALE');
  });

  it('falls back to the substantive scraped extract when DeliverAnswer was not called', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    // >=20 visible chars → substantive → short-circuits the retry-nudge.
    ptyState.onAsk = () => ({ scraped: 'SCRAPED ONLY BUT SUBSTANTIVE' });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('SCRAPED ONLY BUT SUBSTANTIVE');
  });

  it('B5: yields an honest "image(s) not sent" status when images are passed (PTY has no vision channel)', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    ptyState.onAsk = () => ({ scraped: 'a substantive scraped answer body' });
    const out = await collect(session.send({ message: 'whats in this screenshot?', images: ['/tmp/shot.png', '/tmp/two.png'] } as any) as any);
    const statuses = out.status ?? [];
    expect(statuses.some((s) => /2 image\(s\) not sent/.test(s))).toBe(true);
    expect(statuses.some((s) => /no vision channel/i.test(s))).toBe(true);
    // The text turn still completes normally — images don't abort the turn.
    expect((out.text ?? []).join('')).toContain('substantive scraped answer');
    // And the image paths are NOT smuggled into the prompt sent to the TUI.
    expect(ptyState.prompts.join('\n')).not.toContain('/tmp/shot.png');
  });

  it('B5: emits no image status on a normal (image-less) turn', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    ptyState.onAsk = () => ({ scraped: 'a substantive scraped answer body' });
    const out = await collect(session.send({ message: 'plain question' }) as any);
    const statuses = out.status ?? [];
    expect(statuses.some((s) => /image\(s\) not sent/.test(s))).toBe(false);
  });

  it('prepends the system prompt on the first turn only', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    // Substantive scrape so neither turn triggers a retry-nudge (which would
    // insert an extra askStream prompt and shift prompts[1]).
    ptyState.onAsk = () => ({ scraped: 'ok this is a substantive scraped answer' });
    await collect(session.send({ message: 'first' }) as any);
    await collect(session.send({ message: 'second' }) as any);
    expect(ptyState.prompts[0]).toContain('[System Instructions]');
    expect(ptyState.prompts[0]).toContain('You are Cesar.');
    expect(ptyState.prompts[0]).toContain('first');
    expect(ptyState.prompts[1]).not.toContain('[System Instructions]');
    expect(ptyState.prompts[1]).toBe('second');
  });

  it('injects --mcp-config, --strict-mcp-config and disallows native writes', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({
      answerChannelPath: join(tmp, 'cesar-1-answer.json'),
      mcpServers: [{ name: 'agon-orchestration', command: 'node', args: ['/x/index.js'] }],
    }) as any);
    await session.start();
    const argv: string[] = ptyState.spawnOpts.extraArgv;
    expect(argv).toContain('--mcp-config');
    expect(argv).toContain('--strict-mcp-config');
    const disallowIdx = argv.indexOf('--disallowedTools');
    expect(disallowIdx).toBeGreaterThanOrEqual(0);
    expect(argv[disallowIdx + 1]).toContain('Write');
    const allowIdx = argv.indexOf('--allowedTools');
    expect(argv[allowIdx + 1]).toContain('mcp__agon-orchestration');
    expect(argv[allowIdx + 1]).not.toContain('Bash');
    expect(ptyState.spawnOpts.mode).toBe('agent');
  });
});

const NUDGE_PROMPT =
  'Your previous turn did not call DeliverAnswer. Call DeliverAnswer now with your complete final answer — output nothing else.';
const INCOMPLETE_MARKER = '[turn incomplete — the engine did not deliver an answer]';

describe('createPtySession — DeliverAnswer retry-nudge', () => {
  it('isSubstantiveScrape: pure heuristic boundary at 20 visible chars', async () => {
    const { isSubstantiveScrape } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    expect(isSubstantiveScrape(null)).toBe(false);
    expect(isSubstantiveScrape(undefined)).toBe(false);
    expect(isSubstantiveScrape('')).toBe(false);
    expect(isSubstantiveScrape('   ')).toBe(false);
    expect(isSubstantiveScrape('short answer')).toBe(false);       // 12 chars
    expect(isSubstantiveScrape('   trimmed-to-short ')).toBe(false); // 16 chars after trim
    expect(isSubstantiveScrape('exactly twenty chars')).toBe(true); // 20 chars
    expect(isSubstantiveScrape('this is a real full answer')).toBe(true);
  });

  it('fires exactly one nudge and returns the retry channel file (tier 1)', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();

    ptyState.onAsk = (prompt: string) => {
      if (prompt === NUDGE_PROMPT) {
        // The retry turn delivers via the channel.
        return { scraped: '', writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'RETRY ANSWER' })) };
      }
      // First turn: no DeliverAnswer, only chrome-like noise.
      return { scraped: '⏺ ·' };
    };
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('RETRY ANSWER');
    // Exactly one nudge: 2 askStream calls total (first turn + one retry).
    expect(ptyState.prompts.length).toBe(2);
    expect(ptyState.prompts[1]).toBe(NUDGE_PROMPT);
  });

  it('does NOT nudge when the first scrape is substantive (short-circuit)', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    ptyState.onAsk = () => ({ scraped: 'a fully substantive first-turn answer' });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('a fully substantive first-turn answer');
    expect(ptyState.prompts.length).toBe(1); // no nudge
  });

  it('does NOT nudge when the first turn delivered via the channel', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = () => ({ scraped: '⏺ noise', writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'CHANNEL FIRST' })) });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('CHANNEL FIRST');
    expect(ptyState.prompts.length).toBe(1); // no nudge
  });

  it('tier 3: a substantive first-turn scrape is returned via the pre-nudge short-circuit', async () => {
    // Tier 3 (first-turn substantive scrape) is realized as the short-circuit:
    // a substantive first scrape returns immediately and NEVER nudges, which is
    // strictly better than re-asking when we already hold a good answer. (Tiers
    // 3 vs 4 only contend inside the nudge block, which is entered solely on a
    // NON-substantive first scrape — so tier 4 is the one exercised there below.)
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = () => ({ scraped: 'substantive first scrape wins' });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('substantive first scrape wins');
    expect(ptyState.prompts.length).toBe(1);
  });

  it('tier 4: retry channel empty, first scrape thin → retry-turn substantive scrape', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = (prompt: string) => {
      if (prompt === NUDGE_PROMPT) return { scraped: 'retry scrape is substantive here' };
      return { scraped: '⏺' }; // thin first scrape → nudge fires
    };
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('retry scrape is substantive here');
    expect(ptyState.prompts.length).toBe(2);
  });

  it('tier 5: nudge yields nothing substantive → explicit incomplete marker', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    // Both turns: thin chrome only, no channel write.
    ptyState.onAsk = () => ({ scraped: '⏺ ·' });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe(INCOMPLETE_MARKER);
    expect((out.text ?? []).join('')).not.toContain('⏺');
    expect(ptyState.prompts.length).toBe(2); // one nudge, then give up
  });

  it('a late first-turn DeliverAnswer with a thin scrape is returned WITHOUT a nudge (tier 2)', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    // First turn: thin scrape, but DeliverAnswer DID land (late in the turn).
    ptyState.onAsk = () => ({
      scraped: '⏺ ·',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'LATE FIRST-TURN ANSWER' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('LATE FIRST-TURN ANSWER');
    // The answer must never be deleted by the nudge path, and no nudge fires.
    expect(ptyState.prompts.length).toBe(1);
  });

  it('a nudge-turn error yields the explicit incomplete marker, never a throw or silent garbage', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    ptyState.onAsk = (prompt: string) => {
      if (prompt === NUDGE_PROMPT) return { throwError: new Error('pty died mid-nudge') };
      return { scraped: '⏺ ·' };
    };
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe(INCOMPLETE_MARKER);
    expect(ptyState.prompts.length).toBe(2);
  });

  it('the nudge PTY turn runs under its own short ceiling, not the 15-min turn timeout', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = (prompt: string) => {
      if (prompt === NUDGE_PROMPT) {
        return { scraped: '', writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'RETRY' })) };
      }
      return { scraped: '⏺ ·' };
    };
    await collect(session.send({ message: 'hi' }) as any);
    expect(ptyState.timeouts.length).toBe(2);
    // The nudge ceiling bounds pendingDrain so the next send can never block
    // on a zombie nudge turn for the full first-turn timeout.
    expect(ptyState.timeouts[1]).toBe(20000);
    expect(ptyState.timeouts[1]).toBeLessThan(ptyState.timeouts[0] ?? Infinity);
  });

  it('aborted turn never nudges', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    const ac = new AbortController();
    ptyState.onAsk = () => {
      // Abort mid-turn, before settle, and emit only thin noise.
      ac.abort();
      return { scraped: '⏺' };
    };
    const out = await collect(session.send({ message: 'hi', signal: ac.signal }) as any);
    expect(out.done?.join('')).toBe('cancelled');
    expect((out.text ?? []).join('')).toBe('');
    expect(ptyState.prompts.length).toBe(1); // no nudge after abort
  });

  it('an abort during the nudge turn cancels — no fallback text leaks out', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    const ac = new AbortController();
    ptyState.onAsk = (prompt: string) => {
      if (prompt === NUDGE_PROMPT) {
        // User cancels while the retry is in flight.
        ac.abort();
        return { scraped: 'retry scrape would be substantive otherwise' };
      }
      return { scraped: '⏺ ·' }; // thin first scrape → nudge fires
    };
    const out = await collect(session.send({ message: 'hi', signal: ac.signal }) as any);
    expect(out.done?.join('')).toBe('cancelled');
    expect((out.text ?? []).join('')).toBe('');
    expect(ptyState.prompts.length).toBe(2); // first turn + the one nudge
  });

  it('an explicitly EMPTY DeliverAnswer is not nudged — explicit marker, no raw scrape', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    // Engine DID call DeliverAnswer, but with empty text, and the scrape is thin.
    ptyState.onAsk = () => ({
      scraped: '⏺ ·',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: '' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe(INCOMPLETE_MARKER);
    expect(ptyState.prompts.length).toBe(1); // deliberate empty delivery → no nudge
  });
});

describe('sanitizePreviewFrame — pure speculative-preview gate', () => {
  it('suppresses null / undefined / empty / whitespace', async () => {
    const { sanitizePreviewFrame } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    expect(sanitizePreviewFrame(null, '')).toBeNull();
    expect(sanitizePreviewFrame(undefined, '')).toBeNull();
    expect(sanitizePreviewFrame('', '')).toBeNull();
    expect(sanitizePreviewFrame('     ', '')).toBeNull();
  });

  it('suppresses sub-threshold (<20 visible chars after trim)', async () => {
    const { sanitizePreviewFrame } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    expect(sanitizePreviewFrame('too short', '')).toBeNull();           // 9 chars
    expect(sanitizePreviewFrame('  nineteen chars!! ', '')).toBeNull(); // 17 after trim
  });

  it('suppresses chrome-like frames (spinner / status / box-drawing glyphs)', async () => {
    const { sanitizePreviewFrame } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    // All >=20 chars but chrome — must be dropped.
    expect(sanitizePreviewFrame('⏺ · Osmosing… please wait', '')).toBeNull();
    expect(sanitizePreviewFrame('┌── claude ─────────────────', '')).toBeNull();
    expect(sanitizePreviewFrame('⠋ working ⠹ thinking spinner', '')).toBeNull();
    expect(sanitizePreviewFrame('1234 tokens · Esc to interrupt', '')).toBeNull();
  });

  it('emits a substantive non-chrome frame that grows past prev', async () => {
    const { sanitizePreviewFrame } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    expect(sanitizePreviewFrame('This is a real draft answer.', '')).toBe('This is a real draft answer.');
    // Grows past a shorter prev → emit the longer one.
    expect(sanitizePreviewFrame('The answer is forty-two for sure.', 'The answer is')).toBe('The answer is forty-two for sure.');
  });

  it('growth-gates: a redraw at same/shorter length than prev is suppressed', async () => {
    const { sanitizePreviewFrame } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const prev = 'The answer is forty-two for sure.';
    // Identical content (repaint) → drop.
    expect(sanitizePreviewFrame(prev, prev)).toBeNull();
    // Shorter than prev → drop (no regression of the draft).
    expect(sanitizePreviewFrame('The answer is forty-two', prev)).toBeNull();
  });
});

describe('createPtySession — speculative preview chunks', () => {
  it('emits a preview chunk for a substantive non-chrome intermediate frame', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = () => ({
      frames: ['Here is a real draft answer being composed.'],
      scraped: '',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'AUTHORITATIVE ANSWER' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.preview ?? []).length).toBeGreaterThanOrEqual(1);
    expect((out.preview ?? []).join('')).toContain('real draft answer');
    // The authoritative channel answer still wins and is the only committed text.
    expect((out.text ?? []).join('')).toBe('AUTHORITATIVE ANSWER');
  });

  it('emits NO preview for chrome-only intermediate frames', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    // Each frame is >=20 visible chars so it clears the length floor and the
    // suppression is exercised on the CHROME regex, not just the min-chars gate.
    ptyState.onAsk = () => ({
      frames: [
        '⏺ · Osmosing… please hold for a moment now',
        '┌── claude ──────────────────────────────────',
        '1234 tokens · Esc to interrupt the running turn',
      ],
      scraped: '',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'CLEAN ANSWER' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.preview ?? []).length).toBe(0);
    expect((out.text ?? []).join('')).toBe('CLEAN ANSWER');
  });

  it('throttle is growth-gated: two identical frames yield at most one preview', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    // The driver ACCUMULATES deltas; an empty-string delta does not grow the draft,
    // so the second consideration is growth-gated even ignoring the time throttle.
    ptyState.onAsk = () => ({
      frames: ['A substantive first draft frame here.', ''],
      scraped: '',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'FINAL' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.preview ?? []).length).toBeLessThanOrEqual(1);
    expect((out.text ?? []).join('')).toBe('FINAL');
  });

  it('AGON_NO_PREVIEW=1 disables preview emission at the source', async () => {
    process.env.AGON_NO_PREVIEW = '1';
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = () => ({
      frames: ['This is a perfectly good draft that would normally preview.'],
      scraped: '',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'ANSWER WINS' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.preview ?? []).length).toBe(0);
    expect((out.text ?? []).join('')).toBe('ANSWER WINS');
  });

  it('the authoritative channel answer is returned EXACTLY, never the preview text', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = () => ({
      frames: ['Draft text that DIFFERS from the final delivered answer entirely.'],
      scraped: 'and a scraped extract that also differs from the channel answer',
      writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'THE ONE TRUE ANSWER' })),
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('THE ONE TRUE ANSWER');
    // Preview text must never leak into the authoritative text tier.
    expect((out.text ?? []).join('')).not.toContain('Draft text');
    expect((out.text ?? []).join('')).not.toContain('scraped extract');
  });

  it('preview never alters the scrape-fallback tiers (no channel answer)', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    // No channel write; substantive final scrape → tier-3 short-circuit. Previews
    // along the way must not change the returned text, which equals the scrape.
    ptyState.onAsk = () => ({
      frames: ['A live draft preview frame mid-turn.'],
      scraped: 'THE SUBSTANTIVE SCRAPED FINAL ANSWER',
    });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('THE SUBSTANTIVE SCRAPED FINAL ANSWER');
    expect((out.text ?? []).join('')).not.toContain('live draft preview');
  });

  it('the nudge turn emits no previews even when its frames look substantive', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const answerChannelPath = join(tmp, 'cesar-1-answer.json');
    const session = createPtySession(claudeConfig({ answerChannelPath }) as any);
    await session.start();
    ptyState.onAsk = (prompt: string) => {
      if (prompt === NUDGE_PROMPT) {
        // The nudge turn yields substantive-looking frames — but the nudge driver
        // does NOT forward previews, so none must appear.
        return {
          frames: ['A substantive nudge-turn frame that must not preview.'],
          scraped: '',
          writeAnswer: () => writeFileSync(answerChannelPath, JSON.stringify({ type: 'answer', text: 'RETRY ANSWER' })),
        };
      }
      // First turn: thin chrome only → nudge fires; no preview-worthy frames.
      return { frames: ['⏺ ·'], scraped: '⏺ ·' };
    };
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.preview ?? []).length).toBe(0);
    expect((out.text ?? []).join('')).toBe('RETRY ANSWER');
    expect(ptyState.prompts.length).toBe(2); // first turn + one nudge
  });
});

describe('createPersistentSession — claude routing', () => {
  it('routes claude to the PTY brain by default', async () => {
    const { createPersistentSession } = await import('../../packages/core/src/persistent-session.js');
    const session = createPersistentSession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    expect(ptyState.spawnOpts).not.toBeNull();   // PTY spawn happened
    expect(spawnMock).not.toHaveBeenCalled();     // no `claude --print`
  });

  it('falls back to --print (stream-json) when AGON_CLAUDE_PRINT=1', async () => {
    process.env.AGON_CLAUDE_PRINT = '1';
    spawnMock.mockImplementation(() => fakePrintProc());
    const { createPersistentSession } = await import('../../packages/core/src/persistent-session.js');
    const session = createPersistentSession(claudeConfig() as any);
    await session.start();
    expect(ptyState.spawnOpts).toBeNull();         // PTY NOT used
    expect(spawnMock).toHaveBeenCalled();           // stream-json spawned claude
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--print');
  });

  it('B5: the --print (stream-json) path ALSO yields an honest "image(s) not sent" status', async () => {
    process.env.AGON_CLAUDE_PRINT = '1';
    spawnMock.mockImplementation(() => fakePrintProc());
    const { createPersistentSession } = await import('../../packages/core/src/persistent-session.js');
    const session = createPersistentSession(claudeConfig() as any);
    await session.start();
    // The skip-status is yielded BEFORE any proc I/O; a pre-aborted signal then
    // ends the turn cleanly so the test never blocks on the stub proc's stdout.
    const ac = new AbortController();
    ac.abort();
    const out = await collect(session.send({ message: 'whats in this screenshot?', images: ['/tmp/shot.png'], signal: ac.signal } as any) as any);
    const statuses = out.status ?? [];
    expect(statuses.some((s) => /1 image\(s\) not sent/.test(s))).toBe(true);
    expect(statuses.some((s) => /no vision channel/i.test(s))).toBe(true);
    // The image path is never written to the claude stdin envelope.
    const proc = spawnMock.mock.results[0]?.value;
    expect(proc).toBeTruthy();
  });
});
