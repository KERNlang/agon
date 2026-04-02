import React, { useState, useCallback, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { Plan, ChatSession } from '@agon/core';
import {
  EngineRegistry,
  ensureAgonHome,
  loadConfig,
  ensureCurrentWorkspace,
  startChatSession,
  resumeChatSession,
  currentBranch,
  getElo,
  getActiveWorkspace,
  configSet,
  RUNS_DIR,
  wordWrap,
  extractImagesFromInput,
  buildImageAttachment,
  parsePatch,
  patchSummary,
  applyPatchWithUndo,
  undoPatch,
} from '@agon/core';
import type { ImageAttachment } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import type { EngineAdapter } from '@agon/core';
import { detectIntent, SLASH_COMMANDS } from './intent.js';
import { JobManager } from './generated/job-manager.js';
import type { Job } from './generated/job-manager.js';
import { ENGINE_COLORS } from './output.js';
import { parseMarkdownBlocks, truncateCodeLine, cleanEngineOutput } from './markdown.js';
import type { ContentSegment } from './markdown.js';
import { parseProseToRichLines } from './rich-text.js';
import type { RichLine, InlineSpan } from './rich-text.js';
import type { OutputEvent, HandlerContext, EngineProgress } from './handlers/types.js';
import {
  handleForge, handleChat, handleBrainstorm, handleCampfire, handleTribunal,
  handleLeaderboard, handleHistory, handleEngines, handleDiscover,
  handleConfig, handleUse, handleTokens, handleModels, handleWorkspace, handleChats,
  handlePlanShow, handlePlansList, handleApprove, handleRetry, handleCancel,
  handleApplyPatch, handleCp,
  handleFlowReport, handleFlowAnalysis, autoLogFlow,
  handleBuild, handleRun,
} from './handlers/index.js';
import { routeViaCesar } from './handlers/cesar.js';
import { handlePipeline } from './handlers/pipeline.js';
import { handleProvider } from './handlers/provider.js';
import { codeBlockBuffer } from './code-buffer.js';
import { getGhostCompletion } from './ghost-text.js';
import { copyToClipboard, applyPatchToTree } from '@agon/core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// ── State Types (KERN-generated from kern/app-state.kern) ────────────
import type { ReplStateState as ReplState } from './generated/app-state.js';
import {
  startCommandReplState,
  finishReplState,
  cancelReplState,
} from './generated/app-state.js';

interface OutputBlock {
  id: number;
  event: OutputEvent;
}

// ── Components ──────────────────────────────────────────────────────

function SpinnerBlock({ message, color }: { message: string; color?: number }) {
  return (
    <Text>
      <Text color={color ? String(color) : 'yellow'}><Spinner type="dots" /></Text>
      <Text> {message}</Text>
    </Text>
  );
}

function EngineProgressView({ engines }: { engines: EngineProgress[] }) {
  return (
    <Box flexDirection="column">
      {engines.map((engine) => (
        <Box key={engine.id}>
          <Text color={engine.done ? 'green' : engine.failed ? 'red' : 'yellow'}>
            {engine.done ? '✓' : engine.failed ? '✗' : '◉'}
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

// ── Brand colors (from SVG banner gradient: amber → orange → red) ────
const BRAND = ['#fbbf24', '#f9a816', '#f97316', '#f45a2a', '#ef4444'] as const;

// Bigger ASCII art — wider, more impactful
const LOGO_LINES = [
  '    █████╗  ██████╗  ██████╗ ███╗   ██╗',
  '   ██╔══██╗██╔════╝ ██╔═══██╗████╗  ██║',
  '   ███████║██║  ███╗██║   ██║██╔██╗ ██║',
  '   ██╔══██║██║   ██║██║   ██║██║╚██╗██║',
  '   ██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║',
  '   ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝',
];

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
        <Text color="#f97316">{'  \u2694 '}</Text>
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

/** Max content width for readable output — like Claude Code */
const MAX_CONTENT_WIDTH = 88;

/** Get capped terminal width for content rendering */
function contentWidth(padding: number): number {
  const termWidth = process.stdout.columns || 80;
  return Math.min(termWidth - padding, MAX_CONTENT_WIDTH);
}

// ── Code Block Rendering ─────────────────────────────────────────────

const CODE_RAIL = '▌'; // U+258C
const CODE_RAIL_COLOR = '#585858';
const MAX_CODE_LINES = 30;

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

/** Code block with left rail gutter, diff coloring, no word-wrap */
function CodeBlockView({ segment, borderColor }: { segment: ContentSegment & { type: 'code' }; borderColor: string }) {
  const codeWidth = contentWidth(8);
  const lines = segment.code.split('\n');
  const isDiff = segment.language === 'diff' || lines.some((l) => /^[+-@]/.test(l));
  const capped = lines.slice(0, MAX_CODE_LINES);
  const overflow = lines.length - MAX_CODE_LINES;

  return (
    <Box flexDirection="column">
      <Text color={borderColor}>{'│'}</Text>
      {/* Language label with copy index */}
      <Text>
        <Text color={borderColor}>{'│  '}</Text>
        <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
        <Text> </Text>
        <Text dimColor>{segment.language || 'code'}</Text>
        {segment.index !== undefined && <Text color="#585858">{` [${segment.index}]`}</Text>}
      </Text>
      {/* Code lines */}
      {capped.map((line, i) => (
        <Text key={`code-${i}`}>
          <Text color={borderColor}>{'│  '}</Text>
          <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
          <Text> </Text>
          {isDiff ? <DiffLine line={line} maxWidth={codeWidth} /> : <Text>{truncateCodeLine(line, codeWidth)}</Text>}
        </Text>
      ))}
      {/* Overflow indicator */}
      {overflow > 0 && (
        <Text>
          <Text color={borderColor}>{'│  '}</Text>
          <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
          <Text> </Text>
          <Text dimColor>{'… '}{overflow}{' more lines'}</Text>
        </Text>
      )}
      <Text color={borderColor}>{'│'}</Text>
    </Box>
  );
}

// ── Rich Markdown Rendering ──────────────────────────────────────────

/** Render a single inline span with styles */
function RichSpanView({ span }: { span: InlineSpan }) {
  if (span.style.code) {
    return <Text color="#a78bfa">{span.text}</Text>;
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
  const border = borderColor ? <Text color={borderColor}>{'│ '}</Text> : null;
  const indent = line.indent > 0 ? '  '.repeat(line.indent) : '';

  if (line.kind === 'blank') return <Text>{border}{' '}</Text>;

  if (line.kind === 'hr') return <Text>{border}<Text dimColor>{'─'.repeat(40)}</Text></Text>;

  if (line.kind === 'h1') return <Text>{border}{indent}<Text bold color="cyan">{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text></Text>;
  if (line.kind === 'h2') return <Text>{border}{indent}<Text bold>{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text></Text>;
  if (line.kind === 'h3') return <Text>{border}{indent}<Text bold dimColor>{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text></Text>;

  if (line.kind === 'blockquote') {
    return <Text>{border}{indent}<Text dimColor>{'│ '}</Text>{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text>;
  }

  const marker = line.marker ?? '';
  return <Text>{border}{indent}{marker}{line.spans.map((s, i) => <RichSpanView key={i} span={s} />)}</Text>;
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
  const sepLine = colWidths.map(w => '─'.repeat(w)).join('──');

  return (
    <Box flexDirection="column">
      <Text><Text color={borderColor}>{'│ '}</Text><Text bold>{headerLine}</Text></Text>
      <Text><Text color={borderColor}>{'│ '}</Text><Text dimColor>{sepLine}</Text></Text>
      {rows.map((row, ri) => (
        <Text key={`tr-${ri}`}><Text color={borderColor}>{'│ '}</Text>{row.map((cell, ci) => padCell(cell, ci)).join('  ')}</Text>
      ))}
    </Box>
  );
}

/** Render parsed markdown segments inside an engine block */
function RenderedSegments({ segments, borderColor, wrapWidth }: {
  segments: ContentSegment[];
  borderColor: string;
  wrapWidth: number;
}) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'prose') {
          const richLines = parseProseToRichLines(seg.text ?? '', wrapWidth);
          if (richLines.length === 0) return null;
          return (
            <Box key={`seg-${i}`} flexDirection="column">
              {richLines.map((line, j) => (
                <RichLineView key={`rl-${i}-${j}`} line={line} borderColor={borderColor} />
              ))}
            </Box>
          );
        }
        if (seg.type === 'table') {
          return <MarkdownTableView key={`seg-${i}`} headers={seg.headers} rows={seg.rows} alignments={seg.alignments} borderColor={borderColor} />;
        }
        // code segment (type narrowed to 'code')
        return <CodeBlockView key={`seg-${i}`} segment={seg} borderColor={borderColor} />;
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
    // Grayscale: 232-255 → 8 to 238
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
function engineColor(id: string): string {
  return color256toHex(ENGINE_COLORS[id] ?? 245);
}

function EngineBlock({ engineId, color, content }: { engineId: string; color: number; content: string }) {
  const wrapWidth = contentWidth(8);
  const cleaned = cleanEngineOutput(content);
  const hexColor = color256toHex(color);

  if (!cleaned.trim()) {
    return (
      <Box flexDirection="column" marginY={0} paddingLeft={2}>
        <Text color={hexColor}>{'┌── '}<Text bold>{engineId}</Text></Text>
        <Text color={hexColor}>{'│ '}<Text dimColor>{'(no response)'}</Text></Text>
        <Text color={hexColor}>{'└──'}</Text>
      </Box>
    );
  }

  const segments = parseMarkdownBlocks(cleaned);

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Text color={hexColor}>{'┌── '}<Text bold color={hexColor}>{engineId}</Text></Text>
      <Text color={hexColor}>{'│'}</Text>
      <RenderedSegments segments={segments} borderColor={hexColor} wrapWidth={wrapWidth} />
      <Text color={hexColor}>{'└──'}</Text>
    </Box>
  );
}

// ── Conversational Mode Components ──────────────────────────────────

function ConversationalResponse({ engineId, content }: { engineId: string; content: string }) {
  const wrapWidth = contentWidth(6);
  const cleaned = cleanEngineOutput(content);
  if (!cleaned.trim()) return null;
  const segments = parseMarkdownBlocks(cleaned);
  const accentColor = color256toHex(ENGINE_COLORS[engineId] ?? 245);
  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <RenderedSegments segments={segments} borderColor={accentColor} wrapWidth={wrapWidth} />
    </Box>
  );
}

const AGON_TIPS = [
  'Run /forge <task> test with <cmd> to make engines compete on code',
  'Run /brainstorm to get confidence bids from all engines',
  'Run /tribunal to start a multi-AI debate',
  'Run /use <engine> to change your default chat engine',
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

function StatusLine({ startTime }: { startTime: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = Math.floor((now - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text>
        <Text color="#f97316"><Spinner type="dots" /></Text>
        <Text color="#f97316">{' Thinking\u2026'}</Text>
        <Text dimColor>{` (${timeStr})`}</Text>
      </Text>
      {elapsed >= 5 && <AgonTip />}
    </Box>
  );
}

// ── Output Block Rendering ──────────────────────────────────────────

function OutputBlockView({ event, mode }: { event: OutputEvent; mode: string }) {
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
      : <Text dimColor>{'  ─'.padEnd(50, '─')}</Text>;
    case 'header': return <Box flexDirection="column"><Text>{' '}</Text><Text bold color="cyan">{'  ▸ '}{event.title}</Text></Box>;
    case 'success': return <Text>{'  '}<Text color="green">{'✓'}</Text>{' '}{event.message}</Text>;
    case 'error': return <Text>{'  '}<Text color="red">{'✗'}</Text>{' '}{event.message}</Text>;
    case 'warning': return <Text>{'  '}<Text color="yellow">{'⚠'}</Text>{' '}{event.message}</Text>;
    case 'info': return <Text dimColor>{'  '}{event.message}</Text>;
    case 'table': return <TableView headers={event.headers} rows={event.rows} />;
    case 'streaming-chunk': return <Text>{'  '}{event.chunk}</Text>;
    case 'kern-draft': {
      const eColor = engineColor(event.engineId);
      const wrapWidth = contentWidth(8);
      const segments = parseMarkdownBlocks(event.content.trim());
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={eColor}>{'┌── '}<Text bold>{event.engineId}</Text>{event.critique ? <Text color="green">{' '}{event.critique}</Text> : ''}</Text>
          <Text color={eColor}>{'│'}</Text>
          <RenderedSegments segments={segments} borderColor={eColor} wrapWidth={wrapWidth} />
          <Text color={eColor}>{'└──'}</Text>
        </Box>
      );
    }
    case 'debate-round': {
      const dColor = engineColor(event.engineId);
      const wrapWidth = contentWidth(8);
      const segments = parseMarkdownBlocks(event.argument.trim());
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={dColor}>{'┌── '}<Text bold>{event.engineId}</Text>{' '}<Text dimColor>{'('}{event.position}{')'}</Text></Text>
          <Text color={dColor}>{'│'}</Text>
          <RenderedSegments segments={segments} borderColor={dColor} wrapWidth={wrapWidth} />
          <Text color={dColor}>{'└──'}</Text>
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
        {event.winner && <Text bold color="green">{'  ★ Winner: '}{event.winner}</Text>}
        <Text dimColor>{'  '}{('─').repeat(46)}</Text>
        {event.metrics.map((m) => (
          <Box key={m.label}>
            <Text>{'  '}</Text>
            <Box width={16}><Text bold>{m.label}</Text></Box>
            <Text>{m.values.join('  │  ')}</Text>
          </Box>
        ))}
      </Box>
    );
    case 'plan': return (
      <Box flexDirection="column" paddingLeft={2} marginY={1}>
        <Text bold color="cyan">{'▸ Plan: '}{event.plan.id.slice(0, 12)}</Text>
        <Text>{'  State: '}<Text bold>{event.plan.state}</Text></Text>
        <Text>{'  Task:  '}{event.plan.action.task}</Text>
        <Text dimColor>{'  '}{('─').repeat(46)}</Text>
        {event.plan.steps.map((step) => (
          <Box key={step.id}>
            <Text>{'  '}</Text>
            <Text color={step.result.state === 'completed' ? 'green' : step.result.state === 'failed' ? 'red' : step.result.state === 'running' ? 'yellow' : undefined}>
              {step.result.state === 'completed' ? '✓' : step.result.state === 'failed' ? '✗' : step.result.state === 'running' ? '◉' : '○'}
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
    case 'response-meta': {
      const secs = (event.elapsed / 1000).toFixed(1);
      return (
        <Box paddingLeft={2}>
          <Text dimColor>{event.engineId} · {secs}s</Text>
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
      <Text dimColor>{'─'.repeat(widths.reduce((a, b) => a + b, 0))}</Text>
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

function SlashPicker({ commands, onSelect, onCancel }: {
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
    // Printable characters → filter
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
        <Text dimColor>{'█'}</Text>
        <Text dimColor>{'  ↑↓ navigate  Enter select  Esc cancel'}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(48)}</Text>
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
                  {i === selectedIndex ? ' ❯ ' : '   '}{cmd.cmd.padEnd(16)}
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

const VERSION = '0.1.0';

// ── Engine Picker (interactive /models) ──────────────────────────────

function EnginePicker({ available, initialSelected, onConfirm, onCancel }: {
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
      <Text dimColor>{'Space toggle  ↑↓ navigate  a all  n none  Enter confirm  Esc cancel'}</Text>
      <Text dimColor>{'─'.repeat(48)}</Text>
      {available.map((id, i) => (
        <Box key={id}>
          <Text color={i === cursor ? 'yellow' : undefined}>
            {i === cursor ? ' ❯ ' : '   '}
          </Text>
          <Text color={selected.has(id) ? 'green' : 'red'}>
            {selected.has(id) ? '◉' : '○'}
          </Text>
          <Text>{' '}</Text>
          <Text bold color={engineColor(id)}>{id}</Text>
          {!selected.has(id) && <Text dimColor>{' (disabled)'}</Text>}
        </Box>
      ))}
      <Text dimColor>{'─'.repeat(48)}</Text>
      <Text dimColor>{selected.size}{' of '}{available.length}{' selected'}</Text>
    </Box>
  );
}

// ── Review Block (Forge patch review) ────────────────────────────────

interface ReviewEvent {
  winnerId: string;
  patchPath: string;
  patchContent: string;
}

function ReviewBlock({ event, onAction }: {
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
      <Text color={eColor}>{'┌── Winner: '}<Text bold>{event.winnerId}</Text></Text>
      {lines.map((line, i) => (
        <Text key={`rv-${i}`}>
          <Text color={eColor}>{'│ '}</Text>
          <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
          <Text> </Text>
          <DiffLine line={line} maxWidth={codeWidth} />
        </Text>
      ))}
      {overflow > 0 && (
        <Text>
          <Text color={eColor}>{'│ '}</Text>
          <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
          <Text> </Text>
          <Text dimColor>{'… '}{overflow}{' more lines'}</Text>
        </Text>
      )}
      <Text color={eColor}>{'└── '}<Text bold color="green">{'[A]'}</Text>{'pply  '}<Text bold color="cyan">{'[E]'}</Text>{'dit  '}<Text bold color="red">{'[R]'}</Text>{'eject  '}<Text bold color="yellow">{'[C]'}</Text>{'opy'}</Text>
    </Box>
  );
}

// ── Background Job Rail ──────────────────────────────────────────────

function BackgroundJobRail({ jobs }: { jobs: Job[] }) {
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

// ── Main App ─────────────────────────────────────────────────────────

// Module-level refs so SIGINT handler can cancel ALL running operations
const _activeAborts = new Set<AbortController>();
let _cancelCallback: (() => void) | null = null;

function App() {
  const { exit } = useApp();
  const [replState, setReplState] = useState<ReplState>('idle');
  const [outputBlocks, setOutputBlocks] = useState<OutputBlock[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [mode, setMode] = useState<'chat' | 'campfire' | 'brainstorm' | 'tribunal'>('chat');
  const [sessionStartTime] = useState(() => Date.now());
  const [liveSpinner, setLiveSpinner] = useState<{ message: string; color?: number } | null>(null);
  const [liveProgress, setLiveProgress] = useState<EngineProgress[] | null>(null);
  const [slashPickerOpen, setSlashPickerOpen] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [questionState, setQuestionState] = useState<{ prompt: string; resolve: (answer: string) => void } | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [enginePickerOpen, setEnginePickerOpen] = useState(false);
  const [streamingText, setStreamingText] = useState<{ engineId: string; content: string } | null>(null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent | null>(null);
  const [jobManager] = useState(() => new JobManager());
  const [jobList, setJobList] = useState<Job[]>([]);
  const [lastUndoToken, setLastUndoToken] = useState<string | null>(null);
  const chatStartTimeRef = useRef<number>(0);

  // Module-level state (mutable refs via closures)
  // Load persisted engine selection from config — null means "all available"
  const [sessionEngines, setSessionEngines] = useState<string[] | null>(() => {
    const cfg = loadConfig();
    const saved = cfg.forgeEnabledEngines;
    return saved && saved.length > 0 ? saved : null;
  });
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const currentPlanRef = useRef<Plan | null>(currentPlan);
  currentPlanRef.current = currentPlan;
  const [chatSession, setChatSession] = useState<ChatSession>(() => {
    let branch = 'unknown';
    try { branch = currentBranch(process.cwd()); } catch {}
    return startChatSession({ cwd: process.cwd(), branch });
  });
  const [activeAbort, _setActiveAbort] = useState<AbortController | null>(null);
  const setActiveAbort = useCallback((abort: AbortController | null) => {
    // Track all active aborts for concurrent job cancellation
    if (abort) _activeAborts.add(abort);
    _setActiveAbort(abort);
  }, []);
  const [registry] = useState<EngineRegistry>(() => {
    const reg = new EngineRegistry();
    const enginesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../engines');
    reg.load(enginesDir);
    return reg;
  });
  const [adapter] = useState<EngineAdapter>(() => createCliAdapter(registry));

  // ── Bracketed paste mode ──
  const pasteBufferRef = useRef<string | null>(null);
  const isPastingRef = useRef(false);

  useEffect(() => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return;

    // Enable bracketed paste mode
    process.stdout.write('\x1b[?2004h');

    const onData = (data: Buffer) => {
      const str = data.toString();

      if (str.includes('\x1b[200~')) {
        // Paste start marker
        isPastingRef.current = true;
        const afterMarker = str.split('\x1b[200~').slice(1).join('');
        pasteBufferRef.current = afterMarker.replace(/\x1b\[201~/g, '');
        if (str.includes('\x1b[201~')) {
          // Paste ended in same chunk
          isPastingRef.current = false;
          const content = pasteBufferRef.current;
          pasteBufferRef.current = null;
          if (content) {
            setInputValue((prev) => prev + content);
          }
        }
        return;
      }

      if (isPastingRef.current) {
        if (str.includes('\x1b[201~')) {
          // Paste end marker
          const beforeMarker = str.split('\x1b[201~')[0];
          const content = (pasteBufferRef.current ?? '') + beforeMarker;
          isPastingRef.current = false;
          pasteBufferRef.current = null;
          if (content) {
            setInputValue((prev) => prev + content);
          }
        } else {
          pasteBufferRef.current = (pasteBufferRef.current ?? '') + str;
        }
        return;
      }
    };

    stdin.on('data', onData);

    return () => {
      // Disable bracketed paste mode
      process.stdout.write('\x1b[?2004l');
      stdin.off('data', onData);
    };
  }, []);

  // ── Render dashboard on mount (stays in history) ──
  useEffect(() => {
    const available = registry.availableIds();
    const config = loadConfig();
    const elo = getElo();
    const defaultEngine = config.forgeFixedStarter ?? available[0] ?? 'none';
    const activeWs = getActiveWorkspace();
    const totalMatches = Object.values(elo.global).reduce((sum, r) => sum + r.wins + r.losses, 0);
    const sorted = Object.entries(elo.global).sort(([, a], [, b]) => b.rating - a.rating);
    const enabled = sessionEngines ?? available;

    let runCount = 0;
    try { runCount = readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')).length; } catch { /* no runs */ }

    setOutputBlocks([{
      id: 0,
      event: {
        type: 'dashboard' as const,
        available,
        enabled,
        defaultEngine,
        eloTop: sorted.length > 0 ? { id: sorted[0][0], rating: sorted[0][1].rating } : undefined,
        totalForges: Math.floor(totalMatches / 2),
        workspace: activeWs ? { name: activeWs.name, path: activeWs.path, isKern: activeWs.isKern } : undefined,
        runCount,
      },
    }]);
  }, []); // Run once on mount

  // ── Dispatch: handlers call this, UI reacts ──
  const dispatch = useCallback((event: OutputEvent) => {
    switch (event.type) {
      case 'spinner-start':
        chatStartTimeRef.current = Date.now();
        setLiveSpinner({ message: event.message, color: event.color });
        break;
      case 'spinner-stop':
        setLiveSpinner(null);
        if (event.message) {
          setOutputBlocks((prev) => [...prev, { id: Date.now(), event: { type: 'success', message: event.message! } }]);
        }
        break;
      case 'spinner-update':
        setLiveSpinner((prev) => prev ? { ...prev, message: event.message } : null);
        break;
      case 'progress-update':
        setLiveProgress(event.engines);
        break;
      case 'progress-clear':
        setLiveProgress(null);
        break;
      case 'streaming-chunk':
        // Accumulate into a single growing stream block
        setStreamingText((prev) => {
          if (prev && prev.engineId === event.engineId) {
            return { engineId: event.engineId, content: prev.content + event.chunk };
          }
          return { engineId: event.engineId, content: event.chunk };
        });
        break;
      case 'streaming-end':
        // Explicitly flush streaming buffer to output blocks
        setStreamingText((prev) => {
          if (prev) {
            const color = ENGINE_COLORS[prev.engineId] ?? 245;
            // Record code blocks for /cp
            const cleaned = cleanEngineOutput(prev.content);
            const segments = parseMarkdownBlocks(cleaned);
            codeBlockBuffer.recordFromSegments(segments);
            setOutputBlocks((blocks) => {
              const updated = [...blocks, {
                id: Date.now(),
                event: { type: 'engine-block' as const, engineId: prev.engineId, color, content: prev.content },
              }];
              // In chat mode, append response-meta with timing info
              if (mode === 'chat' && chatStartTimeRef.current > 0) {
                updated.push({
                  id: Date.now() + 1,
                  event: { type: 'response-meta' as const, engineId: prev.engineId, elapsed: Date.now() - chatStartTimeRef.current },
                });
              }
              return updated;
            });
          }
          return null;
        });
        break;
      case 'clear':
        setOutputBlocks([]);
        setStreamingText(null);
        break;
      case 'patch-review':
        setReviewEvent({ winnerId: event.winnerId, patchPath: event.patchPath, patchContent: event.patchContent });
        break;
      case 'question':
        setQuestionState({ prompt: event.prompt, resolve: event.resolve });
        break;
      default:
        // Record code blocks for /cp from engine-block events
        if (event.type === 'engine-block') {
          const cleaned = cleanEngineOutput(event.content);
          const segments = parseMarkdownBlocks(cleaned);
          codeBlockBuffer.recordFromSegments(segments);
        }
        // If we were streaming, flush to output blocks first
        if (event.type === 'text' || event.type === 'engine-block' || event.type === 'separator') {
          setStreamingText((prev) => {
            if (prev) {
              const color = ENGINE_COLORS[prev.engineId] ?? 245;
              setOutputBlocks((blocks) => [...blocks, {
                id: Date.now() - 1,
                event: { type: 'engine-block', engineId: prev.engineId, color, content: prev.content },
              }]);
            }
            return null;
          });
        }
        setOutputBlocks((prev) => {
          const updated = [...prev, { id: Date.now() + Math.random(), event }];
          // In chat mode, append response-meta after engine-block events
          if (mode === 'chat' && event.type === 'engine-block' && chatStartTimeRef.current > 0) {
            updated.push({
              id: Date.now() + 0.5,
              event: { type: 'response-meta' as const, engineId: event.engineId, elapsed: Date.now() - chatStartTimeRef.current },
            });
          }
          return updated;
        });
    }
  }, []);

  // ── Ask question (used by handlers for user prompts) ──
  const askQuestion = useCallback((prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      dispatch({ type: 'question', prompt, resolve });
    });
  }, [dispatch]);

  // ── Active engines helper ──
  const activeEngines = useCallback((): string[] => {
    const available = registry.availableIds();
    if (!sessionEngines) return available;
    return sessionEngines.filter((id) => available.includes(id));
  }, [registry, sessionEngines]);

  // ── Build handler context ──
  // Use a getter for currentPlan so long-running handlers always see latest state
  const buildContext = useCallback((): HandlerContext => ({
    registry,
    adapter,
    activeEngines,
    config: loadConfig(),
    chatSession,
    get currentPlan() { return currentPlanRef.current; },
    setCurrentPlan,
    setActiveAbort,
    askQuestion,
  }), [registry, adapter, activeEngines, chatSession, askQuestion]);

  // ── Input change + slash picker trigger ──
  const handleInputChange = useCallback((value: string) => {
    // Strip bracketed paste escape sequences and Tab chars
    const cleaned = value.replace(/\x1b\[20[01]~/g, '').replace(/\[200~/g, '').replace(/\[201~/g, '').replace(/\t/g, '');
    setInputValue(cleaned);
  }, []);

  // ── Handle input submission ──
  const handleSubmit = useCallback(async (value: string) => {
    const input = value.replace(/\x1b\[20[01]~/g, '').replace(/\[200~/g, '').replace(/\[201~/g, '').trim();
    if (!input) return;

    setInputValue('');
    setInputHistory((prev) => [...prev, input]);
    setHistoryIndex(-1);

    // Allow input during background jobs — only block on truly modal operations
    if (replState !== 'idle' && !jobManager.running().length) {
      dispatch({ type: 'warning', message: 'A command is running. Please wait...' });
      return;
    }

    setReplState('busy');
    dispatch({ type: 'separator' });
    dispatch({ type: 'user-message', content: input });

    // Extract images from input (drag-and-drop paths, inline paths)
    const { text: cleanInput, images: detectedImages } = extractImagesFromInput(input, process.cwd());
    const allImages = [...pendingImages, ...detectedImages];

    let intent = detectIntent(cleanInput || input);

    // Mode switching — /campfire, /brainstorm, /tribunal, /chat switch modes
    // If the command has no argument, just switch mode and show confirmation
    if (intent.type === 'campfire' && !intent.topic) {
      setMode('campfire');
      dispatch({ type: 'success', message: 'Switched to campfire mode — just talk, all engines think together' });
      setReplState('idle');
      return;
    }
    if (intent.type === 'brainstorm' && !intent.question) {
      setMode('brainstorm');
      dispatch({ type: 'success', message: 'Switched to brainstorm mode — engines bid on your questions' });
      setReplState('idle');
      return;
    }
    if (intent.type === 'tribunal' && !intent.question) {
      setMode('tribunal');
      dispatch({ type: 'success', message: 'Switched to tribunal mode — engines debate your questions' });
      setReplState('idle');
      return;
    }
    if (intent.type === 'chat') {
      if (mode !== 'chat') {
        setMode('chat');
        dispatch({ type: 'success', message: 'Switched to chat mode' });
      }
      // If there's actual input, process it
      if (!intent.input?.trim()) {
        setReplState('idle');
        return;
      }
    }

    // In a non-chat mode, route plain text to the mode's handler
    if (intent.type === 'unknown' && mode !== 'chat') {
      switch (mode) {
        case 'campfire': intent = { type: 'campfire', topic: input }; break;
        case 'brainstorm': intent = { type: 'brainstorm', question: input }; break;
        case 'tribunal': intent = { type: 'tribunal', question: input }; break;
      }
    }


    const ctx = buildContext();

    // Helper: run a long-running command as a tracked job
    const runAsJob = (type: string, label: string, fn: () => Promise<void>) => {
      const job = jobManager.create(type, label);
      setJobList([...jobManager.list()]);
      // Run in background — don't await, return input to idle immediately
      setReplState('idle');
      fn().then(() => {
        jobManager.complete(job.id);
        setJobList([...jobManager.list()]);
      }).catch((err) => {
        jobManager.fail(job.id, err instanceof Error ? err.message : String(err));
        setJobList([...jobManager.list()]);
        dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    };

    try {
      switch (intent.type) {
        case 'forge': {
          const forgeStart = Date.now();
          runAsJob('forge', intent.task?.slice(0, 40) ?? 'forge', async () => {
            await handleForge(intent.task, intent.fitnessCmd, dispatch, ctx);
            autoLogFlow(ctx, 'forge', forgeStart, 'completed', { forgeId: ctx.currentPlan?.id, winnerEngine: ctx.currentPlan?.steps?.find((s: any) => s.result.artifacts?.some((a: any) => a.type === 'patch'))?.result.artifacts?.find((a: any) => a.type === 'patch')?.engineId });
          });
          return; // Don't hit finally — job manages state
        }
        case 'brainstorm': {
          runAsJob('brainstorm', intent.question?.slice(0, 40) ?? 'brainstorm', () => handleBrainstorm(intent.question, dispatch, ctx));
          return;
        }
        case 'tribunal': {
          runAsJob('tribunal', intent.question?.slice(0, 40) ?? 'tribunal', () => handleTribunal(intent.question, dispatch, ctx, (intent as any).tribunalMode));
          return;
        }
        case 'campfire': {
          runAsJob('campfire', intent.topic?.slice(0, 40) ?? 'campfire', () => handleCampfire(intent.topic, dispatch, ctx));
          return;
        }
        case 'img': {
          const att = buildImageAttachment(intent.path, process.cwd());
          if (!att) dispatch({ type: 'error', message: `Image not found: ${intent.path}` });
          else {
            setPendingImages(prev => [...prev, att]);
            dispatch({ type: 'success', message: `Attached: ${att.filename}` });
          }
          break;
        }
        case 'build': {
          runAsJob('build', intent.input?.slice(0, 40) ?? 'build', () => handleBuild(intent.input, dispatch, ctx));
          return;
        }
        case 'pipeline': {
          runAsJob('pipeline', intent.task?.slice(0, 40) ?? 'pipeline', () =>
            handlePipeline(intent.task, dispatch, ctx, intent.fitnessCmd ?? undefined));
          return;
        }
        case 'run': await handleRun(intent.input, dispatch, ctx); break;
        case 'chat': setPendingImages([]); await handleChat(intent.input, dispatch, ctx, allImages); break;
        case 'leaderboard': handleLeaderboard(dispatch); break;
        case 'history': handleHistory(dispatch, intent.id); break;
        case 'engines': await handleEngines(dispatch, ctx); break;
        case 'discover': await handleDiscover(dispatch, ctx); break;
        case 'provider': await handleProvider(intent.action, intent.args, dispatch, ctx); break;
        case 'config': handleConfig(intent, dispatch); break;
        case 'use': handleUse(intent.engineIds, dispatch, ctx, setSessionEngines); break;
        case 'tokens': handleTokens(dispatch); break;
        case 'models': setEnginePickerOpen(true); break;
        case 'slash-list': dispatch({ type: 'text', content: SLASH_COMMANDS.map((c) => `${c.cmd.padEnd(16)} ${c.desc}`).join('\n') }); break;
        case 'workspace': handleWorkspace(intent.action, dispatch, intent.path); break;
        case 'flow': await handleFlowReport(dispatch, ctx, mode, sessionStartTime); break;
        case 'flows': handleFlowAnalysis(dispatch); break;
        case 'chats': handleChats(dispatch, intent.sessionId); break;
        case 'chats-resume' as string: {
          const sid = (intent as any).sessionId as string | undefined;
          if (!sid) {
            dispatch({ type: 'error', message: 'Usage: /chats resume <session-id>' });
            break;
          }
          const resumed = resumeChatSession(sid);
          if (resumed) {
            setChatSession(resumed);
            dispatch({ type: 'success', message: `Resumed session: ${resumed.id}` });
            dispatch({ type: 'info', message: `${resumed.messages.length} messages, started ${resumed.startedAt.slice(0, 10)}` });
            if (resumed.cwd) dispatch({ type: 'info', message: `Workspace: ${resumed.cwd}` });
          } else {
            dispatch({ type: 'error', message: `Session not found: ${sid}` });
          }
          break;
        }
        case 'plan': handlePlanShow(dispatch, ctx, intent.planId); break;
        case 'plans': handlePlansList(dispatch); break;
        case 'approve': await handleApprove(dispatch, ctx); break;
        case 'retry': await handleRetry(dispatch, ctx); break;
        case 'cancel': handleCancel(dispatch, ctx); break;
        case 'apply': await handleApplyPatch(dispatch, ctx, intent.patchPath, intent.force); break;
        case 'cp': handleCp(intent.index, dispatch); break;
        case 'undo' as string: {
          if (!lastUndoToken) {
            dispatch({ type: 'warning', message: 'Nothing to undo. Apply a forge patch first.' });
            break;
          }
          const undoResult = undoPatch(process.cwd(), lastUndoToken);
          if (undoResult.ok) {
            dispatch({ type: 'success', message: 'Patch reverted successfully.' });
            setLastUndoToken(null);
          } else {
            dispatch({ type: 'error', message: undoResult.error ?? 'Undo failed' });
          }
          break;
        }
        case 'jobs' as string: {
          const allJobs = jobManager.list();
          if (allJobs.length === 0) {
            dispatch({ type: 'info', message: 'No jobs.' });
          } else {
            dispatch({ type: 'header', title: 'Jobs' });
            const rows = allJobs.map((j: Job) => [
              j.id,
              j.type,
              j.state,
              j.label.slice(0, 40),
              j.startedAt.slice(11, 19),
            ]);
            dispatch({ type: 'table', headers: ['ID', 'Type', 'State', 'Label', 'Started'], rows });
          }
          break;
        }
        case 'focus' as string: {
          const focusId = (intent as any).jobId;
          if (!focusId) {
            dispatch({ type: 'info', message: 'Usage: /focus <job-id>' });
            break;
          }
          const job = jobManager.get(focusId);
          if (!job) {
            dispatch({ type: 'error', message: `Job not found: ${focusId}` });
          } else {
            dispatch({ type: 'info', message: `Job ${job.id}: ${job.type} — ${job.state} — ${job.label}` });
            if (job.error) dispatch({ type: 'error', message: job.error });
          }
          break;
        }
        case 'clear': dispatch({ type: 'clear' }); codeBlockBuffer.clear(); dispatch({ type: 'info', message: 'Chat history cleared.' }); break;
        case 'help': dispatch({ type: 'text', content: SLASH_COMMANDS.map((c) => `${c.cmd.padEnd(16)} ${c.desc}`).join('\n') }); break;
        case 'exit': exit(); return;
        case 'suggest-brainstorm' as string: {
          // Conversational trigger — ask before escalating
          const si = intent as any;
          const answer = await askQuestion('Brainstorm with all engines? (y/n)');
          if (answer.toLowerCase().startsWith('y')) {
            runAsJob('brainstorm', si.question?.slice(0, 40) ?? 'brainstorm', () =>
              handleBrainstorm(si.question ?? si.input, dispatch, ctx));
            return;
          }
          await handleChat(si.input, dispatch, ctx, allImages);
          break;
        }
        case 'suggest-tribunal' as string: {
          const si = intent as any;
          const answer = await askQuestion('Debate with all engines? (y/n)');
          if (answer.toLowerCase().startsWith('y')) {
            runAsJob('tribunal', si.question?.slice(0, 40) ?? 'tribunal', () =>
              handleTribunal(si.question ?? si.input, dispatch, ctx));
            return;
          }
          await handleChat(si.input, dispatch, ctx, allImages);
          break;
        }
        case 'suggest-forge' as string: {
          const si = intent as any;
          const answer = await askQuestion('Forge — engines compete to build? (y/n)');
          if (answer.toLowerCase().startsWith('y')) {
            runAsJob('forge', si.task?.slice(0, 40) ?? 'forge', async () => {
              await handleForge(si.task ?? si.input, si.fitnessCmd, dispatch, ctx);
            });
            return;
          }
          await handleChat(si.input, dispatch, ctx, allImages);
          break;
        }
        case 'auto': {
          // ── Auto-router: Claude Code-like experience ──
          // Progressive dispatch: question→chat(no tools), code+single→build,
          // code+multi→silent pipeline, ambiguous+multi→Cesar scouts
          setPendingImages([]);
          const activeIds = ctx.activeEngines();
          const agentCapable = new Set(ctx.registry.agentCapableIds());
          const agentIds = activeIds.filter((id: string) => agentCapable.has(id));
          const multiEngine = agentIds.length > 1;
          const taskClass = (intent as any).taskClass as 'code' | 'question' | 'ambiguous';

          if (taskClass === 'question') {
            await handleChat(intent.input, dispatch, ctx, allImages, { toolPolicy: 'none' });
          } else if (taskClass === 'code' && multiEngine) {
            runAsJob('pipeline', intent.input?.slice(0, 40) ?? 'auto', () =>
              handlePipeline(intent.input, dispatch, ctx, undefined, { quiet: true }));
            return;
          } else if (taskClass === 'code' && agentIds.length > 0) {
            runAsJob('build', intent.input?.slice(0, 40) ?? 'auto', () =>
              handleBuild(intent.input, dispatch, ctx));
            return;
          } else if (taskClass === 'ambiguous' && multiEngine) {
            const autoStart = Date.now();
            runAsJob('cesar', intent.input?.slice(0, 40) ?? 'routing', async () => {
              const decision = await routeViaCesar(intent.input, dispatch, ctx, 'ambiguous');
              switch (decision.action) {
                case 'build': await handleBuild(intent.input, dispatch, ctx); break;
                case 'pipeline': await handlePipeline(intent.input, dispatch, ctx, undefined, { quiet: true }); break;
                case 'chat': await handleChat(intent.input, dispatch, ctx, allImages); break;
                case 'campfire': await handleCampfire(intent.input ?? '', dispatch, ctx); break;
                case 'forge': dispatch({ type: 'info', message: `Cesar suggests forge — use /forge <task> test with <cmd>` }); break;
              }
              autoLogFlow(ctx, 'cesar', autoStart, 'completed', { taskType: `auto→${decision.action}` });
            });
            return;
          } else {
            // Fallback: single engine, ambiguous or no agent — use chat with tools
            await handleChat(intent.input, dispatch, ctx, allImages);
          }
          break;
        }
        case 'unknown': {
          setPendingImages([]);
          await handleChat(intent.input, dispatch, ctx, allImages);
          break;
        }
      }
    } catch (err) {
      dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setReplState('idle');
    }
  }, [replState, dispatch, buildContext, slashPickerOpen, exit, mode, pendingImages, jobManager]);

  // ── Handle review action ──
  const handleReviewAction = useCallback((action: 'apply' | 'edit' | 'reject' | 'copy') => {
    if (!reviewEvent) return;
    switch (action) {
      case 'apply': {
        // Show structured summary before applying
        const files = parsePatch(reviewEvent.patchContent);
        const summary = patchSummary(files);
        dispatch({ type: 'info', message: summary });

        const result = applyPatchWithUndo(process.cwd(), reviewEvent.patchContent);
        if (result.ok) {
          dispatch({ type: 'success', message: `Patch applied from ${reviewEvent.winnerId}` });
          if (result.undoToken) {
            setLastUndoToken(result.undoToken);
            dispatch({ type: 'info', message: `Undo available: /undo` });
          }
        } else {
          dispatch({ type: 'error', message: `Apply failed: ${result.error ?? 'unknown error'}` });
        }
        break;
      }
      case 'edit':
        try {
          const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
          spawnSync(editor, [reviewEvent.patchPath], { stdio: 'inherit' });
          dispatch({ type: 'info', message: `Opened ${reviewEvent.patchPath} in ${editor}` });
        } catch (err) {
          dispatch({ type: 'error', message: `Editor failed: ${err instanceof Error ? err.message : String(err)}` });
        }
        break;
      case 'reject':
        dispatch({ type: 'info', message: 'Patch rejected.' });
        break;
      case 'copy':
        try {
          copyToClipboard(reviewEvent.patchContent);
          dispatch({ type: 'success', message: 'Patch copied to clipboard' });
        } catch (err) {
          dispatch({ type: 'error', message: `Copy failed: ${err instanceof Error ? err.message : String(err)}` });
        }
        break;
    }
    setReviewEvent(null);
  }, [reviewEvent, dispatch]);

  // ── Handle slash picker selection ──
  const handleSlashSelect = useCallback((cmd: string) => {
    setSlashPickerOpen(false);
    setInputValue(cmd + ' ');
    setInputKey((k) => k + 1); // Force TextInput remount → cursor at end
  }, []);

  // ── Handle question answer ──
  const handleQuestionAnswer = useCallback((answer: string) => {
    if (questionState) {
      questionState.resolve(answer);
      setQuestionState(null);
      setQuestionAnswer('');
    }
  }, [questionState]);

  // Register cancel callback for SIGINT handler
  _cancelCallback = useCallback(() => {
    for (const abort of _activeAborts) abort.abort();
    _activeAborts.clear();
    setActiveAbort(null);
    setLiveSpinner(null);
    setLiveProgress(null);
    setStreamingText(null);
    setReplState('idle');
  }, [setActiveAbort]);

  // ── History navigation + global keys ──
  useInput((input, key) => {
    // Open slash picker when typing "/" on empty input
    if (input === '/' && !inputValue && !slashPickerOpen && !enginePickerOpen && !questionState) {
      setSlashPickerOpen(true);
      return;
    }
    // Tab key accepts ghost text completion
    if ((key.tab || input === '\t') && !slashPickerOpen && !enginePickerOpen && !questionState && !reviewEvent) {
      const ghost = getGhostCompletion(inputValue, SLASH_COMMANDS);
      if (ghost) {
        setInputValue(inputValue + ghost + ' ');
        setInputKey((k) => k + 1);
        return;
      }
    }
    // Guard: don't process arrow keys when a modal overlay is active
    if (!enginePickerOpen && !questionState) {
      if (key.upArrow && inputHistory.length > 0 && !slashPickerOpen) {
        const newIndex = historyIndex === -1 ? inputHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInputValue(inputHistory[newIndex]);
      }
      if (key.downArrow && historyIndex >= 0 && !slashPickerOpen) {
        const newIndex = historyIndex + 1;
        if (newIndex >= inputHistory.length) {
          setHistoryIndex(-1);
          setInputValue('');
        } else {
          setHistoryIndex(newIndex);
          setInputValue(inputHistory[newIndex]);
        }
      }
    }
    // Ctrl+C to cancel running command or exit (always active)
    // With exitOnCtrlC: false, Ink passes this to useInput
    if (input === '\x03' || (key.ctrl && input === 'c')) {
      // Clear any pending question prompt first
      if (questionState) {
        questionState.resolve('');
        setQuestionState(null);
        setQuestionAnswer('');
      }
      if (replState !== 'idle' && activeAbort) {
        activeAbort.abort();
        setActiveAbort(null);
        setLiveSpinner(null);
        setLiveProgress(null);
        setStreamingText(null);
        dispatch({ type: 'warning', message: 'Cancelled.' });
        setReplState('idle');
      } else if (replState !== 'idle') {
        // Busy but no abort controller — force back to idle
        setLiveSpinner(null);
        setLiveProgress(null);
        setStreamingText(null);
        dispatch({ type: 'warning', message: 'Interrupted.' });
        setReplState('idle');
      } else {
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column">
      {/* Breadcrumb bar — hidden in conversational chat mode */}
      {mode !== 'chat' && (
        <Box paddingX={1}>
          <Text dimColor>{'\ud83d\udcc2 '}{process.cwd().split('/').pop()}</Text>
          <Text dimColor>{' \u2502 '}</Text>
          <Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'}>
            {mode}
          </Text>
          <Text dimColor>{' \u2502 '}</Text>
          <Text dimColor>{registry.availableIds().length}{' engines'}</Text>
          {replState !== 'idle' && (
            <>
              <Text dimColor>{' \u2502 '}</Text>
              <Text color="yellow">{replState}</Text>
            </>
          )}
        </Box>
      )}

      {/* Background job rail */}
      <BackgroundJobRail jobs={jobList.filter((j: Job) => j.state === 'running')} />

      {/* Output area — scrollable */}
      <Box flexDirection="column" flexGrow={1}>
        {outputBlocks.map((block) => (
          <OutputBlockView key={block.id} event={block.event} mode={mode} />
        ))}
        {liveSpinner && (
          mode === 'chat'
            ? <StatusLine startTime={chatStartTimeRef.current || Date.now()} />
            : <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />
        )}
        {streamingText && (() => {
          const c = engineColor(streamingText.engineId);
          const cleaned = cleanEngineOutput(streamingText.content);
          if (mode === 'chat') {
            const wrapWidth = contentWidth(6);
            const segments = parseMarkdownBlocks(cleaned);
            return (
              <Box flexDirection="column" marginY={1} paddingLeft={2}>
                <RenderedSegments segments={segments} borderColor={c} wrapWidth={wrapWidth} />
              </Box>
            );
          }
          const wrapWidth = contentWidth(8);
          const segments = parseMarkdownBlocks(cleaned);
          return (
            <Box flexDirection="column" marginY={1} paddingLeft={2}>
              <Text color={c} bold>{'┌── '}{streamingText.engineId}</Text>
              <Text color={c}>{'│'}</Text>
              <RenderedSegments segments={segments} borderColor={c} wrapWidth={wrapWidth} />
            </Box>
          );
        })()}
        {liveProgress && <EngineProgressView engines={liveProgress} />}
      </Box>

      {/* Patch review overlay */}
      {reviewEvent && (
        <ReviewBlock event={reviewEvent} onAction={handleReviewAction} />
      )}

      {/* Engine picker (interactive /models) */}
      {enginePickerOpen && (
        <EnginePicker
          available={registry.availableIds()}
          initialSelected={sessionEngines ?? registry.availableIds()}
          onConfirm={(selected) => {
            setEnginePickerOpen(false);
            setSessionEngines(selected);
            configSet('forgeEnabledEngines', selected);
            dispatch({ type: 'success', message: `Active engines: ${selected.join(', ')}` });
            dispatch({ type: 'info', message: 'Saved — persists across sessions' });
            setReplState('idle');
          }}
          onCancel={() => {
            setEnginePickerOpen(false);
            setReplState('idle');
          }}
        />
      )}

      {/* Input area — persistent at bottom */}
      {!enginePickerOpen && (
        <Box flexDirection="column" borderStyle={mode === 'chat' ? undefined : 'single'} borderColor={mode === 'chat' ? undefined : 'gray'} paddingX={1}>
          {slashPickerOpen && (
            <SlashPicker
              commands={SLASH_COMMANDS}
              onSelect={handleSlashSelect}
              onCancel={() => setSlashPickerOpen(false)}
            />
          )}
          {pendingImages.length > 0 && (
            <Box>
              <Text color="#22d3ee">{'📎 '}</Text>
              {pendingImages.map((img, i) => (
                <Text key={i} dimColor>{img.filename}{i < pendingImages.length - 1 ? ', ' : ''}</Text>
              ))}
            </Box>
          )}
          {questionState ? (
            <Box>
              <Text bold color="yellow">{questionState.prompt} </Text>
              <TextInput value={questionAnswer} onChange={setQuestionAnswer} onSubmit={handleQuestionAnswer} />
            </Box>
          ) : (
            <Box>
              {mode !== 'chat' && (
                <Text>
                  <Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'} bold>
                    {mode === 'campfire' ? '🔥' : mode === 'brainstorm' ? '💡' : '⚖'}
                    {' '}{mode}
                  </Text>
                  <Text dimColor>{' │ '}</Text>
                </Text>
              )}
              <Text color={mode === 'chat' ? undefined : '#fbbf24'}>{mode === 'chat' ? '> ' : '❯ '}</Text>
              <TextInput
                key={inputKey}
                value={inputValue}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder={replState === 'idle'
                  ? mode === 'chat' ? ''
                  : mode === 'campfire' ? 'What should we think about?'
                  : mode === 'brainstorm' ? 'What question for the engines?'
                  : 'What should they debate?'
                  : ''}
              />
              {(() => {
                const ghost = getGhostCompletion(inputValue, SLASH_COMMANDS);
                return ghost ? <Text dimColor>{ghost}</Text> : null;
              })()}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Entry point ──────────────────────────────────────────────────────

export async function startRepl(): Promise<void> {
  ensureAgonHome();
  ensureCurrentWorkspace(process.cwd());

  // Ctrl+C handler at process level — ink-text-input swallows Ctrl+C
  // so useInput never sees it. This is the primary cancel mechanism.
  process.on('SIGINT', () => {
    if (_activeAborts.size > 0) {
      for (const abort of _activeAborts) abort.abort();
      _activeAborts.clear();
      if (_cancelCallback) _cancelCallback();
    } else {
      // Idle — exit
      process.exit(0);
    }
  });

  render(<App />, { exitOnCtrlC: false });
}
