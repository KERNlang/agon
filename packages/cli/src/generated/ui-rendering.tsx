import React from 'react';

import { Box, Text } from 'ink';

import { truncateCodeLine } from '../markdown.js';

import type { ContentSegment } from '../markdown.js';

import { parseProseToRichLines } from '../rich-text.js';

import type { InlineSpan, RichLine } from '../rich-text.js';

import { ENGINE_COLORS } from '../generated/output.js';

import { parseAnsiText, hasAnsiCodes, stripAnsi } from '../generated/ansi-parse.js';

import type { AnsiSegment } from '../generated/ansi-parse.js';

export function contentWidth(padding: number): number {
  const termWidth = process.stdout.columns || 100;
  return Math.min(Math.max(termWidth - padding, 40), 100);
}

export function color256toHex(code: number): string {
  const basic16: Record<number, string> = {
    0: '#000000', 1: '#aa0000', 2: '#00aa00', 3: '#aa5500', 4: '#0000aa',
    5: '#aa00aa', 6: '#00aaaa', 7: '#aaaaaa', 8: '#555555', 9: '#ff5555',
    10: '#55ff55', 11: '#ffff55', 12: '#5555ff', 13: '#ff55ff', 14: '#55ffff', 15: '#ffffff',
  };
  if (code < 16) return basic16[code] ?? '#ffffff';
  if (code >= 232) {
    const gray = 8 + (code - 232) * 10;
    const h = Math.min(255, gray).toString(16).padStart(2, '0');
    return `#${h}${h}${h}`;
  }
  const idx = code - 16;
  const r = Math.floor(idx / 36);
  const g = Math.floor((idx % 36) / 6);
  const b = idx % 6;
  const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function engineColor(id: string): string {
  return color256toHex(ENGINE_COLORS[id] ?? 245);
}

export const CODE_RAIL: string = '\u258c';

export const CODE_RAIL_COLOR: string = '#585858';

export const MAX_CODE_LINES: number = 60;

export const SYN_KEYWORD: string = '#c084fc';

export const SYN_STRING: string = '#4ade80';

export const SYN_COMMENT: string = '#6b7280';

export const SYN_NUMBER: string = '#fb923c';

export const SYN_TYPE: string = '#38bdf8';

export const SYN_PUNCT: string = '#94a3b8';

export const SYN_FN: string = '#fbbf24';

export const KEYWORDS: Set<string> = new Set([
  'const','let','var','function','return','if','else','for','while','do','switch','case','break','continue',
  'class','extends','implements','new','this','super','import','export','from','default','async','await',
  'try','catch','finally','throw','typeof','instanceof','in','of','yield','void','delete',
  'interface','type','enum','namespace','abstract','private','public','protected','static','readonly',
  'fn','struct','impl','pub','mod','use','crate','self','mut','ref','match','loop','move',
  'def','elif','pass','with','as','is','not','and','or','lambda','nonlocal','global',
  'true','false','null','undefined','nil','None','True','False',
]);

export const TYPES: Set<string> = new Set([
  'string','number','boolean','object','any','void','never','unknown','bigint','symbol',
  'String','Number','Boolean','Object','Array','Map','Set','Promise','Record','Partial',
  'int','float','double','char','long','short','byte','i32','u32','i64','u64','f64','f32','usize','isize','bool',
  'str','Vec','Option','Result','Box','Rc','Arc',
]);

export interface SyntaxToken {
  text: string;
  color?: string;
}

export function tokenizeLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const pattern = /\/\/.*$|\/\*.*?\*\/|#.*$|""".*?"""|'''.*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[a-zA-Z_$]\w*(?=\s*\()|[a-zA-Z_$]\w*|[{}()\[\];:,.<>=!&|?+\-*/%^~@]|\s+/g;
  
  let match;
  let lastIndex = 0;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index) });
    }
    lastIndex = match.index + match[0].length;
  
    const text = match[0];
  
    if (text.startsWith('//') || text.startsWith('#') || text.startsWith('/*')) {
      tokens.push({ text, color: SYN_COMMENT });
    }
    else if (/^["'`]/.test(text) || text.startsWith('"""') || text.startsWith("'''")) {
      tokens.push({ text, color: SYN_STRING });
    }
    else if (/^\d/.test(text)) {
      tokens.push({ text, color: SYN_NUMBER });
    }
    else if (/^[a-zA-Z_$]\w*$/.test(text) && line[match.index + text.length] === '(') {
      if (KEYWORDS.has(text)) {
        tokens.push({ text, color: SYN_KEYWORD });
      } else {
        tokens.push({ text, color: SYN_FN });
      }
    }
    else if (KEYWORDS.has(text)) {
      tokens.push({ text, color: SYN_KEYWORD });
    }
    else if (TYPES.has(text)) {
      tokens.push({ text, color: SYN_TYPE });
    }
    else if (/^[{}()\[\];:,.<>=!&|?+\-*/%^~@]$/.test(text)) {
      tokens.push({ text, color: SYN_PUNCT });
    }
    else {
      tokens.push({ text });
    }
  }
  
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex) });
  }
  
  return tokens;
}


export function DiffLine({ line, maxWidth }: { line: string; maxWidth: number }) {
        const truncated = truncateCodeLine(line, maxWidth);
        if (line.startsWith('+')) {
          return <Text color="#22c55e">{truncated}</Text>;
        }
        if (line.startsWith('-')) {
          return <Text color="#ef4444">{truncated}</Text>;
        }
        if (line.startsWith('@@')) {
          return <Text color="#22d3ee">{truncated}</Text>;
        }
        return <Text>{truncated}</Text>;
}



export function SyntaxLine({ line, maxWidth }: { line: string; maxWidth: number }) {
        if (line.length > maxWidth) {
          const visible = line.slice(0, maxWidth - 4);
          const overflow = line.length - maxWidth + 4;
          const tokens = tokenizeLine(visible);
          return (
            <Text>
              {tokens.map((t: SyntaxToken, i: number) => t.color ? <Text key={i} color={t.color}>{t.text}</Text> : <Text key={i}>{t.text}</Text>)}
              <Text dimColor>{`\u2026+${overflow}`}</Text>
            </Text>
          );
        }
        const tokens = tokenizeLine(line);
        return (
          <Text>
            {tokens.map((t: SyntaxToken, i: number) => t.color ? <Text key={i} color={t.color}>{t.text}</Text> : <Text key={i}>{t.text}</Text>)}
          </Text>
        );
}



export function CodeBlockView({ segment, borderColor }: { segment: ContentSegment & { type: 'code' }; borderColor: string }) {
        const codeWidth = contentWidth(8);
        const lines = segment.code.split('\n');
        const isDiff = segment.language === 'diff' || lines.some((l: string) => /^[+-@]/.test(l));
        const capped = lines.slice(0, MAX_CODE_LINES);
        const overflow = lines.length - MAX_CODE_LINES;
  
        return (
          <Box flexDirection="column">
            <Text color={borderColor}>{'\u2502'}</Text>
            <Text>
              <Text color={borderColor}>{'\u2502  '}</Text>
              <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
              <Text> </Text>
              <Text dimColor>{segment.language || 'code'}</Text>
              {segment.index !== undefined && <Text color="#585858">{` [${segment.index}]`}</Text>}
            </Text>
            {capped.map((line: string, i: number) => (
              <Text key={`code-${i}`}>
                <Text color={borderColor}>{'\u2502  '}</Text>
                <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
                <Text> </Text>
                {isDiff ? <DiffLine line={line} maxWidth={codeWidth} /> : <SyntaxLine line={line} maxWidth={codeWidth} />}
              </Text>
            ))}
            {overflow > 0 && (
              <Text>
                <Text color={borderColor}>{'\u2502  '}</Text>
                <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
                <Text> </Text>
                <Text dimColor>{'\u2026 '}{overflow}{' more lines'}</Text>
              </Text>
            )}
            <Text color={borderColor}>{'\u2502'}</Text>
          </Box>
        );
}



export function RichSpanView({ span }: { span: InlineSpan }) {
        if (span.style.code) {
          return <Text color="#a78bfa" backgroundColor="#1e1033">{span.text}</Text>;
        }
        if (span.style.linkUrl) {
          return <><Text bold color="#60a5fa">{span.text}</Text><Text dimColor>{` (${span.style.linkUrl})`}</Text></>;
        }
  
        let el = <Text>{span.text}</Text>;
        if (span.style.bold && span.style.italic) el = <Text bold italic>{span.text}</Text>;
        else if (span.style.bold) el = <Text bold>{span.text}</Text>;
        else if (span.style.italic) el = <Text italic>{span.text}</Text>;
        if (span.style.dimColor) el = <Text dimColor>{span.text}</Text>;
        return el;
}



export function RichLineView({ line, borderColor }: { line: RichLine; borderColor?: string }) {
        const border = borderColor ? <Text color={borderColor}>{'\u2502 '}</Text> : null;
        const indent = line.indent > 0 ? '  '.repeat(line.indent) : '';
  
        if (line.kind === 'blank') return <Text>{border}{' '}</Text>;
  
        if (line.kind === 'hr') return <Text>{border}<Text dimColor>{'\u2500'.repeat(40)}</Text></Text>;
  
        if (line.kind === 'h1') return <Text>{border}{indent}<Text bold color="cyan">{'# '}{line.spans.map((s: InlineSpan, i: number) => <RichSpanView key={i} span={s} />)}</Text></Text>;
        if (line.kind === 'h2') return <Text>{border}{indent}<Text bold color="white">{'## '}{line.spans.map((s: InlineSpan, i: number) => <RichSpanView key={i} span={s} />)}</Text></Text>;
        if (line.kind === 'h3') return <Text>{border}{indent}<Text bold color="#a0a0a0">{'### '}{line.spans.map((s: InlineSpan, i: number) => <RichSpanView key={i} span={s} />)}</Text></Text>;
  
        if (line.kind === 'blockquote') {
          return <Text>{border}{indent}<Text dimColor>{'\u2502 '}</Text>{line.spans.map((s: InlineSpan, i: number) => <RichSpanView key={i} span={s} />)}</Text>;
        }
  
        const marker = line.marker ?? '';
        const listIndent = (line.kind === 'bullet' || line.kind === 'ordered') && !indent ? ' ' : '';
        return <Text>{border}{indent}{listIndent}{marker}{line.spans.map((s: InlineSpan, i: number) => <RichSpanView key={i} span={s} />)}</Text>;
}



export function MarkdownTableView({ headers, rows, alignments, borderColor }: { headers: string[]; rows: string[][]; alignments: ('left' | 'center' | 'right')[]; borderColor: string }) {
        const colWidths = headers.map((h: string, i: number) => {
          let max = h.length;
          for (const row of rows) {
            if (row[i] && row[i].length > max) max = row[i].length;
          }
          return max;
        });
  
        function padCell(text: string, colIdx: number): string {
          const w = colWidths[colIdx] ?? text.length;
          const align = alignments[colIdx] ?? 'left';
          if (align === 'right') return text.padStart(w);
          if (align === 'center') {
            const pad = w - text.length;
            const left = Math.floor(pad / 2);
            return ' '.repeat(left) + text + ' '.repeat(pad - left);
          }
          return text.padEnd(w);
        }
  
        const headerLine = headers.map((h: string, i: number) => padCell(h, i)).join('  ');
        const sepLine = colWidths.map((w: number) => '\u2500'.repeat(w)).join('\u2500\u2500');
  
        return (
          <Box flexDirection="column">
            <Text><Text color={borderColor}>{'\u2502 '}</Text><Text bold>{headerLine}</Text></Text>
            <Text><Text color={borderColor}>{'\u2502 '}</Text><Text dimColor>{sepLine}</Text></Text>
            {rows.map((row: string[], ri: number) => (
              <Text key={`tr-${ri}`}><Text color={borderColor}>{'\u2502 '}</Text>{row.map((cell: string, ci: number) => padCell(cell, ci)).join('  ')}</Text>
            ))}
          </Box>
        );
}



export function RenderedSegments({ segments, borderColor, wrapWidth }: { segments: ContentSegment[]; borderColor: string; wrapWidth: number }) {
        return (
          <>
            {segments.map((seg: ContentSegment, i: number) => {
              const spacer = i > 0 ? <Text key={`sp-${i}`} color={borderColor}>{'\u2502'}</Text> : null;
  
              if (seg.type === 'prose') {
                const richLines = parseProseToRichLines(seg.text ?? '', wrapWidth);
                if (richLines.length === 0) return null;
  
                const spaced: RichLine[] = [];
                for (let j = 0; j < richLines.length; j++) {
                  const line = richLines[j];
                  const prev = j > 0 ? richLines[j - 1] : null;
                  if ((line.kind === 'h1' || line.kind === 'h2' || line.kind === 'h3') && prev && prev.kind !== 'blank') {
                    spaced.push({ kind: 'blank', spans: [], indent: 0, marker: undefined });
                  }
                  spaced.push(line);
                  if ((line.kind === 'h1' || line.kind === 'h2' || line.kind === 'h3')) {
                    const next = j + 1 < richLines.length ? richLines[j + 1] : null;
                    if (next && next.kind !== 'blank') {
                      spaced.push({ kind: 'blank', spans: [], indent: 0, marker: undefined });
                    }
                  }
                }
  
                return (
                  <React.Fragment key={`seg-${i}`}>
                    {spacer}
                    <Box flexDirection="column">
                      {spaced.map((line: RichLine, j: number) => (
                        <RichLineView key={`rl-${i}-${j}`} line={line} borderColor={borderColor} />
                      ))}
                    </Box>
                  </React.Fragment>
                );
              }
              if (seg.type === 'table') {
                return (
                  <React.Fragment key={`seg-${i}`}>
                    {spacer}
                    <Box flexDirection="column">
                      <Text color={borderColor}>{'\u2502'}</Text>
                      <MarkdownTableView headers={seg.headers} rows={seg.rows} alignments={seg.alignments} borderColor={borderColor} />
                      <Text color={borderColor}>{'\u2502'}</Text>
                    </Box>
                  </React.Fragment>
                );
              }
              return (
                <React.Fragment key={`seg-${i}`}>
                  {spacer}
                  <CodeBlockView segment={seg as ContentSegment & { type: 'code' }} borderColor={borderColor} />
                </React.Fragment>
              );
            })}
          </>
        );
}



export function GradientLine({ text, colors }: { text: string; colors: readonly string[] }) {
        const step = Math.max(1, Math.ceil(text.length / colors.length));
        return (
          <Text>
            {text.split('').map((ch: string, i: number) => {
              const ci = Math.min(Math.floor(i / step), colors.length - 1);
              return <Text key={i} color={colors[ci]}>{ch}</Text>;
            })}
          </Text>
        );
}



export function AnsiLine({ text, maxWidth, fallbackDim }: { text: string; maxWidth: number; fallbackDim?: boolean }) {
        if (!hasAnsiCodes(text)) {
          const display = text.length > maxWidth ? text.slice(0, maxWidth - 4) + '\u2026' : text;
          return fallbackDim ? <Text dimColor>{display}</Text> : <Text>{display}</Text>;
        }
        const segments = parseAnsiText(text);
        return (
          <Text>
            {segments.map((seg: AnsiSegment, i: number) => (
              <Text
                key={i}
                color={seg.color}
                backgroundColor={seg.bgColor}
                bold={seg.bold}
                dimColor={seg.dim}
                italic={seg.italic}
              >{seg.text}</Text>
            ))}
          </Text>
        );
}


