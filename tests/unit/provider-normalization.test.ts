import { describe, it, expect } from 'vitest';

// Import via the facade — convertMessagesForSdk is exported from api-dispatch
import { convertMessagesForSdk } from '../../packages/core/src/generated/api/dispatch.js';

describe('provider-aware message normalization', () => {
  const baseMessages = [
    { role: 'system', content: 'You are helpful' },
    { role: 'user', content: 'Read src/foo.ts' },
    {
      role: 'assistant', content: null,
      tool_calls: [{
        id: 'call_abc-123.def',
        type: 'function',
        function: { name: 'Read', arguments: '{"file_path":"src/foo.ts"}' },
      }],
    },
    { role: 'tool', content: 'file contents here', tool_call_id: 'call_abc-123.def' },
  ];

  it('normalizes Anthropic tool call IDs to alphanumeric + underscore', () => {
    const result = convertMessagesForSdk(baseMessages as any, 'anthropic');
    // Find the assistant message with tool calls
    const assistant = result.find((m: any) => m.role === 'assistant' && Array.isArray(m.content));
    expect(assistant).toBeDefined();
    const toolCall = assistant.content.find((p: any) => p.type === 'tool-call');
    expect(toolCall).toBeDefined();
    // Hyphens and dots should be replaced with underscores
    expect(toolCall.toolCallId).not.toContain('-');
    expect(toolCall.toolCallId).not.toContain('.');
    expect(toolCall.toolCallId).toMatch(/^[a-zA-Z0-9_]+$/);

    // Tool result should use the same normalized ID
    const toolResult = result.find((m: any) => m.role === 'tool');
    expect(toolResult).toBeDefined();
    const toolResultContent = toolResult.content[0];
    expect(toolResultContent.toolCallId).toBe(toolCall.toolCallId);
  });

  it('normalizes Mistral tool call IDs to max 9 chars', () => {
    const result = convertMessagesForSdk(baseMessages as any, 'mistral');
    const assistant = result.find((m: any) => m.role === 'assistant' && Array.isArray(m.content));
    const toolCall = assistant.content.find((p: any) => p.type === 'tool-call');
    expect(toolCall.toolCallId.length).toBeLessThanOrEqual(9);
    expect(toolCall.toolCallId).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('inserts dummy assistant between consecutive Mistral tool results', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      {
        role: 'assistant', content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } },
          { id: 'c2', type: 'function', function: { name: 'Read', arguments: '{"file_path":"b.ts"}' } },
        ],
      },
      { role: 'tool', content: 'content a', tool_call_id: 'c1' },
      { role: 'tool', content: 'content b', tool_call_id: 'c2' },
    ];
    const result = convertMessagesForSdk(msgs as any, 'mistral');
    // Should have a dummy assistant between the two tool results
    let foundDummy = false;
    for (let i = 1; i < result.length; i++) {
      if (result[i].role === 'tool' && result[i - 1].role === 'assistant' && result[i - 1].content === '') {
        foundDummy = true;
        break;
      }
    }
    expect(foundDummy).toBe(true);
  });

  it('passes through IDs unchanged for OpenAI format', () => {
    const result = convertMessagesForSdk(baseMessages as any, undefined);
    const assistant = result.find((m: any) => m.role === 'assistant' && Array.isArray(m.content));
    const toolCall = assistant.content.find((p: any) => p.type === 'tool-call');
    // Should keep original ID format
    expect(toolCall.toolCallId).toBe('call_abc-123.def');
  });

  it('handles empty messages gracefully', () => {
    const result = convertMessagesForSdk([], undefined);
    expect(result).toEqual([]);
  });

  it('handles assistant with text only (no tool calls)', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const result = convertMessagesForSdk(msgs as any, 'anthropic');
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('assistant');
  });

  it('handles malformed tool call arguments gracefully', () => {
    const msgs = [
      { role: 'user', content: 'task' },
      {
        role: 'assistant', content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: 'not json' } }],
      },
    ];
    // Should not throw
    const result = convertMessagesForSdk(msgs as any, 'anthropic');
    expect(result).toHaveLength(2);
    const toolCall = result[1].content.find((p: any) => p.type === 'tool-call');
    expect(toolCall).toBeDefined();
    // Args should be empty object (fallback)
    expect(toolCall.input).toEqual({});
  });
});
