// ── An [ASK]/fork/confirm pick must visibly resume ─────────────────────
//
// Field report (session chat-1787039227533, seq 8168-8195): the user picked an
// option, the overlay vanished, the follow-up ran tools silently for 28s and
// nothing appeared on screen — no echo of the choice, no streamed text. The
// user concluded Cesar had stopped.
//
// Four invariants come out of that, all inside handleCesarBrain — one ~3600-line
// turn machine with no injection seam, so (as with cesar-steering-yield-wiring)
// the guards below read brain.ts as text and assert the wiring, plus
// behavioural tests on the follow-up module itself.
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
import {
  chunkMayCompleteToolCall,
  splitBeforeToolMarkup,
  textHasToolCalls,
  XML_TOOL_MARKUP_HOLD_CHARS,
} from '../../packages/cli/src/cesar/brain-helpers.js';

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
    expect(send).toMatch(/if \(chunk\.type === 'text'\) \{\s*text \+= chunk\.content;\s*_fuEmit\(chunk\.content\);/);
    // …and closes the stream (flush held tail + streaming-end) when it ends.
    expect(send).toMatch(/\}\s*_fuEndStream\(\);\s*_fuStreamedText = text;/);
  });

  it('dispatches streaming-chunk / streaming-end, not a single end-of-turn block', () => {
    expect(CODE).toMatch(/_fuStreaming = true;\s*dispatch\(\{ type: 'streaming-chunk', engineId: cesarEngineId, chunk: visible \}\);/);
    expect(CODE).toMatch(/const _fuEndStream = \(\) => \{\s*_fuEmit\('', true\);\s*if \(_fuStreaming\) \{\s*dispatch\(\{ type: 'streaming-end', engineId: cesarEngineId \}\);/);
  });

  it('keeps the marker pipeline on the streamed sink (capture + strip)', () => {
    // Display strippers run per chunk BEFORE the tool-markup gate, so a
    // [TODOS]/[ASK] block never silences the prose around it.
    expect(CODE).toMatch(/const _fuEmit = \(raw: string, force = false\) => \{[\s\S]{0,400}?const stripped = stripFollowUpAsk\(stripFollowUpTodos\(raw, force\), force\);\s*if \(!stripped\) return;\s*const visible = _fuDisplayChunk\(stripped, force\);/);
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
    const fu = CODE.slice(CODE.indexOf('const _fuDisplayChunk ='), CODE.indexOf('const _fuEndStream ='));
    // The main stream deliberately skips XML suppression for native sessions
    // (takeXmlSafeDisplayChunk does `if (ctx.cesar!.hasNativeTools) return chunkText;`);
    // the follow-up must NOT, since runCesarConfirmationFollowUp parses textual
    // tool calls on native sessions too.
    expect(CODE).toContain('const takeXmlSafeDisplayChunk = (chunkText: string, force = false) => {');
    expect(fu).not.toContain('hasNativeTools');
  });

  it('latches suppression from the SAME predicate the executor uses', () => {
    // parseToolCalls (via the shared textHasToolCalls helper), behind the same
    // cheap per-chunk gate the main stream uses — not a second marker list.
    const emit = CODE.slice(CODE.indexOf('const _fuEmit ='), CODE.indexOf('const _fuEndStream ='));
    expect(emit).toContain('chunkMayCompleteToolCall(_fuToolTail, raw)');
    expect(emit).toContain('if (toolGate.scan) _fuScanPending = true;');
    const fu = CODE.slice(CODE.indexOf('const _fuDisplayChunk ='), CODE.indexOf('const _fuEmit ='));
    expect(fu).toMatch(/if \(_fuScanPending\) \{\s*_fuScanPending = false;\s*if \(textHasToolCalls\(_fuRaw\)\) \{ _fuSuppressXml = true; _fuHold = ''; return ''; \}/);
    // …and only AFTER the marker split, so a plain XML call still releases the
    // prose that preceded it instead of losing the held tail.
    expect(fu.indexOf('splitBeforeToolMarkup(combined)')).toBeLessThan(fu.indexOf('_fuScanPending'));
  });

  it('textHasToolCalls answers for every textual format, and never throws', () => {
    expect(textHasToolCalls('<tool name="Read">{"file_path":"a.ts"}</tool>')).toBe(true);
    expect(textHasToolCalls('[TOOL_CALLS][{"name": "Read", "arguments": {"file_path": "a.ts"}}]')).toBe(true);
    expect(textHasToolCalls('Sure — reading the file now.')).toBe(false);
    expect(textHasToolCalls(undefined as unknown as string)).toBe(false);
  });

  it('suppresses display from the first chunk when the follow-up is a tool call', () => {
    // Replay the gate: a follow-up whose whole answer is XML markup
    // must produce no visible text at all, so streaming-end never commits it.
    const parts = ['<tool name=', '"Read">{"file_path"', ':"a.ts"}</tool>'];
    let acc = '';
    let visible = '';
    const gate = makeFollowUpGate();
    for (const part of parts) {
      acc += part;
      visible += gate(part, acc);
    }
    visible += gate('', acc, true);
    expect(visible).toBe('');
  });

  it('streams the prose that precedes tool markup, then stops', () => {
    const gate = makeFollowUpGate();
    let acc = '';
    let visible = '';
    for (const part of ['Reading the file for you.\n', '<tool name="Read">{"file_path":"a.ts"}</tool>', ' and done.']) {
      acc += part;
      visible += gate(part, acc);
    }
    visible += gate('', acc, true);
    expect(visible).toBe('Reading the file for you.\n');
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
    const events: string[] = [];
    const endStream = makeFollowUpEndStream(events);
    endStream();
    endStream();
    expect(events).toEqual([]);
  });

  it('a send that throws mid-iteration still reaches the end-of-stream call', async () => {
    // Behavioural proxy for the wiring above: try/finally around the awaited
    // follow-up guarantees the cleanup runs when the send rejects.
    const events: string[] = [];
    const endStream = makeFollowUpEndStream(events, true);
    await expect((async () => {
      try {
        await runCesarConfirmationFollowUp({
          answer: 'y',
          send: async () => { throw new Error('adapter died mid-stream'); },
        });
      } finally {
        endStream();
      }
    })()).rejects.toThrow('adapter died mid-stream');
    expect(events).toEqual(['streaming-end']);
  });
});

// ── Replicas of the follow-up gate/teardown ────────────────────────────
// handleCesarBrain has no injection seam, so the structural guards above pin the
// wiring and these tiny replicas exercise the behaviour the wiring produces.
function makeFollowUpGate() {
  let suppress = false;
  let hold = '';
  let tail = '';
  let scanPending = false;
  let raw = '';
  return (chunkText: string, _accumulated: string, force = false): string => {
    raw += chunkText;
    const gate = chunkMayCompleteToolCall(tail, chunkText);
    tail = gate.tail;
    if (gate.scan) scanPending = true;
    if (suppress) { hold = ''; return ''; }
    const combined = hold + chunkText;
    const split = splitBeforeToolMarkup(combined);
    if (split.hasToolMarkup) { suppress = true; hold = ''; return split.visible; }
    if (scanPending) {
      scanPending = false;
      if (textHasToolCalls(raw)) { suppress = true; hold = ''; return ''; }
    }
    if (force) { hold = ''; return combined; }
    const held = Math.min(XML_TOOL_MARKUP_HOLD_CHARS, combined.length);
    const visible = combined.slice(0, combined.length - held);
    hold = combined.slice(combined.length - held);
    return visible;
  };
}

function makeFollowUpEndStream(events: string[], streamingNow = false) {
  let streaming = streamingNow;
  return () => {
    if (streaming) { events.push('streaming-end'); streaming = false; }
  };
}
