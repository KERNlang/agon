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
  onAsk: null as null | ((prompt: string) => { scraped?: string; writeAnswer?: () => void; throwError?: Error }),
}));

vi.mock('@kernlang/agon-engines/cli/claude.js', () => {
  class ClaudeCliSession {
    static async spawn(opts: any) { ptyState.spawnOpts = opts; return new ClaudeCliSession(); }
    async *askStream(prompt: string, timeoutMs?: number): AsyncGenerator<string, string, void> {
      ptyState.prompts.push(prompt);
      ptyState.timeouts.push(timeoutMs);
      const r = ptyState.onAsk ? ptyState.onAsk(prompt) : { scraped: '' };
      if (r.throwError) throw r.throwError;
      if (r.writeAnswer) r.writeAnswer();
      // Real claude yields noisy TUI redraws; session-pty does not surface them.
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
});
