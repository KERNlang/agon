import { describe, it, expect } from 'vitest';
import { classifyLine, parseInlineSpans, richWrap, parseProseToRichLines } from '../../packages/cli/src/rich-text.js';

describe('classifyLine', () => {
  it('detects h1', () => {
    const r = classifyLine('# Hello');
    expect(r.kind).toBe('h1');
    expect(r.content).toBe('Hello');
  });

  it('detects h2', () => {
    const r = classifyLine('## Sub heading');
    expect(r.kind).toBe('h2');
    expect(r.content).toBe('Sub heading');
  });

  it('detects h3', () => {
    const r = classifyLine('### Third level');
    expect(r.kind).toBe('h3');
    expect(r.content).toBe('Third level');
  });

  it('detects bullet list', () => {
    const r = classifyLine('- item one');
    expect(r.kind).toBe('bullet');
    expect(r.content).toBe('item one');
    expect(r.marker).toBe('• ');
  });

  it('detects ordered list', () => {
    const r = classifyLine('1. first step');
    expect(r.kind).toBe('ordered');
    expect(r.content).toBe('first step');
    expect(r.marker).toBe('1. ');
  });

  it('detects blockquote', () => {
    const r = classifyLine('> quoted text');
    expect(r.kind).toBe('blockquote');
    expect(r.content).toBe('quoted text');
  });

  it('detects horizontal rule ---', () => {
    expect(classifyLine('---').kind).toBe('hr');
    expect(classifyLine('***').kind).toBe('hr');
    expect(classifyLine('___').kind).toBe('hr');
  });

  it('detects blank line', () => {
    expect(classifyLine('').kind).toBe('blank');
    expect(classifyLine('   ').kind).toBe('blank');
  });

  it('returns plain for normal text', () => {
    const r = classifyLine('Hello world');
    expect(r.kind).toBe('plain');
    expect(r.content).toBe('Hello world');
  });

  it('detects indented bullets', () => {
    const r = classifyLine('  - nested');
    expect(r.kind).toBe('bullet');
    expect(r.indent).toBe(1);
  });

  it('recognizes ECMAScript Unicode whitespace after markdown markers', () => {
    expect(classifyLine('#\u00a0Heading')).toMatchObject({ kind: 'h1', content: 'Heading' });
    expect(classifyLine('-\u3000item')).toMatchObject({ kind: 'bullet', content: 'item' });
    expect(classifyLine('>\u2028quoted')).toMatchObject({ kind: 'blockquote', content: 'quoted' });
  });
});

describe('parseInlineSpans', () => {
  it('returns plain text as single span', () => {
    const spans = parseInlineSpans('Hello world');
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('Hello world');
    expect(spans[0].style.bold).toBe(false);
  });

  it('parses bold **text**', () => {
    const spans = parseInlineSpans('Hello **bold** world');
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const boldSpan = spans.find(s => s.style.bold);
    expect(boldSpan).toBeDefined();
    expect(boldSpan!.text).toBe('bold');
  });

  it('parses italic *text*', () => {
    const spans = parseInlineSpans('Hello *italic* world');
    const italicSpan = spans.find(s => s.style.italic);
    expect(italicSpan).toBeDefined();
    expect(italicSpan!.text).toBe('italic');
  });

  it('parses inline code `text`', () => {
    const spans = parseInlineSpans('Use `npm install` here');
    const codeSpan = spans.find(s => s.style.code);
    expect(codeSpan).toBeDefined();
    expect(codeSpan!.text).toBe('npm install');
  });

  it('parses links [text](url)', () => {
    const spans = parseInlineSpans('See [docs](https://example.com) for more');
    const linkSpan = spans.find(s => s.style.linkUrl);
    expect(linkSpan).toBeDefined();
    expect(linkSpan!.text).toBe('docs');
    expect(linkSpan!.style.linkUrl).toBe('https://example.com');
  });

  it('handles bold+italic ***text***', () => {
    const spans = parseInlineSpans('***important***');
    const biSpan = spans.find(s => s.style.bold && s.style.italic);
    expect(biSpan).toBeDefined();
    expect(biSpan!.text).toBe('important');
  });

  it('handles empty text', () => {
    const spans = parseInlineSpans('');
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('');
  });

  it('preserves underscores in snake_case', () => {
    const spans = parseInlineSpans('use my_var_name here');
    const allText = spans.map(s => s.text).join('');
    expect(allText).toContain('my_var_name');
  });
});

describe('richWrap', () => {
  const plain = { bold: false, italic: false, code: false, dimColor: false, linkUrl: undefined };

  it('returns single line when text fits', () => {
    const spans = [{ text: 'Hello world', style: plain }];
    const lines = richWrap(spans, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0][0].text).toBe('Hello world');
  });

  it('wraps long text across lines', () => {
    const spans = [{ text: 'The quick brown fox jumps over the lazy dog', style: plain }];
    const lines = richWrap(spans, 20);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('preserves styles across wrap', () => {
    const boldStyle = { ...plain, bold: true };
    const spans = [
      { text: 'Normal ', style: plain },
      { text: 'bold text that is quite long and should wrap', style: boldStyle },
    ];
    const lines = richWrap(spans, 25);
    expect(lines.length).toBeGreaterThan(1);
    // Bold spans should exist in wrapped output
    const hasBold = lines.some(line => line.some(s => s.style.bold));
    expect(hasBold).toBe(true);
  });
});

describe('parseProseToRichLines', () => {
  it('parses a simple paragraph', () => {
    const lines = parseProseToRichLines('Hello world', 80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].kind).toBe('plain');
  });

  it('parses headers', () => {
    const lines = parseProseToRichLines('## My Header\n\nSome text', 80);
    const h2 = lines.find(l => l.kind === 'h2');
    expect(h2).toBeDefined();
  });

  it('parses bullets', () => {
    const lines = parseProseToRichLines('- item one\n- item two', 80);
    const bullets = lines.filter(l => l.kind === 'bullet');
    expect(bullets).toHaveLength(2);
  });

  it('parses horizontal rules', () => {
    const lines = parseProseToRichLines('Before\n---\nAfter', 80);
    const hr = lines.find(l => l.kind === 'hr');
    expect(hr).toBeDefined();
  });

  it('handles empty text', () => {
    const lines = parseProseToRichLines('', 80);
    expect(lines).toHaveLength(0);
  });

  it('handles mixed content', () => {
    const input = '## Title\n\nSome **bold** text.\n\n- bullet one\n- bullet two\n\n> A quote\n\n---';
    const lines = parseProseToRichLines(input, 80);
    expect(lines.find(l => l.kind === 'h2')).toBeDefined();
    expect(lines.filter(l => l.kind === 'bullet')).toHaveLength(2);
    expect(lines.find(l => l.kind === 'blockquote')).toBeDefined();
    expect(lines.find(l => l.kind === 'hr')).toBeDefined();
  });
});
