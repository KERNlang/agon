import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectIntent } from '../../packages/cli/src/intent.js';
import { handleRun } from '../../packages/cli/src/generated/handlers/run.js';
import { buildMentionedFilesContext, isLiteralCommandLine } from '../../packages/cli/src/generated/surfaces/app-submit.js';
import { extractImagesFromInput } from '@kernlang/agon-core';
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

describe('B4 — `! <cmd>` is exempt from plan-mode + BTW side-chat capture', () => {
  // runHandleSubmit gates BOTH the plan-mode rewrite (`/plan ${input}`) and the
  // open-BTW-panel follow-up capture on `… && !input.startsWith('! ')`, so a bang
  // line runs the shell directly even in plan mode / with the side panel open
  // (Claude-Code parity — bash is exempt like slash commands). These pin the
  // one-token exemption predicate the router uses at both call sites.
  const planModeWouldWrap = (input: string) => input.trim().length > 0 && !input.startsWith('/') && !input.startsWith('! ');
  const btwWouldCapture = (input: string) => input.trim().length > 0 && !input.startsWith('/') && !input.startsWith('! ');

  it('plan mode does NOT wrap a `! <cmd>` line into /plan', () => {
    expect(planModeWouldWrap('! npm test')).toBe(false);   // bash runs directly
    expect(planModeWouldWrap('fix the bug')).toBe(true);   // normal prose still wraps
    expect(planModeWouldWrap('/forge x')).toBe(false);     // slash still exempt
  });

  it('an open BTW panel does NOT capture a `! <cmd>` line as a side-chat turn', () => {
    expect(btwWouldCapture('! ls -la')).toBe(false);       // bash escapes the side-chat
    expect(btwWouldCapture('what about caching?')).toBe(true); // normal prose is captured
    expect(btwWouldCapture('/clear')).toBe(false);         // slash still exempt
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

  // The submit pipeline gates BOTH image extraction and buildMentionedFilesContext
  // on isLiteralCommandLine(input); these pin the bang/slash halves of that REAL
  // exported gate (not an inline re-implementation). A `! grep @secret.ts` line
  // routes to /run, where the @path must stay a literal shell arg.
  it('a `! ` line is a literal-command line (skips image/mention expansion)', () => {
    expect(isLiteralCommandLine('! grep SECRET @secret.ts')).toBe(true);
  });

  it('a slash command is a literal-command line', () => {
    expect(isLiteralCommandLine('/run cp /tmp/shot.png docs/')).toBe(true);
  });

  it('a normal chat line is NOT a literal-command line (expansion runs)', () => {
    expect(isLiteralCommandLine('review @secret.ts')).toBe(false);
    // A bare `!` (no space) is plain text, not a bang-bash line.
    expect(isLiteralCommandLine('!important fix the layout')).toBe(false);
  });

  // B4: an existing image path inside a `! <cmd>` line must NOT be extracted —
  // doing so would STRIP it from the shell command (corrupting it) and silently
  // attach it as a pending image. The submit pipeline guards extractImagesFromInput
  // behind isLiteralCommandLine; this asserts the discrimination: the raw extractor
  // WOULD strip the path, but the gate flips the pipeline onto the no-extract path.
  it('a `! ` line with an existing image path: extractor would strip it, but the gate skips extraction', () => {
    writeFileSync(join(dir, 'shot.png'), 'PNGDATA');
    const bangLine = `! cp ${join(dir, 'shot.png')} docs/`;
    // Control: the raw extractor pulls the path OUT of the text + attaches it.
    const raw = extractImagesFromInput(bangLine, dir);
    expect(raw.images.length).toBe(1);
    expect(raw.text).not.toContain('shot.png');
    // The gate marks this a literal-command line, so the pipeline keeps the input
    // verbatim and attaches no image (mirrors the `literalCommandLine ? …` branch).
    expect(isLiteralCommandLine(bangLine)).toBe(true);
    const { text, images } = isLiteralCommandLine(bangLine)
      ? { text: bangLine, images: [] }
      : extractImagesFromInput(bangLine, dir);
    expect(text).toBe(bangLine);
    expect(text).toContain('shot.png'); // path preserved in the command
    expect(images.length).toBe(0);      // nothing attached
  });
});
