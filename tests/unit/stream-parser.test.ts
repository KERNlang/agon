import { describe, it, expect } from 'vitest';
import { StreamParser, parseStreamChunk } from '@agon/core';

describe('StreamParser', () => {
  describe('feed — single complete lines', () => {
    it('parses Claude assistant message', () => {
      const parser = new StreamParser();
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      });
      const results = parser.feed(json + '\n');
      expect(results).toEqual([{ type: 'text', content: 'Hello world' }]);
    });

    it('parses Claude result message', () => {
      const parser = new StreamParser();
      const json = JSON.stringify({ type: 'result', result: 'Final answer' });
      const results = parser.feed(json + '\n');
      expect(results).toEqual([{ type: 'result', content: 'Final answer' }]);
    });

    it('parses Claude system status', () => {
      const parser = new StreamParser();
      const json = JSON.stringify({ type: 'system', message: 'Thinking...' });
      const results = parser.feed(json + '\n');
      expect(results).toEqual([{ type: 'status', content: 'Thinking...' }]);
    });

    it('parses raw text from Codex/Gemini', () => {
      const parser = new StreamParser();
      const results = parser.feed('This is raw output\n');
      expect(results).toEqual([{ type: 'raw', content: 'This is raw output' }]);
    });

    it('skips empty lines', () => {
      const parser = new StreamParser();
      const json = JSON.stringify({ type: 'system', message: 'ok' });
      const results = parser.feed('\n\n' + json + '\n\n');
      expect(results).toEqual([{ type: 'status', content: 'ok' }]);
    });
  });

  describe('feed — JSON split across multiple chunks (the bug case)', () => {
    it('handles JSON object split at arbitrary point', () => {
      const parser = new StreamParser();
      const full = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Split test' }] },
      });
      const mid = Math.floor(full.length / 2);

      // First chunk: partial JSON, no newline
      const r1 = parser.feed(full.slice(0, mid));
      expect(r1).toEqual([]); // Nothing complete yet

      // Second chunk: rest of JSON + newline
      const r2 = parser.feed(full.slice(mid) + '\n');
      expect(r2).toEqual([{ type: 'text', content: 'Split test' }]);
    });

    it('handles JSON split across 3 chunks', () => {
      const parser = new StreamParser();
      const full = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Three-way split' }] },
      });
      const third = Math.floor(full.length / 3);

      const r1 = parser.feed(full.slice(0, third));
      expect(r1).toEqual([]);

      const r2 = parser.feed(full.slice(third, third * 2));
      expect(r2).toEqual([]);

      const r3 = parser.feed(full.slice(third * 2) + '\n');
      expect(r3).toEqual([{ type: 'text', content: 'Three-way split' }]);
    });

    it('handles multiple complete objects then a split', () => {
      const parser = new StreamParser();
      const obj1 = JSON.stringify({ type: 'system', message: 'First' });
      const obj2 = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Second' }] },
      });
      const mid = Math.floor(obj2.length / 2);

      // First chunk: complete obj1 + partial obj2
      const r1 = parser.feed(obj1 + '\n' + obj2.slice(0, mid));
      expect(r1).toEqual([{ type: 'status', content: 'First' }]);

      // Second chunk: rest of obj2
      const r2 = parser.feed(obj2.slice(mid) + '\n');
      expect(r2).toEqual([{ type: 'text', content: 'Second' }]);
    });
  });

  describe('flush', () => {
    it('processes remaining buffer as raw text', () => {
      const parser = new StreamParser();
      parser.feed('incomplete raw text');
      const results = parser.flush();
      expect(results).toEqual([{ type: 'raw', content: 'incomplete raw text' }]);
    });

    it('processes remaining buffer as complete JSON', () => {
      const parser = new StreamParser();
      const json = JSON.stringify({ type: 'system', message: 'done' });
      parser.feed(json); // no trailing newline
      const results = parser.flush();
      expect(results).toEqual([{ type: 'status', content: 'done' }]);
    });

    it('returns empty for empty buffer', () => {
      const parser = new StreamParser();
      expect(parser.flush()).toEqual([]);
    });

    it('clears buffer after flush', () => {
      const parser = new StreamParser();
      parser.feed('some text');
      parser.flush();
      expect(parser.flush()).toEqual([]);
    });
  });

  describe('multiple objects in single chunk', () => {
    it('parses multiple NDJSON lines in one chunk', () => {
      const parser = new StreamParser();
      const line1 = JSON.stringify({ type: 'system', message: 'Starting' });
      const line2 = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Answer' }] },
      });
      const results = parser.feed(line1 + '\n' + line2 + '\n');
      expect(results).toEqual([
        { type: 'status', content: 'Starting' },
        { type: 'text', content: 'Answer' },
      ]);
    });
  });

  describe('error handling', () => {
    it('captures error from result message', () => {
      const parser = new StreamParser();
      const json = JSON.stringify({ type: 'result', result: 'Reached max turns', is_error: true });
      const results = parser.feed(json + '\n');
      expect(results).toContainEqual({ type: 'result', content: 'Reached max turns' });
      expect(results).toContainEqual({ type: 'status', content: 'Reached max turns' });
    });

    it('skips unknown JSON types', () => {
      const parser = new StreamParser();
      const json = JSON.stringify({ type: 'unknown_event', data: 'something' });
      const results = parser.feed(json + '\n');
      expect(results).toEqual([]);
    });

    it('preserves a JSON ARRAY line as raw text (kimi findings block was being dropped)', () => {
      const parser = new StreamParser();
      const arr = '[{"file":"a.ts","severity":"blocking","blocking":true}]';
      const results = parser.feed(arr + '\n');
      expect(results).toEqual([{ type: 'raw', content: arr }]);
    });

    it('preserves a JSON object with NO string type field as raw text', () => {
      const parser = new StreamParser();
      const obj = '{"file":"a.ts","problem":"x"}';
      const results = parser.feed(obj + '\n');
      expect(results).toEqual([{ type: 'raw', content: obj }]);
    });

    it('skips an object with a non-string type (malformed envelope, not content)', () => {
      const parser = new StreamParser();
      expect(parser.feed('{"type":null,"data":1}\n')).toEqual([]);
      expect(parser.feed('{"type":123,"data":1}\n')).toEqual([]);
    });

    it('skips bare JSON primitives (number/string/bool/null) as before', () => {
      const parser = new StreamParser();
      expect(parser.feed('42\n')).toEqual([]);
      expect(parser.feed('true\n')).toEqual([]);
      expect(parser.feed('"hello"\n')).toEqual([]);
      expect(parser.feed('null\n')).toEqual([]);
    });
  });

  describe('parseStreamChunk — backward compat wrapper', () => {
    it('works identically for single-chunk input', () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Wrapper test' }] },
      });
      const results = parseStreamChunk(json + '\n');
      expect(results).toEqual([{ type: 'text', content: 'Wrapper test' }]);
    });

    it('handles raw text', () => {
      const results = parseStreamChunk('Raw Codex output\n');
      expect(results).toEqual([{ type: 'raw', content: 'Raw Codex output' }]);
    });

    it('handles input without trailing newline via flush', () => {
      const json = JSON.stringify({ type: 'system', message: 'no newline' });
      const results = parseStreamChunk(json);
      expect(results).toEqual([{ type: 'status', content: 'no newline' }]);
    });
  });
});
