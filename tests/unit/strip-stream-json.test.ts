import { describe, expect, it } from 'vitest';

import { stripStreamJson } from '../../packages/adapter-cli/src/adapter-helpers.js';

function ndjson(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

const assistantText = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

describe('stripStreamJson', () => {
  it('prefers the final result event so the answer is not duplicated', () => {
    const out = stripStreamJson(ndjson(
      assistantText('## Answer\nfull answer body'),
      { type: 'result', result: '## Answer\nfull answer body', is_error: false },
    ));
    expect(out).toBe('## Answer\nfull answer body');
  });

  it('drops tool preambles when a later result carries the real answer (multi-turn tool run)', () => {
    const out = stripStreamJson(ndjson(
      assistantText("I'll quickly verify the file paths."),
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
      assistantText('The verified answer.'),
      { type: 'result', result: 'The verified answer.', is_error: false },
    ));
    expect(out).toBe('The verified answer.');
  });

  it('falls back to assistant texts when the stream has no result event (timeout kill)', () => {
    const out = stripStreamJson(ndjson(
      assistantText('partial answer up to the cutoff'),
    ));
    expect(out).toBe('partial answer up to the cutoff');
  });

  it('falls back to assistant texts when the result event is an error (max-tokens truncation)', () => {
    const out = stripStreamJson(ndjson(
      assistantText('truncated but valid text'),
      { type: 'result', result: '', is_error: true },
    ));
    expect(out).toBe('truncated but valid text');
  });

  it('never lets a non-string result payload mask the assistant text', () => {
    const out = stripStreamJson(ndjson(
      assistantText('the actual answer'),
      { type: 'result', result: { some: 'object' }, is_error: false },
    ));
    expect(out).toContain('the actual answer');
    expect(out).not.toBe('{"some":"object"}');
  });

  it('keeps raw non-JSON lines as-is', () => {
    expect(stripStreamJson('plain engine output\nsecond line')).toBe('plain engine output\nsecond line');
  });

  it('skips system and hook events', () => {
    const out = stripStreamJson(ndjson(
      { type: 'system', subtype: 'init' },
      { type: 'system', subtype: 'hook_started' },
      assistantText('answer'),
      { type: 'result', result: 'answer', is_error: false },
    ));
    expect(out).toBe('answer');
  });
});
