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
  closed: false,
  // per-turn behavior installed by each test
  onAsk: null as null | ((prompt: string) => { scraped?: string; writeAnswer?: () => void }),
}));

vi.mock('@kernlang/agon-engines/cli/claude.js', () => {
  class ClaudeCliSession {
    static async spawn(opts: any) { ptyState.spawnOpts = opts; return new ClaudeCliSession(); }
    async *askStream(prompt: string): AsyncGenerator<string, string, void> {
      ptyState.prompts.push(prompt);
      const r = ptyState.onAsk ? ptyState.onAsk(prompt) : { scraped: '' };
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
    ptyState.onAsk = () => ({ scraped: 'FRESH SCRAPED' });
    const out = await collect(session.send({ message: 'hi' }) as any);
    // Must NOT return STALE; falls back to the fresh scraped extract.
    expect((out.text ?? []).join('')).toBe('FRESH SCRAPED');
    expect((out.text ?? []).join('')).not.toContain('STALE');
  });

  it('falls back to the scraped extract when DeliverAnswer was not called', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    ptyState.onAsk = () => ({ scraped: 'SCRAPED ONLY' });
    const out = await collect(session.send({ message: 'hi' }) as any);
    expect((out.text ?? []).join('')).toBe('SCRAPED ONLY');
  });

  it('prepends the system prompt on the first turn only', async () => {
    const { createPtySession } = await import('../../packages/core/src/generated/sessions/session-pty.js');
    const session = createPtySession(claudeConfig({ answerChannelPath: join(tmp, 'cesar-1-answer.json') }) as any);
    await session.start();
    ptyState.onAsk = () => ({ scraped: 'ok' });
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
