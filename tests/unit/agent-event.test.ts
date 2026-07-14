import { describe, it, expect } from 'vitest';
import {
  makeAssistantChunk, makeToolCall, makeTurnComplete, makeError,
  normalizeSessionChunk, buildApiTurnEvents, estimatedUsage, unavailableUsage,
} from '../../packages/core/src/generated/models/agent-event.js';
import type { RawSessionChunk } from '../../packages/core/src/generated/models/agent-event.js';

describe('agent-event constructors', () => {
  it('makeAssistantChunk produces the correct shape', () => {
    const ev = makeAssistantChunk('claude', 'hello world');
    expect(ev).toEqual({ kind: 'assistant_chunk', engineId: 'claude', text: 'hello world' });
  });

  it('makeToolCall with minimal args', () => {
    const ev = makeToolCall('codex', 'Bash', 'running');
    expect(ev).toMatchObject({
      kind: 'tool_call',
      engineId: 'codex',
      toolName: 'Bash',
      status: 'running',
    });
  });

  it('makeToolCall with full opts', () => {
    const ev = makeToolCall('claude', 'Read', 'ok', {
      toolCallId: 'call_1',
      input: { file_path: '/tmp/x' },
      output: 'file contents',
    });
    if (ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.toolCallId).toBe('call_1');
    expect(ev.input).toEqual({ file_path: '/tmp/x' });
    expect(ev.output).toBe('file contents');
  });

  it('makeTurnComplete with usage=null for CLI', () => {
    const ev = makeTurnComplete('claude', 'end_turn');
    if (ev.kind !== 'turn_complete') throw new Error('wrong kind');
    expect(ev.usage).toBeNull();
  });

  it('makeTurnComplete with sdk usage for API', () => {
    const usage = { promptTokens: 100, completionTokens: 200, totalTokens: 300, source: 'sdk' as const };
    const ev = makeTurnComplete('anthropic', 'stop', usage);
    if (ev.kind !== 'turn_complete') throw new Error('wrong kind');
    expect(ev.usage).toEqual(usage);
  });

  it('makeError defaults recoverable to false', () => {
    const ev = makeError('claude', 'rate limited');
    if (ev.kind !== 'error') throw new Error('wrong kind');
    expect(ev.recoverable).toBe(false);
  });

  it('makeError respects recoverable=true', () => {
    const ev = makeError('claude', 'network blip', true);
    if (ev.kind !== 'error') throw new Error('wrong kind');
    expect(ev.recoverable).toBe(true);
  });
});

describe('normalizeSessionChunk', () => {
  it('maps text chunks to assistant_chunk', () => {
    const chunk: RawSessionChunk = { type: 'text', content: 'hello' };
    const ev = normalizeSessionChunk(chunk, 'claude');
    expect(ev).toEqual({ kind: 'assistant_chunk', engineId: 'claude', text: 'hello' });
  });

  it('maps Claude stream-json tool_use (status=native) to running tool_call', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'Read',
      metadata: { input: { file_path: '/tmp/x' }, status: 'native' },
    };
    const ev = normalizeSessionChunk(chunk, 'claude');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.toolName).toBe('Read');
    expect(ev.status).toBe('running');
    expect(ev.input).toEqual({ file_path: '/tmp/x' });
  });

  it('maps Claude stream-json tool_result (status=done) to ok tool_call with output', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'Read',
      metadata: { output: 'file contents here', status: 'done' },
    };
    const ev = normalizeSessionChunk(chunk, 'claude');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.status).toBe('ok');
    expect(ev.output).toBe('file contents here');
  });

  it('maps Codex item/completed (status=done) to ok tool_call with input and output', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'Bash',
      metadata: { input: { command: 'ls' }, output: 'file1\nfile2', status: 'done' },
    };
    const ev = normalizeSessionChunk(chunk, 'codex');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.status).toBe('ok');
    expect(ev.input).toEqual({ command: 'ls' });
    expect(ev.output).toBe('file1\nfile2');
  });

  it('maps Gemini ACP session/update tool_call with toolCallId', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'Read a file',
      metadata: {
        toolCallId: 'tc_abc123',
        status: 'completed',
        input: { path: '/tmp/x' },
        output: 'done',
      },
    };
    const ev = normalizeSessionChunk(chunk, 'gemini');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.toolCallId).toBe('tc_abc123');
    expect(ev.status).toBe('ok');
  });

  it('maps in_progress status to running', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'Bash',
      metadata: { status: 'in_progress' },
    };
    const ev = normalizeSessionChunk(chunk, 'gemini');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.status).toBe('running');
  });

  it('maps failed status to error', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'Bash',
      metadata: { status: 'failed', error: 'command not found' },
    };
    const ev = normalizeSessionChunk(chunk, 'gemini');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.status).toBe('error');
    expect(ev.error).toBe('command not found');
  });

  it('maps denied status to rejected', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'Bash',
      metadata: { status: 'denied', toolCallId: 'tc-denied', terminalReason: 'denied' },
    };
    const ev = normalizeSessionChunk(chunk, 'codex');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.status).toBe('rejected');
    expect(ev.toolCallId).toBe('tc-denied');
    expect(ev.terminalReason).toBe('denied');
  });

  it('maps done chunks to turn_complete with null usage (CLI engines)', () => {
    const chunk: RawSessionChunk = { type: 'done', content: 'end_turn' };
    const ev = normalizeSessionChunk(chunk, 'claude');
    if (!ev || ev.kind !== 'turn_complete') throw new Error('wrong kind');
    expect(ev.stopReason).toBe('end_turn');
    expect(ev.usage).toBeNull();
  });

  it('maps error chunks to error events', () => {
    const chunk: RawSessionChunk = { type: 'error', content: 'rate limited' };
    const ev = normalizeSessionChunk(chunk, 'claude');
    if (!ev || ev.kind !== 'error') throw new Error('wrong kind');
    expect(ev.message).toBe('rate limited');
    expect(ev.recoverable).toBe(false);
  });

  it('returns null for status chunks (not agent-mode semantics)', () => {
    const chunk: RawSessionChunk = { type: 'status', content: 'thinking' };
    expect(normalizeSessionChunk(chunk, 'claude')).toBeNull();
  });

  it('falls back to "unknown" toolName when neither content nor metadata has it', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: '',
      metadata: { status: 'done' },
    };
    const ev = normalizeSessionChunk(chunk, 'codex');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.toolName).toBe('unknown');
  });

  it('prefers metadata.toolName over chunk.content when both present', () => {
    const chunk: RawSessionChunk = {
      type: 'tool_call',
      content: 'tool_display_title',
      metadata: { toolName: 'Bash', status: 'done' },
    };
    const ev = normalizeSessionChunk(chunk, 'gemini');
    if (!ev || ev.kind !== 'tool_call') throw new Error('wrong kind');
    expect(ev.toolName).toBe('Bash');
  });
});

describe('buildApiTurnEvents', () => {
  it('builds assistant_chunk + turn_complete for a response with no tools', () => {
    const events = buildApiTurnEvents('anthropic', 'the answer is 42', 0, 'stop', null);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('assistant_chunk');
    expect(events[1].kind).toBe('turn_complete');
  });

  it('includes a summary tool_call event when toolCalls > 0', () => {
    const events = buildApiTurnEvents('anthropic', 'done', 3, 'stop', null);
    expect(events).toHaveLength(3);
    expect(events[1].kind).toBe('tool_call');
    if (events[1].kind === 'tool_call') {
      expect(events[1].toolName).toContain('3');
    }
  });

  it('propagates usage to the turn_complete event', () => {
    const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150, source: 'sdk' as const };
    const events = buildApiTurnEvents('anthropic', 'hi', 0, 'stop', usage);
    const tc = events.find(e => e.kind === 'turn_complete');
    if (!tc || tc.kind !== 'turn_complete') throw new Error('no turn_complete');
    expect(tc.usage).toEqual(usage);
  });

  it('skips assistant_chunk when response is empty', () => {
    const events = buildApiTurnEvents('anthropic', '', 0, 'stop', null);
    expect(events.find(e => e.kind === 'assistant_chunk')).toBeUndefined();
    expect(events.find(e => e.kind === 'turn_complete')).toBeDefined();
  });
});

describe('usage helpers', () => {
  it('unavailableUsage returns a sentinel with source=unavailable', () => {
    expect(unavailableUsage()).toEqual({
      promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'unavailable',
    });
  });

  it('estimatedUsage uses the char/4 heuristic', () => {
    const u = estimatedUsage('a'.repeat(400), 'b'.repeat(800));
    expect(u.promptTokens).toBe(100);
    expect(u.completionTokens).toBe(200);
    expect(u.totalTokens).toBe(300);
    expect(u.source).toBe('estimated');
  });
});
