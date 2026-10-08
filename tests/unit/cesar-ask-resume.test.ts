// ── An [ASK]/fork/confirm pick must visibly resume ─────────────────────
//
// Field report (session chat-1787039227533, seq 8168-8195): the user picked an
// option, the overlay vanished, the follow-up ran tools silently for 28s and
// nothing appeared on screen — no echo of the choice, no streamed text. The
// user concluded Cesar had stopped.
//
// Wiring assertions cover the caller's three question paths. Display tests
// exercise the actual extracted helper, not a copy of its implementation.
//
//   A1  a real pick is ECHOED into the transcript before the follow-up starts.
//   A2  a real pick is NEVER dropped silently (dead session / interrupted turn),
//       and fork/confirm get the same never-lose fallback [ASK] already had.
//   A3  follow-up text STREAMS (streaming-chunk → streaming-end) and is rendered
//       exactly once — the marker capture still runs on every text sink.
//   A4  an intentional interrupt never prints "Engine … stopped responding".
//
// Two more, from the agon review of the live-streaming change:
//
//   A5  follow-up text that IS a tool call never streams raw and is never
//       committed — on NATIVE-tool sessions too, because the follow-up executor
//       re-parses with parseToolCalls whatever the session's tool mode is.
//   A6  the live follow-up entry is ended/cleared on EVERY exit (throw, abort),
//       not only when the send loop finishes normally.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { runCesarConfirmationFollowUp } from '../../packages/cli/src/cesar/confirmation-follow-up.js';
import { textHasToolCalls } from '../../packages/cli/src/cesar/brain-helpers.js';
import { createFollowUpDisplay } from '../../packages/cli/src/cesar/follow-up-display.js';

const here = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(resolve(here, '../../packages/cli/src/cesar/brain.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

// The end-of-turn pick block (ask / fork / confirm), sliced out of the machine.
const INTERACTIVE = CODE.slice(CODE.indexOf('const _echoChoice ='));

describe('A1 — a pick is echoed before the follow-up starts', () => {
  it('echoes the chosen label as a dim info line, before the spinner', () => {
    expect(CODE).toMatch(/const _echoChoice = \(label: string\) => \{[\s\S]{0,200}dispatch\(\{ type: 'info', message: `→ \$\{/);
    expect(CODE).toMatch(/const _runInteractiveChoice = async \(answer: string, message\?: string, echoLabel\?: string\) => \{\s*if \(echoLabel\) _echoChoice\(echoLabel\);\s*dispatch\(\{ type: 'spinner-start'/);
  });

  it('passes an echo label from all three pick sites (ask, fork, confirm)', () => {
    const calls = INTERACTIVE.match(/await _runInteractiveChoice\([\s\S]*?\);\n/g) ?? [];
    expect(calls).toHaveLength(3);
    // ask → the option label; fork → "A) label"; confirm → "Yes".
    expect(calls[0]).toContain(', chosen.label)');
    expect(calls[1]).toContain('`${chosen.key.toUpperCase()}) ${chosen.label}`)');
    expect(calls[2]).toContain("_runInteractiveChoice(answer, undefined, 'Yes')");
  });

  it('keeps the spinner explaining what it is doing', () => {
    expect(CODE).toContain("dispatch({ type: 'spinner-start', message: `${cesarEngineId} continuing…`, color })");
  });
});

describe('A2 — a real pick is never dropped', () => {
  it('surfaces the answer when the session died or the turn was interrupted', () => {
    // One call per branch (ask, fork, confirm) + the definition.
    expect(CODE).toContain('const _noteChoiceNotContinued = (label: string) => {');
    expect(CODE.match(/_noteChoiceNotContinued\(/g) ?? []).toHaveLength(3);
    expect(CODE.match(/if \(chosen && \(!session\.alive \|\| abort\.signal\.aborted\)\) \{/g) ?? []).toHaveLength(2);
    expect(CODE).toContain("if (_confirmAnswer === 'y' && (!session.alive || abort.signal.aborted))");
    // The fallback names the pick and says it still needs sending.
    expect(CODE).toMatch(/was not sent — the turn was interrupted/);
    expect(CODE).toMatch(/was not sent — the Cesar session ended/);
  });

  it('gives fork and confirm the never-lose fallback the ask branch has', () => {
    // ask (pre-existing) + fork + confirm = three "answer in the composer"-style
    // dismissal fallbacks in the interactive block.
    expect(INTERACTIVE).toContain('Cesar offered:');
    expect(INTERACTIVE).toContain('(pick one in the composer when ready)');
    expect(INTERACTIVE).toContain('(not continuing — answer in the composer when ready)');
    // and neither fires on an '__other:' answer (that already routes as a turn)
    // nor on a deliberate interrupt.
    expect(INTERACTIVE).toMatch(/if \(!chosen && !picked\.startsWith\('__other:'\) && !abort\.signal\.aborted\)/);
    expect(INTERACTIVE).toMatch(/if \(_confirmAnswer !== 'y' && !_confirmAnswer\.startsWith\('__other:'\) && !abort\.signal\.aborted\)/);
  });
});

describe('A3 — the follow-up streams, and renders exactly once', () => {
  it('forwards each text chunk to the live stream inside the send loop', () => {
    const send = CODE.slice(CODE.indexOf('send: async (nextMessage: string) => {'));
    expect(send).toMatch(/if \(chunk\.type === 'text'\) \{\s*text \+= chunk\.content;\s*followUpDisplay.push\(chunk\.content\);/);
    // …and closes the stream (flush held tail + streaming-end) when it ends.
    expect(send).toMatch(/\}\s*assertFollowUpHealthy\(\);\s*_fuEndStream\(\);\s*_fuStreamedText = text;/);
  });

  it('dispatches streaming-chunk / streaming-end, not a single end-of-turn block', () => {
    expect(INTERACTIVE).toContain("onChunk: (chunk) => dispatch({ type: 'streaming-chunk', engineId: cesarEngineId, chunk })");
    expect(INTERACTIVE).toContain("onEnd: () => dispatch({ type: 'streaming-end', engineId: cesarEngineId })");
    expect(INTERACTIVE).toContain('followUpDisplay.end({ flush: !hasCleanupFailure(session) })');
  });

  it('keeps the marker pipeline on the streamed sink (capture + strip)', () => {
    expect(INTERACTIVE).toContain('followUpDisplay.stripMarkers(captured)');
    expect(INTERACTIVE).toContain("followUpDisplay.stripMarkers('', true).trim()");
    // Capture (extractAsk/emitLiveTodos) still runs on the completion callback
    // even when the text was already displayed — a mid-follow-up [ASK] is never
    // lost just because the prose was streamed.
    const onText = CODE.slice(CODE.indexOf('onText: (text: string) => {'), CODE.indexOf('onExchange: (nextMessage: string'));
    expect(onText.indexOf('const captured = extractAsk(emitLiveTodos(text));'))
      .toBeLessThan(onText.indexOf('_fuStreamedText.trim()'));
  });

  it('does not render the same follow-up text twice', () => {
    const onText = CODE.slice(CODE.indexOf('onText: (text: string) => {'), CODE.indexOf('onExchange: (nextMessage: string'));
    expect(onText).toMatch(/if \(_fuStreamedText && String\(text \?\? ''\)\.trim\(\) === _fuStreamedText\.trim\(\)\) return;/);
    // The engine-block fallback stays for the NON-streamed case (tool-loop text).
    expect(onText).toContain("dispatch({ type: 'engine-block'");
  });

  it('runCesarConfirmationFollowUp still hands plain text to onText exactly once', async () => {
    const onText = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => 'Continuing with option A.',
      onText,
    });
    expect(result.status).toBe('text');
    expect(onText).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith('Continuing with option A.');
  });

  it('runCesarConfirmationFollowUp never re-renders text the caller already rendered', async () => {
    const onText = vi.fn();
    const result = await runCesarConfirmationFollowUp({
      answer: 'y',
      send: async () => '<tool name="Read">{"file_path":"a.ts"}</tool>',
      executeTools: async () => ({ finalText: 'Read it.', turns: 1, rendered: true }),
      onText,
    });
    expect(result.content).toBe('Read it.');
    expect(onText).not.toHaveBeenCalled();
  });
});

describe('A4 — an intentional interrupt is not reported as an engine failure', () => {
  it('guards the "stopped responding" line on !aborted', () => {
    expect(CODE).toContain('if (_engineErrored && !abort.signal.aborted) {');
    // …and the error line is only appended to `response` inside that guard, so
    // an interrupted turn never commits a fake failure into the history.
    const block = CODE.slice(CODE.indexOf('if (_engineErrored && !abort.signal.aborted) {'));
    expect(block.slice(0, 600)).toMatch(/const _errLine = `Engine \$\{cesarEngineId\} stopped responding[\s\S]*response = response \+ '\\n\\n' \+ _errLine;/);
  });
});

describe('A5 — follow-up tool markup never streams raw, on any session', () => {
  it('does not gate the follow-up display on hasNativeTools', () => {
    const fu = CODE.slice(CODE.indexOf('const followUpDisplay ='), CODE.indexOf('const _fuEndStream ='));
    // The main stream deliberately skips XML suppression for native sessions
    // (takeXmlSafeDisplayChunk does `if (ctx.cesar!.hasNativeTools) return chunkText;`);
    // the follow-up must NOT, since runCesarConfirmationFollowUp parses textual
    // tool calls on native sessions too.
    expect(fu).toContain('createFollowUpDisplay({');
    expect(fu).not.toContain('hasNativeTools');
  });

  it('latches suppression from the SAME predicate the executor uses', () => {
    // Cohere has no XML marker for splitBeforeToolMarkup to detect. This must
    // use the executor's full-text parser and retain suppression afterward.
    const tool = 'Action: ```json\n[{"tool_name":"Read","parameters":{"file_path":"a.ts"}}]\n```';
    expect(textHasToolCalls(tool)).toBe(true);
    const onChunk = vi.fn();
    const display = createFollowUpDisplay({ onChunk, onEnd: vi.fn() });
    display.push(tool);
    display.push('Do not render after a tool call.');
    display.end({ flush: true });
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('textHasToolCalls answers for every textual format, and never throws', () => {
    expect(textHasToolCalls('<tool name="Read">{"file_path":"a.ts"}</tool>')).toBe(true);
    expect(textHasToolCalls('[TOOL_CALLS][{"name": "Read", "arguments": {"file_path": "a.ts"}}]')).toBe(true);
    expect(textHasToolCalls('Sure — reading the file now.')).toBe(false);
    expect(textHasToolCalls(undefined as unknown as string)).toBe(false);
  });

  it('suppresses display from the first chunk when the follow-up is a tool call', () => {
    // Exercise the production display: pure XML must never open a stream.
    const parts = ['<tool name=', '"Read">{"file_path"', ':"a.ts"}</tool>'];
    const onChunk = vi.fn();
    const onEnd = vi.fn();
    const display = createFollowUpDisplay({ onChunk, onEnd });
    for (const part of parts) display.push(part);
    display.end({ flush: true });
    expect(onChunk).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('streams the prose that precedes tool markup, then stops', () => {
    const onChunk = vi.fn();
    const display = createFollowUpDisplay({ onChunk, onEnd: vi.fn() });
    for (const part of ['Reading the file for you.\n', '<tool name="Read">{"file_path":"a.ts"}</tool>', ' and done.']) {
      display.push(part);
    }
    display.end({ flush: true });
    expect(onChunk.mock.calls.map(([chunk]) => chunk).join('')).toBe('Reading the file for you.\n');
  });
});

describe('A6 — the live follow-up entry is always ended', () => {
  it('ends the stream from the finally, not only from the send loop', () => {
    const choice = CODE.slice(CODE.indexOf('const _runInteractiveChoice = async'));
    const finallyIdx = choice.indexOf('} finally {');
    expect(finallyIdx).toBeGreaterThan(-1);
    const tail = choice.slice(finallyIdx, finallyIdx + 900);
    // _fuEndStream must run BEFORE the spinner stop, on every exit path.
    expect(tail).toMatch(/_fuEndStream\(\);\s*dispatch\(\{ type: 'spinner-stop' \}\);/);
  });

  it('_fuEndStream is idempotent — a second call commits nothing', () => {
    const onEnd = vi.fn();
    const display = createFollowUpDisplay({ onChunk: vi.fn(), onEnd });
    display.end({ flush: true });
    display.end({ flush: true });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('a send that throws mid-iteration still reaches the end-of-stream call', async () => {
    const onChunk = vi.fn();
    const onEnd = vi.fn();
    const display = createFollowUpDisplay({ onChunk, onEnd });
    const answer = 'The answer starts streaming before the adapter rejects.';
    await expect((async () => {
      try {
        await runCesarConfirmationFollowUp({
          answer: 'y',
          send: async () => {
            display.push(answer);
            throw new Error('adapter died mid-stream');
          },
        });
      } finally {
        display.end({ flush: true });
      }
    })()).rejects.toThrow('adapter died mid-stream');
    expect(onChunk.mock.calls.map(([chunk]) => chunk).join('')).toBe(answer);
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
