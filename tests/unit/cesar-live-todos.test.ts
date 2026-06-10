import { describe, expect, it } from 'vitest';
import { parseLiveTodos, parsePreamble } from '../../packages/cli/src/generated/cesar/todos-marker.js';
import { createTodosDisplayStripper, createPreambleStripper } from '../../packages/cli/src/generated/cesar/brain-helpers.js';
import {
  updateTodoState,
  clearLiveTodos,
  type Todo,
} from '../../packages/cli/src/generated/signals/todos.js';

describe('parseLiveTodos — live [TODOS] marker parser', () => {
  it('parses a well-formed block, forces source:live, and strips it from rest', () => {
    const text = [
      'Here is the plan.',
      '[TODOS]',
      '[{"id":"1","text":"Read parser","state":"done"},{"id":"2","text":"Patch loop","state":"running"},{"id":"3","text":"Add test","state":"pending"}]',
      '[/TODOS]',
      'Working on it.',
    ].join('\n');
    const r = parseLiveTodos(text);
    expect(r.found).toBe(true);
    expect(r.todos).toHaveLength(3);
    expect(r.todos.every((t) => t.source === 'live')).toBe(true);
    expect(r.todos[0]).toMatchObject({ id: '1', text: 'Read parser', state: 'done' });
    expect(r.todos[1].state).toBe('running');
    expect(r.todos[2].state).toBe('pending');
    // Block removed from the visible text.
    expect(r.rest).not.toContain('[TODOS]');
    expect(r.rest).not.toContain('[/TODOS]');
    expect(r.rest).toContain('Here is the plan.');
    expect(r.rest).toContain('Working on it.');
  });

  it('returns found:false and untouched rest when no block present', () => {
    const text = 'Just a normal answer, no checklist.';
    const r = parseLiveTodos(text);
    expect(r.found).toBe(false);
    expect(r.todos).toEqual([]);
    expect(r.rest).toBe(text);
  });

  it('ignores malformed JSON silently but still strips the block (no crash)', () => {
    const text = 'Doing it.\n[TODOS]\nnot json at all {{{\n[/TODOS]\nDone.';
    const r = parseLiveTodos(text);
    expect(r.found).toBe(true);
    expect(r.todos).toEqual([]);
    expect(r.rest).not.toContain('[TODOS]');
    expect(r.rest).not.toContain('not json');
  });

  it('ignores a non-array JSON body silently', () => {
    const r = parseLiveTodos('[TODOS]\n{"id":"1","text":"x"}\n[/TODOS]');
    expect(r.found).toBe(true);
    expect(r.todos).toEqual([]);
  });

  it('skips items missing id or text, keeps valid ones', () => {
    const r = parseLiveTodos(
      '[TODOS][{"id":"1","text":"keep","state":"done"},{"text":"no id"},{"id":"3"},{"id":"4","text":"also keep"}][/TODOS]',
    );
    expect(r.todos.map((t) => t.id)).toEqual(['1', '4']);
  });

  it('coerces an unknown state to pending', () => {
    const r = parseLiveTodos('[TODOS][{"id":"1","text":"x","state":"bananas"}][/TODOS]');
    expect(r.todos[0].state).toBe('pending');
  });

  it('takes the LAST block when multiple are present (latest snapshot wins)', () => {
    const text =
      '[TODOS][{"id":"1","text":"a","state":"running"}][/TODOS]' +
      ' progress ' +
      '[TODOS][{"id":"1","text":"a","state":"done"},{"id":"2","text":"b","state":"running"}][/TODOS]';
    const r = parseLiveTodos(text);
    expect(r.todos).toHaveLength(2);
    expect(r.todos[0].state).toBe('done');
    // Both blocks stripped.
    expect(r.rest).not.toContain('[TODOS]');
  });

  it('dedupes ids within one block, last occurrence wins, order preserved', () => {
    const r = parseLiveTodos(
      '[TODOS][{"id":"1","text":"first","state":"pending"},{"id":"2","text":"two"},{"id":"1","text":"first-updated","state":"done"}][/TODOS]',
    );
    expect(r.todos.map((t) => t.id)).toEqual(['1', '2']);
    expect(r.todos[0]).toMatchObject({ text: 'first-updated', state: 'done' });
  });

  it('preserves an optional note and matches the marker case-insensitively', () => {
    const r = parseLiveTodos('[todos][{"id":"1","text":"x","state":"failed","note":"oops"}][/todos]');
    expect(r.found).toBe(true);
    expect(r.todos[0]).toMatchObject({ state: 'failed', note: 'oops' });
  });

  it('caps parsed items at 50 (runaway/garbage array bounded)', () => {
    const items = Array.from({ length: 120 }, (_, i) => `{"id":"${i}","text":"t${i}","state":"pending"}`);
    const r = parseLiveTodos(`[TODOS][${items.join(',')}][/TODOS]`);
    expect(r.found).toBe(true);
    expect(r.todos).toHaveLength(50);
    // Cap is applied to the FIRST 50 raw items.
    expect(r.todos[0].id).toBe('0');
    expect(r.todos[49].id).toBe('49');
  });
});

describe('createTodosDisplayStripper — native-path incremental [TODOS] stripper', () => {
  it('open tag split across chunks holds the prefix, never leaking the marker', () => {
    const strip = createTodosDisplayStripper();
    // "[TODO" is a partial prefix of "[todos]" → held, not shown.
    expect(strip('before [TODO')).toBe('before ');
    // Completes the open marker, body suppressed, close consumed, after shown.
    expect(strip('S][{"id":"1","text":"x"}][/TODOS] after')).toBe(' after');
  });

  it('END tag split across chunks: text after [/TODOS] renders, nothing suppressed after', () => {
    const strip = createTodosDisplayStripper();
    // Chunk 1: open + body + partial close prefix "[/TO" (must be held, not dropped).
    expect(strip('[TODOS]body[/TO')).toBe('');
    // Chunk 2: completes "[/TODOS]" then trailing text — block closes, text renders.
    expect(strip('DOS] after')).toBe(' after');
    // Subsequent plain text is NOT suppressed (block did not latch open forever).
    expect(strip('more text')).toBe('more text');
  });

  it('final chunk ending in a partial marker prefix is returned on force flush (no loss)', () => {
    const strip = createTodosDisplayStripper();
    // "… see [" is a legit prefix of "[todos]" → held during streaming.
    expect(strip('all done, see [')).toBe('all done, see ');
    // Stream-end force flush returns the held tail verbatim.
    expect(strip('', true)).toBe('[');
  });

  it('complete [TODOS]…[/TODOS] within one chunk: before/after text renders', () => {
    const strip = createTodosDisplayStripper();
    expect(strip('pre [TODOS][{"id":"1","text":"x"}][/TODOS] post')).toBe('pre  post');
  });

  it('plain text containing a literal "[" is unharmed', () => {
    const strip = createTodosDisplayStripper();
    expect(strip('an array a[0] and a [list] of things')).toBe('an array a[0] and a [list] of things');
  });

  it('force flush with empty hold returns ""', () => {
    const strip = createTodosDisplayStripper();
    expect(strip('plain text')).toBe('plain text');
    expect(strip('', true)).toBe('');
  });

  it('a bare "[" at chunk end is held then flushed verbatim on force', () => {
    const strip = createTodosDisplayStripper();
    expect(strip('tail [')).toBe('tail ');
    expect(strip('', true)).toBe('[');
  });
});

describe('parsePreamble — START-anchored [INTENT] marker parser', () => {
  it('parses a leading [INTENT] line, strips it, returns the rest', () => {
    const r = parsePreamble('[INTENT] Tracing the dispatch path\nNow the answer.');
    expect(r.found).toBe(true);
    expect(r.intent).toBe('Tracing the dispatch path');
    expect(r.rest).toBe('Now the answer.');
  });

  it('allows leading whitespace/newlines before the marker (still start-anchored)', () => {
    const r = parsePreamble('\n  [INTENT] Reading session.kern\nbody');
    expect(r.found).toBe(true);
    expect(r.intent).toBe('Reading session.kern');
    expect(r.rest).toBe('body');
  });

  it('matches the marker case-insensitively', () => {
    const r = parsePreamble('[intent] lower-case marker\nrest');
    expect(r.found).toBe(true);
    expect(r.intent).toBe('lower-case marker');
  });

  it('returns found:false and untouched text when no marker present', () => {
    const text = 'Just a normal answer with no preamble.';
    const r = parsePreamble(text);
    expect(r.found).toBe(false);
    expect(r.intent).toBeNull();
    expect(r.rest).toBe(text);
  });

  it('does NOT treat a mid-text [INTENT] as a preamble (anchor rule)', () => {
    const text = 'Here is some prose.\n[INTENT] not a preamble\nmore prose.';
    const r = parsePreamble(text);
    expect(r.found).toBe(false);
    expect(r.intent).toBeNull();
    expect(r.rest).toBe(text);
  });

  it('treats a bare/empty marker as absent (no block, no strip)', () => {
    const text = '[INTENT]\nbody';
    const r = parsePreamble(text);
    expect(r.found).toBe(false);
    expect(r.intent).toBeNull();
    expect(r.rest).toBe(text);
  });

  it('handles a newline-less marker-only response (intent to end of string)', () => {
    const r = parsePreamble('[INTENT] only an intent line');
    expect(r.found).toBe(true);
    expect(r.intent).toBe('only an intent line');
    expect(r.rest).toBe('');
  });
});

describe('createPreambleStripper — native-path incremental [INTENT] stripper', () => {
  it('suppresses a leading [INTENT] line delivered in one chunk', () => {
    const strip = createPreambleStripper();
    expect(strip('[INTENT] tracing path\nthe answer')).toBe('the answer');
    // Past the preamble: pure pass-through.
    expect(strip(' continues')).toBe(' continues');
  });

  it('marker split across chunks ("[INT" + "ENT] …\\n…") never leaks the marker', () => {
    const strip = createPreambleStripper();
    expect(strip('[INT')).toBe('');           // partial marker held
    expect(strip('ENT] doing a thing\n')).toBe(''); // completes line, suppressed
    expect(strip('real answer')).toBe('real answer');
  });

  it('non-marker leading text flushes immediately (never withheld)', () => {
    const strip = createPreambleStripper();
    expect(strip('Here is the answer.')).toBe('Here is the answer.');
    // A later "[INTENT]" mid-stream is NOT a preamble — pass-through.
    expect(strip(' [INTENT] not stripped')).toBe(' [INTENT] not stripped');
  });

  it('leading text that briefly looks like the marker but diverges flushes', () => {
    const strip = createPreambleStripper();
    // "[In" is a prefix of "[intent]" → held; "voice" diverges → flush all.
    expect(strip('[In')).toBe('');
    expect(strip('voice list')).toBe('[Invoice list');
  });

  it('force flush returns held non-marker text verbatim (no loss)', () => {
    const strip = createPreambleStripper();
    expect(strip('[INT')).toBe('');
    // Stream ended mid-partial-marker that never completed → flush verbatim.
    expect(strip('', true)).toBe('[INT');
  });

  it('force flush strips a complete newline-less [INTENT] line (no marker leak)', () => {
    const strip = createPreambleStripper();
    // The whole response is just the intent line, no trailing newline.
    expect(strip('[INTENT] only intent')).toBe('');
    expect(strip('', true)).toBe('');
  });

  it('intent line longer than the first chunk is held until its newline', () => {
    const strip = createPreambleStripper();
    expect(strip('[INTENT] a fairly ')).toBe('');
    expect(strip('long intent line')).toBe('');
    expect(strip(' wrapping on\nanswer body')).toBe('answer body');
  });
});

describe('todos mutators — source field', () => {
  const live: Todo[] = [
    { id: '1', text: 'a', state: 'done', source: 'live' },
    { id: '2', text: 'b', state: 'running', source: 'live' },
  ];
  const plan: Todo[] = [
    { id: 'p1', text: 'plan step', state: 'running', source: 'plan' },
    { id: 'p2', text: 'no source', state: 'pending' },
  ];

  it('updateTodoState preserves the source field through a patch', () => {
    const next = updateTodoState(live, '2', 'done', undefined);
    expect(next.find((t) => t.id === '2')).toMatchObject({ state: 'done', source: 'live' });
  });

  it('clearLiveTodos drops only live items, keeping plan and source-less items', () => {
    const next = clearLiveTodos([...live, ...plan]);
    expect(next.map((t) => t.id)).toEqual(['p1', 'p2']);
  });

  it('clearLiveTodos on an all-plan list is a no-op', () => {
    expect(clearLiveTodos(plan)).toHaveLength(2);
  });
});
