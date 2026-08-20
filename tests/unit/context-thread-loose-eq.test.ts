import { describe, it, expect } from 'vitest';
import { loopEntryToThreadMessage } from '../../packages/core/src/cesar/context-thread.js';

// context-thread's looseEq() treats null and undefined as equal and everything
// else strictly. Both call sites pass `null` as the right-hand side, so a
// weakened left-hand test makes looseEq() answer "equal" for EVERY value:
// non-string tool payloads then collapse to '' and are lost from the thread.

describe('loopEntryToThreadMessage content coercion', () => {
  it('stringifies a non-string content payload instead of dropping it', () => {
    expect(loopEntryToThreadMessage({ role: 'assistant', content: 42 }, 'claude').content).toBe('42');
    expect(loopEntryToThreadMessage({ role: 'assistant', content: true }, 'claude').content).toBe('true');
    expect(loopEntryToThreadMessage({ role: 'tool', content: ['a', 'b'] }, 'claude').content).toBe('a,b');
  });

  it('maps genuinely absent content to an empty string', () => {
    expect(loopEntryToThreadMessage({ role: 'assistant', content: null }, 'claude').content).toBe('');
    expect(loopEntryToThreadMessage({ role: 'assistant', content: undefined }, 'claude').content).toBe('');
    expect(loopEntryToThreadMessage({ role: 'assistant' }, 'claude').content).toBe('');
  });

  it('passes a string payload through verbatim', () => {
    expect(loopEntryToThreadMessage({ role: 'user', content: 'hello' }, 'claude').content).toBe('hello');
    expect(loopEntryToThreadMessage({ role: 'user', content: '' }, 'claude').content).toBe('');
  });

  it('carries role, engineId and tool calls', () => {
    const msg = loopEntryToThreadMessage({
      role: 'assistant',
      content: 'calling',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.ts"}' } }],
    }, 'codex', 1_700_000_000_000);
    expect(msg.role).toBe('assistant');
    expect(msg.engineId).toBe('codex');
    expect(msg.timestamp).toBe(1_700_000_000_000);
    expect(msg.toolCalls).toEqual([{ id: 'c1', name: 'Read', arguments: '{"path":"a.ts"}' }]);
  });
});
