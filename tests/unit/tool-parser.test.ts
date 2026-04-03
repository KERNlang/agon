import { describe, it, expect } from 'vitest';
import { parseToolCalls, formatToolResult, formatToolResults, toolCallsToApiFormat } from '@agon/core';

describe('tool-parser', () => {
  describe('parseToolCalls', () => {
    it('returns no tool calls for plain text', () => {
      const result = parseToolCalls('Just a regular response with no tools.');
      expect(result.hasToolCalls).toBe(false);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.textBefore).toBe('Just a regular response with no tools.');
    });

    it('parses a single tool call', () => {
      const text = 'Let me read that file.\n<tool name="Read">\n{"file_path": "src/app.ts"}\n</tool>';
      const result = parseToolCalls(text);
      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('Read');
      expect(result.toolCalls[0].input).toEqual({ file_path: 'src/app.ts' });
      expect(result.textBefore).toBe('Let me read that file.');
    });

    it('parses multiple tool calls', () => {
      const text = 'Checking files.\n<tool name="Read">\n{"file_path": "a.ts"}\n</tool>\n<tool name="Grep">\n{"pattern": "TODO"}\n</tool>';
      const result = parseToolCalls(text);
      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe('Read');
      expect(result.toolCalls[1].name).toBe('Grep');
    });

    it('handles JSON with markdown code fences', () => {
      const text = '<tool name="Bash">\n```json\n{"command": "npm test"}\n```\n</tool>';
      const result = parseToolCalls(text);
      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls[0].input).toEqual({ command: 'npm test' });
    });

    it('captures text after tool calls', () => {
      const text = '<tool name="Read">\n{"file_path": "x.ts"}\n</tool>\nHere are my findings.';
      const result = parseToolCalls(text);
      expect(result.textAfter).toBe('Here are my findings.');
    });

    it('handles unclosed tool tag gracefully', () => {
      const text = 'Text before.\n<tool name="Read">\n{"file_path": "x.ts"}';
      const result = parseToolCalls(text);
      expect(result.hasToolCalls).toBe(false);
    });

    it('skips malformed JSON', () => {
      const text = '<tool name="Read">\nnot valid json\n</tool>';
      const result = parseToolCalls(text);
      expect(result.hasToolCalls).toBe(false);
    });

    it('parses tool call with extra whitespace', () => {
      const text = '<tool name="Edit">  \n  {"file_path": "a.ts", "old_string": "x", "new_string": "y"}  \n</tool>';
      const result = parseToolCalls(text);
      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls[0].input.file_path).toBe('a.ts');
    });
  });

  describe('toolCallsToApiFormat', () => {
    it('converts parsed calls to ToolCall format with IDs', () => {
      const parsed = [
        { name: 'Read', input: { file_path: 'x.ts' }, startIndex: 0, endIndex: 50 },
      ];
      const calls = toolCallsToApiFormat(parsed);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('Read');
      expect(calls[0].id).toMatch(/^tc_/);
    });
  });

  describe('formatToolResult', () => {
    it('formats successful result', () => {
      const result = formatToolResult('Read', 'file contents here');
      expect(result).toContain('<tool_result name="Read">');
      expect(result).toContain('file contents here');
      expect(result).toContain('</tool_result>');
      expect(result).not.toContain('error');
    });

    it('formats error result', () => {
      const result = formatToolResult('Read', 'File not found', true);
      expect(result).toContain('error="true"');
      expect(result).toContain('File not found');
    });
  });

  describe('formatToolResults', () => {
    it('formats multiple results', () => {
      const results = [
        { name: 'Read', content: 'contents' },
        { name: 'Grep', content: 'matches', error: undefined },
      ];
      const formatted = formatToolResults(results);
      expect(formatted).toContain('<tool_result name="Read">');
      expect(formatted).toContain('<tool_result name="Grep">');
    });
  });
});
