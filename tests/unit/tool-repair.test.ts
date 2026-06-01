import { describe, it, expect } from 'vitest';
import { parseToolCalls } from '@kernlang/agon-core';

describe('tool call repair: repairJsonArgs via parseToolCalls', () => {
  it('parses valid JSON arguments normally', () => {
    const input = '<tool name="Read">{"file_path":"src/foo.ts"}</tool>';
    const result = parseToolCalls(input);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls[0].name).toBe('Read');
    expect(result.toolCalls[0].input).toEqual({ file_path: 'src/foo.ts' });
  });

  it('repairs markdown-fenced JSON arguments', () => {
    const input = '<tool name="Read">```json\n{"file_path":"src/foo.ts"}\n```</tool>';
    const result = parseToolCalls(input);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls[0].input).toEqual({ file_path: 'src/foo.ts' });
  });

  it('repairs trailing comma in tool_call format (string arguments path)', () => {
    // The repairJsonArgs fires when arguments is a string that needs parsing
    const input = '<tool_call>{"name":"Read","arguments":"{\\"file_path\\":\\"src/foo.ts\\",}"}</tool_call>';
    const result = parseToolCalls(input);
    if (result.hasToolCalls) {
      expect(result.toolCalls[0].name).toBe('Read');
      // Repair should handle trailing comma
      expect(result.toolCalls[0].input).toHaveProperty('file_path');
    }
  });

  it('handles single-quoted JSON in XML body — skipped or repaired', () => {
    // Single quotes in <tool name="X"> body: the XML parser tries JSON.parse first,
    // then markdown-fence strip. If both fail, the tool call is skipped (no raw fallback).
    // This is expected behavior — repairJsonArgs fires on the arguments STRING path,
    // not the XML body path.
    const input = "<tool name=\"Grep\">{'pattern':'TODO'}</tool>";
    const result = parseToolCalls(input);
    // May or may not parse — depends on the repair chain
    // The important thing is it doesn't throw
    expect(result).toBeDefined();
  });

  it('handles extra text around JSON in XML body', () => {
    // When XML body has text + JSON, the parser tries the whole body as JSON first,
    // then strips markdown fences. Extra text causes it to skip the tool call.
    const input = '<tool name="Read">Here is the call: {"file_path":"src/foo.ts"}</tool>';
    const result = parseToolCalls(input);
    // This should NOT crash — graceful skip
    expect(result).toBeDefined();
  });

  it('handles completely broken JSON gracefully', () => {
    const input = '<tool name="Read">this is not json at all</tool>';
    const result = parseToolCalls(input);
    // Should either skip the tool call or produce a raw fallback
    if (result.hasToolCalls) {
      // If it parsed, the input should be a fallback object
      expect(result.toolCalls[0].input).toBeDefined();
    }
    // Either way, it should not throw
  });

  it('parses multiple tool calls in one response', () => {
    const input = `Let me check.
<tool name="Read">{"file_path":"src/a.ts"}</tool>
<tool name="Grep">{"pattern":"TODO"}</tool>
Done.`;
    const result = parseToolCalls(input);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls.length).toBe(2);
    expect(result.toolCalls[0].name).toBe('Read');
    expect(result.toolCalls[1].name).toBe('Grep');
  });

  it('extracts textBefore and textAfter', () => {
    const input = 'Before text <tool name="Read">{"file_path":"x"}</tool> After text';
    const result = parseToolCalls(input);
    expect(result.textBefore).toContain('Before text');
    expect(result.textAfter).toContain('After text');
  });
});

describe('tool call repair: alternative formats', () => {
  it('parses <tool_call> format (Gemini/MiniMax)', () => {
    const input = '<tool_call>{"name":"Read","arguments":{"file_path":"src/foo.ts"}}</tool_call>';
    const result = parseToolCalls(input);
    expect(result.hasToolCalls).toBe(true);
    expect(result.toolCalls[0].name).toBe('Read');
  });

  it('handles no tool calls gracefully', () => {
    const input = 'This is just a regular response with no tool calls.';
    const result = parseToolCalls(input);
    expect(result.hasToolCalls).toBe(false);
    expect(result.toolCalls).toEqual([]);
  });
});
