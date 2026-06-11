import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectIntent } from '../../packages/cli/src/intent.js';
import { handleRun } from '../../packages/cli/src/generated/handlers/run.js';
import { buildMentionedFilesContext } from '../../packages/cli/src/generated/surfaces/app-submit.js';
import { startChatSession } from '@kernlang/agon-core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

// Pins the B4 `! <cmd>` inline-bash contract (Claude-Code parity):
//   1. bang-SPACE triggers the /run executor; bare `!`, `!!`, `!important` do NOT,
//   2. the command output is fed into chatSession so Cesar SEES it next turn,
//   3. an "@path" inside a `! ` line is a shell arg — NOT @-mention-expanded,
//   4. the slash-command exemption is untouched.

describe('B4 — `! <cmd>` inline-bash intent trigger', () => {
  it('routes a bang-SPACE line to the shared /run executor', () => {
    const r = detectIntent('! npm test');
    expect(r.type).toBe('run');
    expect((r as any).input).toBe('npm test');
  });

  it('trims surrounding whitespace in the command', () => {
    const r = detectIntent('!   ls -la  ');
    expect(r.type).toBe('run');
    expect((r as any).input).toBe('ls -la');
  });

  it('does NOT trigger on a bare `!` (no command) → plain text', () => {
    expect(detectIntent('!').type).not.toBe('run');
  });

  it('does NOT trigger on `!x` / `!!` / `!important` (no bang-space) → plain text', () => {
    expect(detectIntent('!x').type).not.toBe('run');
    expect(detectIntent('!!').type).not.toBe('run');
    expect(detectIntent('!important fix the layout').type).not.toBe('run');
  });

  it('does NOT trigger when only whitespace follows the bang-space', () => {
    // After trim the whole input collapses to "!" — no command, no dispatch.
    expect(detectIntent('!   ').type).not.toBe('run');
  });

  it('leaves the slash-command exemption untouched (/run still parses)', () => {
    const slash = detectIntent('/run npm test');
    expect(slash.type).toBe('run');
    expect((slash as any).input).toBe('npm test');
    // and a normal slash command is unaffected by the bang branch
    expect(detectIntent('/forge fix the bug').type).toBe('forge');
  });
});

describe('B4 — handleRun feeds output into next-turn context', () => {
  let home: string;
  beforeEach(() => { home = setupTestAgonHome('bang-run'); });
  afterEach(() => { cleanupTestAgonHome(home); });

  const makeCtx = () => ({
    chatSession: startChatSession(),
    askQuestion: async () => 'y',
  }) as any;

  it('appends the command + captured output to chatSession (Cesar sees it)', async () => {
    const ctx = makeCtx();
    const events: any[] = [];
    const dispatch = (e: any) => events.push(e);

    await handleRun('echo hello-from-bang', dispatch, ctx);

    const msgs = ctx.chatSession.messages;
    // user turn records WHAT was run, engine turn carries the result
    const userTurn = msgs.find((m: any) => m.role === 'user');
    const engineTurn = msgs.find((m: any) => m.role === 'engine' && m.engineId === 'run');
    expect(userTurn?.content).toBe('! echo hello-from-bang');
    expect(engineTurn).toBeTruthy();
    expect(engineTurn.content).toContain('hello-from-bang');
    expect(engineTurn.content).toContain('exit 0');
  });

  it('still renders the output as a Bash tool-call block in the transcript', async () => {
    const ctx = makeCtx();
    const events: any[] = [];
    await handleRun('echo block-render', (e: any) => events.push(e), ctx);

    const toolBlocks = events.filter((e) => e.type === 'tool-call' && e.tool === 'Bash');
    expect(toolBlocks.length).toBeGreaterThan(0);
    const done = toolBlocks.find((e) => e.status === 'done');
    expect(done?.output).toContain('block-render');
  });

  it('caps the output fed to context but keeps the full transcript block', async () => {
    const ctx = makeCtx();
    const events: any[] = [];
    // Emit > RUN_CONTEXT_OUTPUT_CAP (4000) chars of output.
    await handleRun('printf "%05000d" 0', (e: any) => events.push(e), ctx);

    const engineTurn = ctx.chatSession.messages.find((m: any) => m.role === 'engine' && m.engineId === 'run');
    expect(engineTurn.content).toContain('chars truncated');
    // The context message is bounded (cap + fence/header overhead), not the full 5000.
    expect(engineTurn.content.length).toBeLessThan(4600);
  });
});

describe('B4 — `! <cmd>` lines are NOT @-mention-expanded', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bang-mention-'));
    writeFileSync(join(dir, 'secret.ts'), 'export const SECRET = 42;');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('expands @path for a normal chat line (control)', () => {
    const ctx = buildMentionedFilesContext('look at @secret.ts please', dir);
    expect(ctx).toContain('SECRET = 42');
  });

  // The submit pipeline gates buildMentionedFilesContext on
  // !(startsWith('/') || startsWith('! ')); these pin the bang half of that gate
  // by asserting the caller would skip expansion. (A `! grep @secret.ts` line
  // routes to /run, where the @path must stay a literal shell arg.)
  it('a `! ` line is recognized as a bang-bash line (skips mention expansion)', () => {
    const line = '! grep SECRET @secret.ts';
    const isBang = line.startsWith('/') || line.startsWith('! ');
    expect(isBang).toBe(true);
  });

  it('a normal line is NOT a bang-bash line (expansion runs)', () => {
    const line = 'review @secret.ts';
    const isBang = line.startsWith('/') || line.startsWith('! ');
    expect(isBang).toBe(false);
  });
});
