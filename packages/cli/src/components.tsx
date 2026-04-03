import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { ContentSegment } from './markdown.js';
import type { InlineSpan, RichLine } from './rich-text.js';
import type { OutputEvent, EngineProgress } from './handlers/types.js';
import { parseMarkdownBlocks, truncateCodeLine, cleanEngineOutput } from './markdown.js';
import { parseProseToRichLines } from './rich-text.js';
import { ENGINE_COLORS } from './output.js';
import { SLASH_COMMANDS } from './intent.js';
import type { Job } from './generated/job-manager.js';
import { loadConfig, resolveWorkingDir, currentBranch, tracker } from '@agon/core';
import type { ChatSession } from '@agon/core';

// ── Components ──────────────────────────────────────────────────────

export interface OutputBlock {
  id: number;
  event: OutputEvent;
}

export function SpinnerBlock({ message, color }: { message: string; color?: number }) {
  return (
    <Text>
      <Text color={color ? String(color) : 'yellow'}><Spinner type="dots" /></Text>
      <Text> {message}</Text>
    </Text>
  );
}

export function EngineProgressView({ engines }: { engines: EngineProgress[] }) {
  return (
    <Box flexDirection="column">
      {engines.map((engine) => (
        <Box key={engine.id}>
          <Text color={engine.done ? 'green' : engine.failed ? 'red' : 'yellow'}>
            {engine.done ? '\u2713' : engine.failed ? '\u2717' : '\u25c9'}
          </Text>
          <Text> </Text>
          <Box width={14}>
            <Text bold color={engineColor(engine.id)}>
              {engine.id}
            </Text>
          </Box>
          <Text dimColor>{engine.status}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Brand colors (from SVG banner gradient: amber -> orange -> red) ────
const BRAND = ['#fbbf24', '#f9a816', '#f97316', '#f45a2a', '#ef4444'] as const;

// Bigger ASCII art -- wider, more impactful
const LOGO_LINES = [
  '    \u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2557',
  '   \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551',
  '   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551',
  '   \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u255a\u2588\u2588\u2557\u2588\u2588\u2551',
  '   \u2588\u2588\u2551  \u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2588\u2551',
  '   \u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d  \u255a\u2550\u2550\u2550\u255d',
];

export const VERSION = '0.1.0';

function GradientLine({ text, colors }: { text: string; colors: readonly string[] }) {
  const step = Math.max(1, Math.ceil(text.length / colors.length));
  return (
    <Text>
      {text.split('').map((ch, i) => {
        const ci = Math.min(Math.floor(i / step), colors.length - 1);
        return <Text key={i} color={colors[ci]}>{ch}</Text>;
      })}
    </Text>
  );
}

function DashboardView({ event }: { event: OutputEvent & { type: 'dashboard' } }) {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Logo with gradient */}
      {LOGO_LINES.map((line, i) => (
        <GradientLine key={i} text={line} colors={BRAND} />
      ))}
      <Text> </Text>
      <Text italic color="#d4a041">{'     Any AI can join. They compete. You ship.'}</Text>
      <Text dimColor>{'     v'}{VERSION}{'  Powered by '}<Text bold color="#fbbf24">{'KERNlang'}</Text></Text>
      <Text> </Text>

      {/* Compact engine roster + ELO */}
      <Box>
        <Text color="#f97316">{'  Engines: '}</Text>
        {event.enabled.map((id, i) => (
          <Text key={id}>
            <Text color={engineColor(id)} bold>{id}</Text>
            {i < event.enabled.length - 1 && <Text dimColor>{' '}</Text>}
          </Text>
        ))}
        {event.eloTop && (
          <>
            <Text dimColor>{' \u00b7 '}</Text>
            <Text color="#fbbf24">{'\u265b '}</Text>
            <Text bold color={engineColor(event.eloTop.id)}>{event.eloTop.id}</Text>
            <Text dimColor>{' '}{String(event.eloTop.rating)}{' ELO'}</Text>
          </>
        )}
      </Box>

      {/* Quick start */}
      <Text> </Text>
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{'  '}</Text>
          <Text italic dimColor>{'"explain the auth flow"'}</Text>
          <Text dimColor>{'                      '}</Text>
          <Text color="#fbbf24">{'\u2192 chat'}</Text>
        </Box>
        <Box>
          <Text dimColor>{'  '}</Text>
          <Text italic dimColor>{'"codex how would you do this?"'}</Text>
          <Text dimColor>{'                '}</Text>
          <Text color="#22d3ee">{'\u2192 codex'}</Text>
        </Box>
        <Box>
          <Text dimColor>{'  '}</Text>
          <Text italic dimColor>{'"fix login bug, test with npm test"'}</Text>
          <Text dimColor>{'           '}</Text>
          <Text color="#f97316">{'\u2192 forge'}</Text>
        </Box>
        <Box>
          <Text dimColor>{'  '}</Text>
          <Text italic dimColor>{'"should we use REST or GraphQL?"'}</Text>
          <Text dimColor>{'              '}</Text>
          <Text color="#a78bfa">{'\u2192 tribunal'}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text dimColor>{'  Just talk, or type '}<Text color="#f97316">{'/'}</Text>{' for commands.'}</Text>
      <Text> </Text>
    </Box>
  );
}

// ── Layout Constants ─────────────────────────────────────────────────

/** Get terminal-aware content width -- scale with terminal, cap at 160 for readability */
export function contentWidth(padding: number): number {
  const termWidth = process.stdout.columns || 100;
  return Math.min(Math.max(termWidth - padding, 40), 160);
}

// ── Code Block Rendering ─────────────────────────────────────────────

const CODE_RAIL = '\u258c'; // U+258C
const CODE_RAIL_COLOR = '#585858';
const MAX_CODE_LINES = 60;

/** Render a single diff-aware code line */
function DiffLine({ line, maxWidth }: { line: string; maxWidth: number }) {
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

// ── Lightweight Syntax Highlighting ─────────────────────────────────

const SYN_KEYWORD = '#c084fc'; // purple -- keywords
const SYN_STRING = '#4ade80';  // green  -- strings
const SYN_COMMENT = '#6b7280'; // gray   -- comments
const SYN_NUMBER = '#fb923c';  // orange -- numbers
const SYN_TYPE = '#38bdf8';    // blue   -- types/builtin
const SYN_PUNCT = '#94a3b8';   // slate  -- punctuation/operators
const SYN_FN = '#fbbf24';     // amber  -- function names

// Language keywords for common languages
const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do','switch','case','break','continue',
  'class','extends','implements','new','this','super','import','export','from','default','async','await',
  'try','catch','finally','throw','typeof','instanceof','in','of','yield','void','delete',
  'interface','type','enum','namespace','abstract','private','public','protected','static','readonly',
  'fn','struct','impl','pub','mod','use','crate','self','mut','ref','match','loop','move',
  'def','elif','pass','with','as','is','not','and','or','lambda','nonlocal','global',
  'true','false','null','undefined','nil','None','True','False',
]);

const TYPES = new Set([
  'string','number','boolean','object','any','void','never','unknown','bigint','symbol',
  'String','Number','Boolean','Object','Array','Map','Set','Promise','Record','Partial',
  'int','float','double','char','long','short','byte','i32','u32','i64','u64','f64','f32','usize','isize','bool',
  'str','Vec','Option','Result','Box','Rc','Arc',
]);

interface SyntaxToken { text: string; color?: string }

function tokenizeLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  // Regex-based tokenizer: comments, strings, numbers, identifiers, punctuation, whitespace
  const pattern = /\/\/.*$|\/\*.*?\*\/|#.*$|""".*?"""|'''.*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[a-zA-Z_$]\w*(?=\s*\()|[a-zA-Z_$]\w*|[{}()\[\];:,.<>=!&|?+\-*/%^~@]|\s+/g;

  let match;
  let lastIndex = 0;
  while ((match = pattern.exec(line)) !== null) {
    // Gap -- unmatched chars
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index) });
    }
    lastIndex = match.index + match[0].length;

    const text = match[0];

    // Comment
    if (text.startsWith('//') || text.startsWith('#') || text.startsWith('/*')) {
      tokens.push({ text, color: SYN_COMMENT });
    }
    // String
    else if (/^["'`]/.test(text) || text.startsWith('"""') || text.startsWith("'''")) {
      tokens.push({ text, color: SYN_STRING });
    }
    // Number
    else if (/^\d/.test(text)) {
      tokens.push({ text, color: SYN_NUMBER });
    }
    // Function call (identifier followed by parens -- detected by lookahead in regex)
    else if (/^[a-zA-Z_$]\w*$/.test(text) && line[match.index + text.length] === '(') {
      if (KEYWORDS.has(text)) {
        tokens.push({ text, color: SYN_KEYWORD });
      } else {
        tokens.push({ text, color: SYN_FN });
      }
    }
    // Keyword
    else if (KEYWORDS.has(text)) {
      tokens.push({ text, color: SYN_KEYWORD });
    }
    // Type
    else if (TYPES.has(text)) {
      tokens.push({ text, color: SYN_TYPE });
    }
    // Punctuation/operators
    else if (/^[{}()\[\];:,.<>=!&|?+\-*/%^~@]$/.test(text)) {
      tokens.push({ text, color: SYN_PUNCT });
    }
    // Plain text (whitespace, identifiers)
    else {
      tokens.push({ text });
    }
  }

  // Trailing unmatched
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex) });
  }

  return tokens;
}

/** Render a syntax-highlighted code line */
function SyntaxLine({ line, maxWidth }: { line: string; maxWidth: number }) {
  if (line.length > maxWidth) {
    // Truncate -- highlight the visible portion
    const visible = line.slice(0, maxWidth - 4);
    const overflow = line.length - maxWidth + 4;
    const tokens = tokenizeLine(visible);
    return (
      <Text>
        {tokens.map((t, i) => t.color ? <Text key={i} color={t.color}>{t.text}</Text> : <Text key={i}>{t.text}</Text>)}
        <Text dimColor>{`\u2026+${overflow}`}</Text>
      </Text>
    );
  }
  const tokens = tokenizeLine(line);
  return (
    <Text>
      {tokens.map((t, i) => t.color ? <Text key={i} color={t.color}>{t.text}</Text> : <Text key={i}>{t.text}</Text>)}
    </Text>
  );
}

/** Code block with left rail gutter, diff coloring, no word-wrap */
function CodeBlockView({ segment, borderColor }: { segment: ContentSegment & { type: 'code' }; borderColor: string }) {
  const codeWidth = contentWidth(8);
  const lines = segment.code.split('\n');
  const isDiff = segment.language === 'diff' || lines.some((l) => /^[+-@]/.test(l));
  const capped = lines.slice(0, MAX_CODE_LINES);
  const overflow = lines.length - MAX_CODE_LINES;

  return (
    <Box flexDirection="column">
      <Text color={borderColor}>{'\u2502'}</Text>
      {/* Language label with copy index */}
      <Text>
        <Text color={borderColor}>{'\u2502  '}</Text>
        <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
        <Text> </Text>
        <Text dimColor>{segment.language || 'code'}</Text>
        {segment.index !== undefined && <Text color="#585858">{` [${segment.index}]`}</Text>}
      </Text>
      {/* Code lines */}
      {capped.map((line, i) => (
        <Text key={`code-${i}`}>
          <Text color={borderColor}>{'\u2502  '}</Text>
          <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
          <Text> </Text>
          {isDiff ? <DiffLine line={line} maxWidth={codeWidth} /> : <SyntaxLine line={line} maxWidth={codeWidth} />}
        </Text>
      ))}
      {/* Overflow indicator */}
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

// ── Rich Markdown Rendering ──────────────────────────────────────────

/** Render a single inline span with styles */
function RichSpanView({ span }: { span: InlineSpan }) {
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

/** Render a single rich line with kind-specific formatting */
function RichLineView({ line, borderColor }: { line: RichLine; borderColor?: string }) {
  const border = borderColor ? <Text color={borderColor}>{'\u2502 '}</Text> : null;
  const indent = line.indent > 0 ? '  '.repeat(line.indent) : '';

  if (line.kind === 'blank') return <Text>{border}{' '}</Text>;

  if (line.kind === 'hr') return <Text>{border}<Text dimColor>{'\u2500'.repeat(40)}</Text></Text>;

  if (line.kind === 'h1') return <Text>{border}{indent}<Text bold color="cyan">{'# '}{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text></Text>;
  if (line.kind === 'h2') return <Text>{border}{indent}<Text bold color="white">{'## '}{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text></Text>;
  if (line.kind === 'h3') return <Text>{border}{indent}<Text bold color="#a0a0a0">{'### '}{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text></Text>;

  if (line.kind === 'blockquote') {
    return <Text>{border}{indent}<Text dimColor>{'\u2502 '}</Text>{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text>;
  }

  const marker = line.marker ?? '';
  // Add subtle indent for list items for readability
  const listIndent = (line.kind === 'bullet' || line.kind === 'ordered') && !indent ? ' ' : '';
  return <Text>{border}{indent}{listIndent}{marker}{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text>;
}

/** Render a markdown table segment inside a border */
function MarkdownTableView({ headers, rows, alignments, borderColor }: {
  headers: string[];
  rows: string[][];
  alignments: ('left' | 'center' | 'right')[];
  borderColor: string;
}) {
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
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

  const headerLine = headers.map((h, i) => padCell(h, i)).join('  ');
  const sepLine = colWidths.map(w => '\u2500'.repeat(w)).join('\u2500\u2500');

  return (
    <Box flexDirection="column">
      <Text><Text color={borderColor}>{'\u2502 '}</Text><Text bold>{headerLine}</Text></Text>
      <Text><Text color={borderColor}>{'\u2502 '}</Text><Text dimColor>{sepLine}</Text></Text>
      {rows.map((row, ri) => (
        <Text key={`tr-${ri}`}><Text color={borderColor}>{'\u2502 '}</Text>{row.map((cell, ci) => padCell(cell, ci)).join('  ')}</Text>
      ))}
    </Box>
  );
}

/** Render parsed markdown segments inside an engine block */
export function RenderedSegments({ segments, borderColor, wrapWidth }: {
  segments: ContentSegment[];
  borderColor: string;
  wrapWidth: number;
}) {
  return (
    <>
      {segments.map((seg, i) => {
        // Add spacer line between segments for breathing room
        const spacer = i > 0 ? <Text key={`sp-${i}`} color={borderColor}>{'\u2502'}</Text> : null;

        if (seg.type === 'prose') {
          const richLines = parseProseToRichLines(seg.text ?? '', wrapWidth);
          if (richLines.length === 0) return null;

          // Insert blank lines around headings and between paragraphs for visual spacing
          const spaced: RichLine[] = [];
          for (let j = 0; j < richLines.length; j++) {
            const line = richLines[j];
            const prev = j > 0 ? richLines[j - 1] : null;
            // Add blank line before headings (unless already blank or first line)
            if ((line.kind === 'h1' || line.kind === 'h2' || line.kind === 'h3') && prev && prev.kind !== 'blank') {
              spaced.push({ kind: 'blank', spans: [], indent: 0, marker: undefined });
            }
            spaced.push(line);
            // Add blank line after headings
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
                {spaced.map((line, j) => (
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
        // code segment (type narrowed to 'code')
        return (
          <React.Fragment key={`seg-${i}`}>
            {spacer}
            <CodeBlockView segment={seg} borderColor={borderColor} />
          </React.Fragment>
        );
      })}
    </>
  );
}

/** Convert 256-color code to hex for Ink compatibility */
function color256toHex(code: number): string {
  // Standard 16 colors
  const basic16: Record<number, string> = {
    0: '#000000', 1: '#aa0000', 2: '#00aa00', 3: '#aa5500', 4: '#0000aa',
    5: '#aa00aa', 6: '#00aaaa', 7: '#aaaaaa', 8: '#555555', 9: '#ff5555',
    10: '#55ff55', 11: '#ffff55', 12: '#5555ff', 13: '#ff55ff', 14: '#55ffff', 15: '#ffffff',
  };
  if (code < 16) return basic16[code] ?? '#ffffff';
  if (code >= 232) {
    // Grayscale: 232-255 -> 8 to 238
    const gray = 8 + (code - 232) * 10;
    const h = Math.min(255, gray).toString(16).padStart(2, '0');
    return `#${h}${h}${h}`;
  }
  // 216-color cube: 16-231
  const idx = code - 16;
  const r = Math.floor(idx / 36);
  const g = Math.floor((idx % 36) / 6);
  const b = idx % 6;
  const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Get hex color for an engine */
export function engineColor(id: string): string {
  return color256toHex(ENGINE_COLORS[id] ?? 245);
}

function EngineBlock({ engineId, color, content }: { engineId: string; color: number; content: string }) {
  const wrapWidth = contentWidth(8);
  const cleaned = cleanEngineOutput(content);
  const hexColor = color256toHex(color);

  if (!cleaned.trim()) {
    return (
      <Box flexDirection="column" marginY={0} paddingLeft={2}>
        <Text color={hexColor}>{'\u250c\u2500\u2500 '}<Text bold>{engineId}</Text></Text>
        <Text color={hexColor}>{'\u2502 '}<Text dimColor>{'(no response)'}</Text></Text>
        <Text color={hexColor}>{'\u2514\u2500\u2500'}</Text>
      </Box>
    );
  }

  const segments = parseMarkdownBlocks(cleaned);

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Text color={hexColor}>{'\u250c\u2500\u2500 '}<Text bold color={hexColor}>{engineId}</Text></Text>
      <Text color={hexColor}>{'\u2502'}</Text>
      <RenderedSegments segments={segments} borderColor={hexColor} wrapWidth={wrapWidth} />
      <Text color={hexColor}>{'\u2514\u2500\u2500'}</Text>
    </Box>
  );
}

// ── Conversational Mode Components ──────────────────────────────────

function ConversationalResponse({ engineId, content }: { engineId: string; content: string }) {
  const wrapWidth = contentWidth(4);
  const cleaned = cleanEngineOutput(content);
  if (!cleaned.trim()) return null;
  const segments = parseMarkdownBlocks(cleaned);
  const accentColor = color256toHex(ENGINE_COLORS[engineId] ?? 245);
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} paddingLeft={1}>
      <Text><Text color={accentColor} bold>{'\u25cf '}{engineId}</Text></Text>
      <Text color={accentColor}>{'\u2502'}</Text>
      <RenderedSegments segments={segments} borderColor={accentColor} wrapWidth={wrapWidth} />
      <Text color={accentColor}>{'\u2502'}</Text>
    </Box>
  );
}

/** Visual token gauge bar like Claude Code's context indicator */
function TokenGauge({ tokens, maxTokens }: { tokens: number; maxTokens: number }) {
  const pct = Math.min(100, Math.round((tokens / maxTokens) * 100));
  const barWidth = 12;
  const filled = Math.round((pct / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

  // Color: green < 60%, yellow 60-80%, red > 80%
  const barColor = pct > 80 ? '#ef4444' : pct > 60 ? '#fbbf24' : '#4ade80';

  return (
    <Text>
      <Text color={barColor}>{bar}</Text>
      <Text dimColor>{` ${pct}%`}</Text>
    </Text>
  );
}

export function StatusBar({ config, chatSession }: { config: ReturnType<typeof loadConfig>; chatSession: ChatSession }) {
  const cesarId = config.cesarEngine ?? config.forgeFixedStarter ?? 'claude';
  const cesarColor = color256toHex(ENGINE_COLORS[cesarId] ?? 245);
  const workDir = resolveWorkingDir();
  let branch = '';
  try { branch = currentBranch(workDir); } catch {}
  const cwd = workDir.replace(process.env.HOME ?? '', '~');
  const stats = tracker.getStats();
  const cost = stats.totalCostUsd > 0 ? `$${stats.totalCostUsd.toFixed(2)}` : '';
  const msgs = chatSession.messages.length;
  const tokens = stats.totalTokens;
  // Context budget per engine model
  const contextWindows: Record<string, number> = {
    claude: 1000000, codex: 200000, gemini: 1000000, opencode: 200000,
  };
  const contextBudget = contextWindows[cesarId] ?? 200000;

  return (
    <Box paddingTop={0}>
      <Text>
        <Text color={cesarColor} bold>{cesarId}</Text>
        <Text dimColor>{' in '}</Text>
        <Text color="#60a5fa">{cwd}</Text>
        {branch ? <Text dimColor>{' on '}<Text color="#34d399">{branch}</Text></Text> : null}
        {tokens > 0 ? <Text dimColor>{' | '}</Text> : null}
        {tokens > 0 ? <TokenGauge tokens={tokens} maxTokens={contextBudget} /> : null}
        {tokens > 0 ? <Text dimColor>{` | ${(tokens / 1000).toFixed(1)}k tok`}</Text> : null}
        {msgs > 0 ? <Text dimColor>{` \u00b7 ${msgs} msgs`}</Text> : null}
        {cost ? <Text dimColor>{` \u00b7 ${cost}`}</Text> : null}
      </Text>
    </Box>
  );
}

const AGON_TIPS = [
  'Run /forge <task> test with <cmd> to make engines compete on code',
  'Run /brainstorm to get confidence bids from all engines',
  'Run /tribunal to start a multi-AI debate',
  'Run /cesar <engine> to change your Cesar brain engine',
  'Run /models to pick which engines are active',
  'Run /campfire for collaborative multi-engine thinking',
  'Run /leaderboard to see engine ELO ratings',
  'Run /history to browse past forge runs',
  'Run /tokens to see session cost breakdown',
  'Type an engine name first (e.g. "codex explain...") to pick who answers',
  'Run /pipeline for scout, build, forge in one shot',
  'Run /discover to find new AI CLIs on your system',
  'Drag and drop an image path to include it in your prompt',
  'Run /apply <patch> to apply a forge winner\'s diff',
];

function AgonTip() {
  const [tip] = useState(() => AGON_TIPS[Math.floor(Math.random() * AGON_TIPS.length)]);
  return (
    <Text>
      <Text dimColor>{'  \u2514 Tip: '}</Text>
      <Text dimColor>{tip}</Text>
    </Text>
  );
}

export function StatusLine({ startTime, engineId, color }: { startTime: number; engineId?: string; color?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = Math.floor((now - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const c = color ? color256toHex(color) : '#f97316';
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text>
        <Text color={c}><Spinner type="dots" /></Text>
        {engineId && <Text color={c} bold>{` ${engineId}`}</Text>}
        <Text color={c}>{' thinking\u2026'}</Text>
        <Text dimColor>{` (${timeStr})`}</Text>
      </Text>
      {elapsed >= 5 && <AgonTip />}
    </Box>
  );
}

// ── Output Block Rendering ──────────────────────────────────────────

export function OutputBlockView({ event, mode }: { event: OutputEvent; mode: string }) {
  switch (event.type) {
    case 'text': {
      const wrapWidth = contentWidth(4);
      const richLines = parseProseToRichLines(event.content, wrapWidth);
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {richLines.map((line, i) => <RichLineView key={`text-${i}`} line={line} />)}
        </Box>
      );
    }
    case 'user-message': return mode === 'chat' ? (
      <Box paddingLeft={2} marginTop={1}>
        <Text bold>{event.content}</Text>
      </Box>
    ) : (
      <Box paddingLeft={2} marginTop={1}>
        <Text dimColor>{'you'}</Text>
        <Text>{' '}{event.content}</Text>
      </Box>
    );
    case 'engine-block': return mode === 'chat'
      ? <ConversationalResponse engineId={event.engineId} content={event.content} />
      : <EngineBlock engineId={event.engineId} color={event.color} content={event.content} />;
    case 'separator': return mode === 'chat'
      ? <Text>{' '}</Text>
      : <Text dimColor>{'  \u2500'.padEnd(50, '\u2500')}</Text>;
    case 'header': return <Box flexDirection="column"><Text>{' '}</Text><Text bold color="cyan">{'  \u25b8 '}{event.title}</Text></Box>;
    case 'success': return <Text>{'  '}<Text color="green">{'\u2713'}</Text>{' '}{event.message}</Text>;
    case 'error': return <Text>{'  '}<Text color="red">{'\u2717'}</Text>{' '}{event.message}</Text>;
    case 'warning': return <Text>{'  '}<Text color="yellow">{'\u26a0'}</Text>{' '}{event.message}</Text>;
    case 'info': return <Text dimColor>{'  '}{event.message}</Text>;
    case 'table': return <TableView headers={event.headers} rows={event.rows} />;
    case 'streaming-chunk': return <Text>{'  '}{event.chunk}</Text>;
    case 'kern-draft': {
      const eColor = engineColor(event.engineId);
      const wrapWidth = contentWidth(8);
      const segments = parseMarkdownBlocks(event.content.trim());
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={eColor}>{'\u250c\u2500\u2500 '}<Text bold>{event.engineId}</Text>{event.critique ? <Text color="green">{' '}{event.critique}</Text> : ''}</Text>
          <Text color={eColor}>{'\u2502'}</Text>
          <RenderedSegments segments={segments} borderColor={eColor} wrapWidth={wrapWidth} />
          <Text color={eColor}>{'\u2514\u2500\u2500'}</Text>
        </Box>
      );
    }
    case 'debate-round': {
      const dColor = engineColor(event.engineId);
      const wrapWidth = contentWidth(8);
      const segments = parseMarkdownBlocks(event.argument.trim());
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={dColor}>{'\u250c\u2500\u2500 '}<Text bold>{event.engineId}</Text>{' '}<Text dimColor>{'('}{event.position}{')'}</Text></Text>
          <Text color={dColor}>{'\u2502'}</Text>
          <RenderedSegments segments={segments} borderColor={dColor} wrapWidth={wrapWidth} />
          <Text color={dColor}>{'\u2514\u2500\u2500'}</Text>
        </Box>
      );
    }
    case 'verdict': {
      const wrapWidth = contentWidth(4);
      const richLines = parseProseToRichLines(event.summary.trim(), wrapWidth);
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {richLines.map((line, i) => <RichLineView key={`v-${i}`} line={line} />)}
        </Box>
      );
    }
    case 'scoreboard': return (
      <Box flexDirection="column" paddingLeft={2} marginY={1}>
        <Text bold>{event.title}</Text>
        {event.winner && <Text bold color="green">{'  \u2605 Winner: '}{event.winner}</Text>}
        <Text dimColor>{'  '}{('\u2500').repeat(46)}</Text>
        {event.metrics.map((m) => (
          <Box key={m.label}>
            <Text>{'  '}</Text>
            <Box width={16}><Text bold>{m.label}</Text></Box>
            <Text>{m.values.join('  \u2502  ')}</Text>
          </Box>
        ))}
      </Box>
    );
    case 'plan': return (
      <Box flexDirection="column" paddingLeft={2} marginY={1}>
        <Text bold color="cyan">{'\u25b8 Plan: '}{event.plan.id.slice(0, 12)}</Text>
        <Text>{'  State: '}<Text bold>{event.plan.state}</Text></Text>
        <Text>{'  Task:  '}{event.plan.action.task}</Text>
        <Text dimColor>{'  '}{('\u2500').repeat(46)}</Text>
        {event.plan.steps.map((step) => (
          <Box key={step.id}>
            <Text>{'  '}</Text>
            <Text color={step.result.state === 'completed' ? 'green' : step.result.state === 'failed' ? 'red' : step.result.state === 'running' ? 'yellow' : undefined}>
              {step.result.state === 'completed' ? '\u2713' : step.result.state === 'failed' ? '\u2717' : step.result.state === 'running' ? '\u25c9' : '\u25cb'}
            </Text>
            <Text> {step.label}</Text>
          </Box>
        ))}
      </Box>
    );
    case 'plan-list': return (
      <Box flexDirection="column" paddingLeft={2}>
        {event.plans.map((p) => (
          <Box key={p.id}>
            <Box width={14}><Text dimColor>{p.id.slice(0, 12)}</Text></Box>
            <Box width={12}><Text color={p.state === 'completed' ? 'green' : p.state === 'failed' ? 'red' : undefined}>{p.state}</Text></Box>
            <Text>{p.action.task.slice(0, 40)}</Text>
          </Box>
        ))}
      </Box>
    );
    case 'tool-call': {
      const toolColor = event.status === 'error' ? '#ef4444' : event.status === 'done' ? '#4ade80' : '#fbbf24';
      const icon = event.status === 'error' ? '\u2717' : event.status === 'done' ? '\u2713' : '\u27f3';
      const eColor = engineColor(event.engineId);
      // Tool name mapping for display
      const toolLabels: Record<string, string> = {
        'Read': '\ud83d\udcc4 Read', 'Edit': '\u270f\ufe0f  Edit', 'Write': '\ud83d\udcdd Write',
        'Bash': '\u26a1 Run', 'Grep': '\ud83d\udd0d Search', 'Glob': '\ud83d\udcc2 Find',
        'read': '\ud83d\udcc4 Read', 'edit': '\u270f\ufe0f  Edit', 'write': '\ud83d\udcdd Write',
        'bash': '\u26a1 Run', 'grep': '\ud83d\udd0d Search', 'glob': '\ud83d\udcc2 Find',
        'tool': '\ud83d\udd27 Tool',
      };
      const label = toolLabels[event.tool] ?? `\ud83d\udd27 ${event.tool}`;
      const inputPreview = event.input.length > 60 ? event.input.slice(0, 60) + '\u2026' : event.input;

      return (
        <Box paddingLeft={2} flexDirection="column">
          <Text>
            <Text color={eColor}>{'\u2502 '}</Text>
            <Text color={toolColor}>{icon}</Text>
            <Text bold>{` ${label}`}</Text>
            <Text dimColor>{` ${inputPreview}`}</Text>
          </Text>
          {event.output && event.status === 'done' && event.output.length <= 200 && (
            <Text>
              <Text color={eColor}>{'\u2502   '}</Text>
              <Text dimColor>{event.output.length > 120 ? event.output.slice(0, 120) + '\u2026' : event.output}</Text>
            </Text>
          )}
          {event.output && event.status === 'done' && event.output.length > 200 && (
            <Text>
              <Text color={eColor}>{'\u2502   '}</Text>
              <Text dimColor>{`${event.output.split('\n').length} lines (${Math.ceil(event.output.length / 1024)}kb)`}</Text>
            </Text>
          )}
        </Box>
      );
    }
    case 'response-meta': {
      const secs = (event.elapsed / 1000).toFixed(1);
      return (
        <Box paddingLeft={2}>
          <Text dimColor>{event.engineId} \u00b7 {secs}s</Text>
        </Box>
      );
    }
    case 'dashboard': return <DashboardView event={event as OutputEvent & { type: 'dashboard' }} />;
    default: return null;
  }
}

function TableView({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)) + 2,
  );
  return (
    <Box flexDirection="column" paddingLeft={2} marginY={1}>
      <Box>
        {headers.map((h, i) => (
          <Box key={h} width={widths[i]}><Text bold>{h}</Text></Box>
        ))}
      </Box>
      <Text dimColor>{'\u2500'.repeat(widths.reduce((a, b) => a + b, 0))}</Text>
      {rows.map((row, ri) => (
        <Box key={`row-${ri}-${row[0] ?? ''}`}>
          {row.map((cell, ci) => (
            <Box key={`${headers[ci]}-${ci}`} width={widths[ci]}><Text>{cell}</Text></Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function SlashPicker({ commands, onSelect, onCancel }: {
  commands: typeof SLASH_COMMANDS;
  onSelect: (cmd: string) => void;
  onCancel: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState('');

  const filtered = commands.filter((c) => c.cmd.toLowerCase().includes(filter.toLowerCase()));

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return; }
    if (key.return) {
      if (filtered[selectedIndex]) onSelect(filtered[selectedIndex].cmd);
      return;
    }
    if (key.upArrow) { setSelectedIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1)); return; }
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    if (key.tab) {
      // Tab selects current item
      if (filtered[selectedIndex]) onSelect(filtered[selectedIndex].cmd);
      return;
    }
    // Printable characters -> filter
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      setFilter((f) => f + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box>
        <Text color="yellow">{'/ '}</Text>
        <Text>{filter}</Text>
        <Text dimColor>{'\u2588'}</Text>
        <Text dimColor>{'  \u2191\u2193 navigate  Enter select  Esc cancel'}</Text>
      </Box>
      <Text dimColor>{'\u2500'.repeat(48)}</Text>
      {filtered.length === 0 ? (
        <Text dimColor>{'  No matching commands'}</Text>
      ) : (
        (() => {
          const maxVisible = 12;
          const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), filtered.length - maxVisible));
          const visible = filtered.slice(start, start + maxVisible);
          return visible.map((cmd, vi) => {
            const i = start + vi;
            return (
              <Box key={cmd.cmd}>
                <Text color={i === selectedIndex ? 'yellow' : undefined} bold={i === selectedIndex}>
                  {i === selectedIndex ? ' \u276f ' : '   '}{cmd.cmd.padEnd(16)}
                </Text>
                <Text dimColor>{cmd.desc}</Text>
              </Box>
            );
          });
        })()
      )}
    </Box>
  );
}

// ── Engine Picker (interactive /models) ──────────────────────────────

export function EnginePicker({ available, initialSelected, onConfirm, onCancel }: {
  available: string[];
  initialSelected: string[];
  onConfirm: (selected: string[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return) {
      const result = available.filter((id) => selected.has(id));
      if (result.length === 0) return; // must select at least one
      onConfirm(result);
      return;
    }
    if (key.upArrow) setCursor((i) => Math.max(0, i - 1));
    if (key.downArrow) setCursor((i) => Math.min(available.length - 1, i + 1));
    if (input === ' ') {
      const id = available[cursor];
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    // 'a' to select all, 'n' to select none
    if (input === 'a') setSelected(new Set(available));
    if (input === 'n') setSelected(new Set());
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
      <Text bold color="cyan">{'Select active engines'}</Text>
      <Text dimColor>{'Space toggle  \u2191\u2193 navigate  a all  n none  Enter confirm  Esc cancel'}</Text>
      <Text dimColor>{'\u2500'.repeat(48)}</Text>
      {available.map((id, i) => (
        <Box key={id}>
          <Text color={i === cursor ? 'yellow' : undefined}>
            {i === cursor ? ' \u276f ' : '   '}
          </Text>
          <Text color={selected.has(id) ? 'green' : 'red'}>
            {selected.has(id) ? '\u25c9' : '\u25cb'}
          </Text>
          <Text>{' '}</Text>
          <Text bold color={engineColor(id)}>{id}</Text>
          {!selected.has(id) && <Text dimColor>{' (disabled)'}</Text>}
        </Box>
      ))}
      <Text dimColor>{'\u2500'.repeat(48)}</Text>
      <Text dimColor>{selected.size}{' of '}{available.length}{' selected'}</Text>
    </Box>
  );
}

// ── Review Block (Forge patch review) ────────────────────────────────

export interface ReviewEvent {
  winnerId: string;
  patchPath: string;
  patchContent: string;
}

export function ReviewBlock({ event, onAction }: {
  event: ReviewEvent;
  onAction: (action: 'apply' | 'edit' | 'reject' | 'copy') => void;
}) {
  const eColor = engineColor(event.winnerId);
  const codeWidth = contentWidth(10);
  const lines = event.patchContent.split('\n').slice(0, 30);
  const overflow = event.patchContent.split('\n').length - 30;

  useInput((input) => {
    const k = input.toLowerCase();
    if (k === 'a') onAction('apply');
    else if (k === 'e') onAction('edit');
    else if (k === 'r') onAction('reject');
    else if (k === 'c') onAction('copy');
  });

  return (
    <Box flexDirection="column" paddingLeft={2} marginY={1}>
      <Text color={eColor}>{'\u250c\u2500\u2500 Winner: '}<Text bold>{event.winnerId}</Text></Text>
      {lines.map((line, i) => (
        <Text key={`rv-${i}`}>
          <Text color={eColor}>{'\u2502 '}</Text>
          <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
          <Text> </Text>
          <DiffLine line={line} maxWidth={codeWidth} />
        </Text>
      ))}
      {overflow > 0 && (
        <Text>
          <Text color={eColor}>{'\u2502 '}</Text>
          <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
          <Text> </Text>
          <Text dimColor>{'\u2026 '}{overflow}{' more lines'}</Text>
        </Text>
      )}
      <Text color={eColor}>{'\u2514\u2500\u2500 '}<Text bold color="green">{'[A]'}</Text>{'pply  '}<Text bold color="cyan">{'[E]'}</Text>{'dit  '}<Text bold color="red">{'[R]'}</Text>{'eject  '}<Text bold color="yellow">{'[C]'}</Text>{'opy'}</Text>
    </Box>
  );
}

// ── Background Job Rail ──────────────────────────────────────────────

export function BackgroundJobRail({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return null;
  return (
    <Box paddingX={1}>
      <Text dimColor>{'jobs: '}</Text>
      {jobs.map((job, i) => (
        <Text key={job.id}>
          <Text color={job.state === 'running' ? 'yellow' : job.state === 'done' ? 'green' : 'red'}>
            {'['}{job.id}{'] '}{job.type}{' '}
            {job.state === 'running' ? '...' : job.state === 'done' ? 'done' : 'failed'}
          </Text>
          {i < jobs.length - 1 && <Text dimColor>{'  '}</Text>}
        </Text>
      ))}
    </Box>
  );
}
