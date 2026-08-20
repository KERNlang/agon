// ── Streaming cost guards (cesar/brain.ts hot loop) ────────────────────
//
// `response` grows by concatenation, so any regex/scan over the WHOLE
// accumulated answer on every streamed chunk is O(n) per chunk = quadratic
// over a long answer. Two gates removed that cost:
//
//   B1  parseToolCalls(response) ran on every chunk (every CLI brain without
//       native tools). It now runs only when the arriving text could have
//       COMPLETED a tool call — chunkMayCompleteToolCall.
//   B2  emitPreamble(response) ran on every chunk with the full buffer, and
//       parsePreamble's anchored regex forced a cons-string flatten each time.
//       The [INTENT] marker is START-anchored, so the decision is settled by
//       the head and latches — classifyPreambleHead.
//
// The pinned invariant for both: SAME observable behaviour, less work.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  chunkMayCompleteToolCall,
  classifyPreambleHead,
} from '../../packages/cli/src/generated/cesar/brain-helpers.js';
import { parseToolCalls } from '../../packages/core/src/generated/tools/tool-parser.js';
import { parsePreamble } from '../../packages/cli/src/generated/cesar/todos-marker.js';
import { cleanEngineOutput } from '../../packages/cli/src/generated/blocks/markdown.js';
import {
  boundStreamingTail,
  createLatestUiCommitter,
  LIVE_TAIL_CHARS,
} from '../../packages/cli/src/generated/surfaces/app-output-bridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

// Feed `text` through the gate in `size`-char chunks and report, for each
// chunk, whether the gate allowed the full scan. Mirrors cesar/brain.ts's loop.
function gateRun(text: string, size: number): { scanned: boolean; buffer: string }[] {
  const steps: { scanned: boolean; buffer: string }[] = [];
  let tail = '';
  let buffer = '';
  let i = 0;
  while (i < text.length) {
    const chunk = text.slice(i, i + size);
    i += size;
    buffer += chunk;
    const gate = chunkMayCompleteToolCall(tail, chunk);
    tail = gate.tail;
    steps.push({ scanned: gate.scan, buffer });
  }
  return steps;
}

describe('chunkMayCompleteToolCall (B1: skip the full-buffer tool scan)', () => {
  it('stays closed on ordinary prose', () => {
    let tail = '';
    const chunks = ['Reading the ', 'brain now and ', 'summarising what it does.'];
    const scans = chunks.map((c) => {
      const gate = chunkMayCompleteToolCall(tail, c);
      tail = gate.tail;
      return gate.scan;
    });
    expect(scans).toEqual([false, false, false]);
  });

  it('opens on the characters that terminate a close marker', () => {
    expect(chunkMayCompleteToolCall('', '</tool>').scan).toBe(true);
    expect(chunkMayCompleteToolCall('', '}]').scan).toBe(true);
    expect(chunkMayCompleteToolCall('', '```').scan).toBe(true);
  });

  it('carries a bounded tail so a split marker is still seen', () => {
    const first = chunkMayCompleteToolCall('', 'done ]');
    expect(first.scan).toBe(true);
    // The ']' is now only in the carry-over tail — Mistral's optional trailing
    // newline must still re-open the gate.
    const second = chunkMayCompleteToolCall(first.tail, '\n');
    expect(second.scan).toBe(true);
    expect(second.tail.length).toBeLessThanOrEqual(24);
  });

  it('still detects a tool call split across chunks, at any chunk size', () => {
    const call = 'Reading it now.\n<tool name="Read">{"file_path":"a.ts"}</tool>';
    [1, 3, 7, 40].forEach((size) => {
      const steps = gateRun(call, size);
      // The scan that first sees the COMPLETE call must be allowed through.
      const firstComplete = steps.find((s) => parseToolCalls(s.buffer).hasToolCalls);
      expect(firstComplete, `size ${size}`).toBeDefined();
      expect(firstComplete!.scanned, `size ${size}`).toBe(true);
    });
  });

  it('still detects the long minimax close marker split one char at a time', () => {
    const call = '<tool name="Bash">{"command":"ls"}</minimax:tool_call>';
    const steps = gateRun(call, 1);
    const firstComplete = steps.find((s) => parseToolCalls(s.buffer).hasToolCalls);
    expect(firstComplete).toBeDefined();
    expect(firstComplete!.scanned).toBe(true);
  });

  it('never skips a scan that would have found a NEW complete call', () => {
    // Exhaustive over a mixed stream: whenever hasToolCalls flips false → true,
    // the gate for that chunk must be open.
    const text = 'Plan: check `a.ts` (see [1]) then run.\n<tool name="Read">{"file_path":"a.ts"}</tool>\nDone.';
    [1, 2, 5, 11].forEach((size) => {
      const steps = gateRun(text, size);
      let previous = false;
      steps.forEach((step) => {
        const now = parseToolCalls(step.buffer).hasToolCalls;
        if (now && !previous) expect(step.scanned, `size ${size}`).toBe(true);
        previous = now;
      });
    });
  });
});

describe('classifyPreambleHead (B2: latch the [INTENT] decision)', () => {
  it('matches a start-anchored marker, with or without leading whitespace', () => {
    expect(classifyPreambleHead('[INTENT] fixing the parser')).toBe('match');
    expect(classifyPreambleHead('\n  [intent] fixing')).toBe('match');
    expect(classifyPreambleHead('[INTENT]')).toBe('match');
  });

  it('stays undecided while the head is still shorter than the marker', () => {
    expect(classifyPreambleHead('')).toBe('maybe');
    expect(classifyPreambleHead('[INT')).toBe('maybe');
    expect(classifyPreambleHead('   ')).toBe('maybe');
  });

  it('settles to absent once 8 non-space chars cannot match', () => {
    expect(classifyPreambleHead('Sure — here is the plan.')).toBe('absent');
    expect(classifyPreambleHead('[TODOS]\n')).toBe('absent');
  });

  it('agrees with parsePreamble on whether a preamble exists', () => {
    const cases = [
      '[INTENT] fixing the parser\nrest of the answer',
      '  [intent] one line\nmore',
      'No marker at all, just prose.',
      '[TODOS] not a preamble',
    ];
    cases.forEach((text) => {
      const kind = classifyPreambleHead(text);
      const parsed = parsePreamble(text);
      if (parsed.found) expect(kind, text).toBe('match');
      else if (kind === 'absent') expect(parsed.found, text).toBe(false);
    });
  });

  it('a bare marker stays match so the head keeps growing until the intent arrives', () => {
    // parsePreamble treats a bare "[INTENT]" as ABSENT (no block, no strip), so
    // the brain must keep probing rather than latching — 'match' does that.
    expect(classifyPreambleHead('[INTENT]')).toBe('match');
    expect(parsePreamble('[INTENT]').found).toBe(false);
    expect(parsePreamble('[INTENT] now here').found).toBe(true);
  });
});

describe('cesar/brain.ts wires both gates into the stream loop', () => {
  const CODE = stripComments(readFileSync(resolve(here, '../../packages/cli/src/generated/cesar/brain.ts'), 'utf8'));

  it('gates the per-chunk XML tool scan on the arriving chunk', () => {
    expect(CODE).toContain('noteXmlToolDetected(true, chunk.content)');
    expect(CODE).toMatch(/const gate = chunkMayCompleteToolCall\(_xmlChunkTail, chunkText\);\s*_xmlChunkTail = gate\.tail;\s*if \(!gate\.scan\) return;/);
  });

  it('never calls emitPreamble with the full response inside the stream loop', () => {
    const loop = CODE.slice(CODE.indexOf('if (chunk.type === \'text\')'), CODE.indexOf('const trailingPreambleSafe'));
    expect(loop).toContain('notePreambleSeed(response)');
    expect(loop).toContain('notePreambleChunk(chunk.content)');
    expect(loop).not.toContain('emitPreamble(response)');
  });

  it('latches the preamble probe so a settled head is never re-parsed', () => {
    expect(CODE).toMatch(/const notePreambleChunk = \(chunkText: string\): void => \{\s*if \(_preambleSettled\) return;/);
    expect(CODE).toMatch(/if \(kind === 'absent'\) \{ _preambleSettled = true; return; \}/);
  });
});

describe('cleanEngineOutput cache evicts instead of clearing (B4)', () => {
  const MARKDOWN = stripComments(readFileSync(resolve(here, '../../packages/cli/src/generated/blocks/markdown.ts'), 'utf8'));

  it('drops the oldest entry rather than the whole cache', () => {
    expect(MARKDOWN).not.toContain('_cleanCache.clear()');
    expect(MARKDOWN).toContain('_cleanCache.keys().next().value');
    expect(MARKDOWN).toContain('_cleanCache.delete(oldestKey)');
  });

  it('returns identical output well past the cache cap', () => {
    const outputs: string[] = [];
    let i = 0;
    while (i < 320) {
      outputs.push(cleanEngineOutput(`Answer number ${i} about the parser.`));
      i += 1;
    }
    expect(outputs[0]).toBe(cleanEngineOutput('Answer number 0 about the parser.'));
    expect(outputs[319]).toBe(cleanEngineOutput('Answer number 319 about the parser.'));
    expect(outputs[10]).toContain('Answer number 10');
  });
});

describe('the live-preview tail slice runs inside the throttled commit (B3)', () => {
  const BRIDGE = stripComments(readFileSync(resolve(here, '../../packages/cli/src/generated/surfaces/app-output-bridge.ts'), 'utf8'));

  it('bounds the tail in the committer, not on every enqueue', () => {
    expect(BRIDGE).toContain('createLatestUiCommitter(\n    setStreamingText,\n    66,\n    boundStreamingTail,\n  )');
    const action = BRIDGE.slice(BRIDGE.indexOf('setStreamingText: (updater'), BRIDGE.indexOf('setLiveToolStreams: (updater'));
    // The enqueue path must hand over the FULL map — no per-chunk memcpy.
    expect(action).toContain('streamingUiCommitter.enqueue(next)');
    expect(action).toContain('streamingUiCommitter.commitNow(next)');
    expect(action).not.toContain('LIVE_TAIL');
    expect(action).not.toContain('slice(-');
  });

  it('applies the transform once per COMMIT, never per enqueue', async () => {
    const commits: string[] = [];
    let transforms = 0;
    const committer = createLatestUiCommitter<string>(
      (value) => commits.push(value),
      40,
      (value) => { transforms += 1; return value.slice(-4); },
    );
    committer.enqueue('aaaaaaaaaa');   // immediate (first commit)
    let i = 0;
    while (i < 20) { committer.enqueue(`bbbbbbbbb${i}`); i += 1; }
    await new Promise((r) => setTimeout(r, 80));
    // 1 immediate + 1 trailing commit — the 19 dropped enqueues cost nothing.
    expect(commits).toEqual(['aaaa', 'bb19']);
    expect(transforms).toBe(2);
  });

  it('boundStreamingTail keeps the last LIVE_TAIL_CHARS and leaves short streams alone', () => {
    const short = { a: { engineId: 'a', content: 'hi', startedAt: 1 } } as any;
    // Nothing oversized → same object, no allocation.
    expect(boundStreamingTail(short)).toBe(short);
    const long = {
      a: { engineId: 'a', content: 'x'.repeat(LIVE_TAIL_CHARS + 500), startedAt: 1 },
      b: { engineId: 'b', content: 'short', startedAt: 2 },
    } as any;
    const bounded = boundStreamingTail(long);
    expect(bounded).not.toBe(long);
    expect(bounded.a.content).toHaveLength(LIVE_TAIL_CHARS);
    expect(bounded.a.engineId).toBe('a');
    // Untouched entries are shared, and the input map is never mutated.
    expect(bounded.b).toBe(long.b);
    expect(long.a.content).toHaveLength(LIVE_TAIL_CHARS + 500);
  });
});
