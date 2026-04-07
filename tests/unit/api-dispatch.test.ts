import { describe, it, expect } from 'vitest';
import { convertMessagesForSdk, convertToolsForSdk, buildModel } from '../../packages/core/src/generated/api-dispatch.js';

describe('api-dispatch — AI SDK message conversion', () => {
  it('converts simple user/assistant messages', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
    ]);
  });

  it('converts assistant message with tool_calls using input (not args)', () => {
    const messages = [
      { role: 'user', content: 'Read the file' },
      {
        role: 'assistant',
        content: 'Let me read that.',
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"/tmp/test.ts"}' },
        }],
      },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read that.' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'Read',
          input: { file_path: '/tmp/test.ts' },
        },
      ],
    });
  });

  it('converts tool result using output (not result)', () => {
    const messages = [
      { role: 'user', content: 'Read it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"/tmp/test.ts"}' },
        }],
      },
      { role: 'tool', content: 'file contents here', tool_call_id: 'call_1' },
    ];
    const result = convertMessagesForSdk(messages);
    // Assistant with null content should only have tool-call parts
    expect(result[1].content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'Read',
        input: { file_path: '/tmp/test.ts' },
      },
    ]);
    // Tool result should use 'output' as {type:'text', value:...} (AI SDK v6 outputSchema)
    expect(result[2]).toEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'Read',
        output: { type: 'text', value: 'file contents here' },
      }],
    });
  });

  it('handles multiple tool calls in one assistant message', () => {
    const messages = [
      { role: 'user', content: 'Read both files' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } },
          { id: 'call_2', type: 'function', function: { name: 'Read', arguments: '{"file_path":"b.ts"}' } },
        ],
      },
      { role: 'tool', content: 'contents of a', tool_call_id: 'call_1' },
      { role: 'tool', content: 'contents of b', tool_call_id: 'call_2' },
    ];
    const result = convertMessagesForSdk(messages);
    // Both tool results should have correct toolName resolved from assistant tool_calls
    expect(result[2].content[0].toolName).toBe('Read');
    expect(result[3].content[0].toolName).toBe('Read');
    expect(result[2].content[0].output).toEqual({ type: 'text', value: 'contents of a' });
    expect(result[3].content[0].output).toEqual({ type: 'text', value: 'contents of b' });
  });

  it('handles already-parsed tool arguments (object, not string)', () => {
    const messages = [
      { role: 'user', content: 'test' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'Grep', arguments: { pattern: 'foo', path: '/tmp' } },
        }],
      },
    ];
    const result = convertMessagesForSdk(messages);
    expect(result[1].content[0].input).toEqual({ pattern: 'foo', path: '/tmp' });
  });
});

describe('api-dispatch — AI SDK tool conversion', () => {
  it('converts OpenAI-format tools with parameters (not inputSchema)', () => {
    const tools = [{
      type: 'function',
      function: {
        name: 'Read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    }];
    const result = convertToolsForSdk(tools);
    expect(result).toHaveProperty('Read');
    expect(result.Read.description).toBe('Read a file');
    // AI SDK tool uses 'inputSchema' (not 'parameters') — provider reads tool.inputSchema
    expect(result.Read.inputSchema).toBeDefined();
    // Should NOT have 'execute' — tool execution is handled by persistent-session
    expect(result.Read.execute).toBeUndefined();
  });
});

describe('api-dispatch — provider creation', () => {
  it('returns null when API key is missing', () => {
    const config = { baseUrl: 'https://example.com', apiKeyEnv: 'NONEXISTENT_KEY_12345', model: 'test' };
    const result = buildModel(config);
    expect(result).toBeNull();
  });
});
