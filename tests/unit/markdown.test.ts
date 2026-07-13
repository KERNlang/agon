import { describe, it, expect } from 'vitest';
import { cleanEngineOutput, parseMarkdownBlocks } from '../../packages/cli/src/markdown.js';

describe('parseMarkdownBlocks', () => {
  it('prose only → single prose segment', () => {
    const result = parseMarkdownBlocks('Hello world\nSecond line');
    expect(result).toEqual([{ type: 'prose', text: 'Hello world\nSecond line' }]);
  });

  it('single code block with language', () => {
    const input = 'Before\n```ts\nconst x = 1;\n```\nAfter';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'prose', text: 'Before' },
      { type: 'code', language: 'ts', code: 'const x = 1;', index: 1 },
      { type: 'prose', text: 'After' },
    ]);
  });

  it('no language label → language is empty string', () => {
    const input = '```\nplain code\n```';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'code', language: '', code: 'plain code', index: 1 },
    ]);
  });

  it('indented fence (2 spaces) → detected', () => {
    const input = 'text\n  ```typescript\n  const y = 2;\n  ```\nmore text';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'prose', text: 'text' },
      { type: 'code', language: 'typescript', code: '  const y = 2;', index: 1 },
      { type: 'prose', text: 'more text' },
    ]);
  });

  it('``` mid-sentence → NOT treated as fence', () => {
    const input = 'Use ```code``` for inline code';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'prose', text: 'Use ```code``` for inline code' },
    ]);
  });

  it('code containing backticks in strings → not falsely closed', () => {
    const input = '```js\nconst s = "use `backticks` here";\n```';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'code', language: 'js', code: 'const s = "use `backticks` here";', index: 1 },
    ]);
  });

  it('unclosed fence at end → auto-closed', () => {
    const input = 'Before\n```python\ndef hello():\n  pass';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'prose', text: 'Before' },
      { type: 'code', language: 'python', code: 'def hello():\n  pass', index: 1 },
    ]);
  });

  it('adjacent blocks → separate segments', () => {
    const input = '```ts\nconst a = 1;\n```\n```js\nconst b = 2;\n```';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'code', language: 'ts', code: 'const a = 1;', index: 1 },
      { type: 'code', language: 'js', code: 'const b = 2;', index: 2 },
    ]);
  });

  it('empty code block → skipped', () => {
    const input = 'Before\n```ts\n```\nAfter';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'prose', text: 'Before' },
      { type: 'prose', text: 'After' },
    ]);
  });

  it('all-code response (no prose) → single code segment', () => {
    const input = '```ts\nconst x = 1;\nconst y = 2;\n```';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'code', language: 'ts', code: 'const x = 1;\nconst y = 2;', index: 1 },
    ]);
  });

  it('code block with trailing whitespace on fence closer', () => {
    const input = '```ts\ncode\n```   ';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'code', language: 'ts', code: 'code', index: 1 },
    ]);
  });

  it('fence with extra text after language is NOT a fence', () => {
    // ```ts some extra text → not a valid fence opener
    const input = 'text\n```ts some extra text\nmore text';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'prose', text: 'text\n```ts some extra text\nmore text' },
    ]);
  });

  it('diff code block preserves +/- lines', () => {
    const input = '```diff\n- old line\n+ new line\n@@ -1,3 +1,3 @@\n context\n```';
    const result = parseMarkdownBlocks(input);
    expect(result).toEqual([
      { type: 'code', language: 'diff', code: '- old line\n+ new line\n@@ -1,3 +1,3 @@\n context', index: 1 },
    ]);
  });

  it('detects a markdown table', () => {
    const input = '| Name | Score |\n|------|-------|\n| Alice | 90 |\n| Bob | 85 |';
    const result = parseMarkdownBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('table');
    if (result[0].type === 'table') {
      expect(result[0].headers).toEqual(['Name', 'Score']);
      expect(result[0].rows).toHaveLength(2);
      expect(result[0].rows[0]).toEqual(['Alice', '90']);
    }
  });

  it('table between prose paragraphs', () => {
    const input = 'Before text\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter text';
    const result = parseMarkdownBlocks(input);
    expect(result.length).toBe(3);
    expect(result[0].type).toBe('prose');
    expect(result[1].type).toBe('table');
    expect(result[2].type).toBe('prose');
  });

  it('non-table pipe usage stays as prose', () => {
    const input = 'Use the | operator for bitwise OR';
    const result = parseMarkdownBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('prose');
  });

  it('table with alignment markers', () => {
    const input = '| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |';
    const result = parseMarkdownBlocks(input);
    expect(result).toHaveLength(1);
    if (result[0].type === 'table') {
      expect(result[0].alignments).toEqual(['left', 'center', 'right']);
    }
  });
});

describe('cleanEngineOutput', () => {
  it('strips multiline tool and reasoning tags containing Unicode whitespace', () => {
    const tagged = '<tool_calls><tool_result>hidden\u00a0payload\u2028line</tool_result></tool_calls>\u3000Final answer.';
    expect(cleanEngineOutput(tagged)).toBe('Final answer.');
  });
});
