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
import type { OutputEvent, HandlerContext, EngineProgress } from './handlers/types.js';
import {
  handleForge, handleChat, handleBrainstorm, handleCampfire, handleTribunal,
  handleLeaderboard, handleHistory, handleEngines, handleDiscover,
  handleConfig, handleUse, handleTokens, handleModels, handleWorkspace, handleChats,
  handlePlanShow, handlePlansList, handleApprove, handleRetry, handleCancel,
  handleApplyPatch, handleCp,
  handleFlowReport, handleFlowAnalysis, autoLogFlow,
} from './handlers/index.js';
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

      {/* Accent bar */}
      <Text> </Text>
      <GradientLine text={'  ' + '━'.repeat(50)} colors={BRAND} />
      <Text> </Text>

      {/* Engine roster */}
      <Box>
        <Text color="#f97316">{' ⚔  '}</Text>
        <Text bold color="white">{event.available.length}{' engines'}</Text>
        <Text dimColor>{' ready to compete   '}</Text>
        {event.available.map((id) => (
          <Text key={id}>
            <Text color={engineColor(id)} bold={event.enabled.includes(id)} dimColor={!event.enabled.includes(id)}>
              {id}
            </Text>
            <Text>{'  '}</Text>
          </Text>
        ))}
      </Box>

      {/* Default chat */}
      <Box>
        <Text color="#22d3ee">{' 🧠 '}</Text>
        <Text>{'Chat default: '}</Text>
        <Text bold color={engineColor(event.defaultEngine)}>{event.defaultEngine}</Text>
        <Text dimColor>{'  (change with /use)'}</Text>
      </Box>

      {/* ELO */}
      {event.eloTop ? (
        <Box>
          <Text color="#fbbf24">{' ♛  '}</Text>
          <Text bold color={engineColor(event.eloTop.id)}>{event.eloTop.id}</Text>
          <Text>{' leads with '}<Text bold color="#fbbf24">{String(event.eloTop.rating)}</Text>{' ELO'}</Text>
          <Text dimColor>{'  ('}{event.totalForges}{' forges run)'}</Text>
        </Box>
      ) : (
        <Box>
          <Text color="#a78bfa">{' ◆  '}</Text>
          <Text dimColor>{'No forges yet — run one to see engines battle'}</Text>
        </Box>
      )}

      {/* Workspace */}
      {event.workspace && (
        <Box>
          <Text dimColor>{' 📂 '}</Text>
          <Text bold>{event.workspace.name}</Text>
          {event.workspace.isKern && <Text color="#fbbf24">{' kern'}</Text>}
          <Text dimColor>{'  '}{event.workspace.path}</Text>
        </Box>
      )}

      {/* Run count */}
      {event.runCount > 0 && (
        <Box>
          <Text dimColor>{' 📋 '}{event.runCount}{' runs in history — type "history" to browse'}</Text>
        </Box>
      )}

      <Text> </Text>

      {/* Quick start */}
      <Text bold color="white">{'  JUST TALK'}<Text dimColor>{' — or say an engine name to pick who answers'}</Text></Text>
      <GradientLine text={'  ' + '─'.repeat(50)} colors={BRAND} />
      <Box>
        <Text dimColor>{'  💬 '}</Text>
        <Text italic dimColor>{'"what do you think about the auth flow?"'}</Text>
        <Text dimColor>{'       '}</Text>
        <Text color="#fbbf24">{'→ chat'}</Text>
      </Box>
      <Box>
        <Text dimColor>{'  💬 '}</Text>
        <Text italic dimColor>{'"codex how would you approach this?"'}</Text>
        <Text dimColor>{'           '}</Text>
        <Text color="#22d3ee">{'→ codex'}</Text>
      </Box>
      <Box>
        <Text color="#f97316">{'  ⚔  '}</Text>
        <Text italic dimColor>{'"fix the login bug, test with npm test"'}</Text>
        <Text dimColor>{'        '}</Text>
        <Text color="#f97316">{'→ forge'}</Text>
      </Box>
      <Box>
        <Text color="#a78bfa">{'  ⚖  '}</Text>
        <Text italic dimColor>{'"should we use REST or GraphQL?"'}</Text>
        <Text dimColor>{'                '}</Text>
        <Text color="#a78bfa">{'→ tribunal'}</Text>
      </Box>
      <Box>
        <Text color="#22d3ee">{'  💡 '}</Text>
        <Text italic dimColor>{'"best approach for caching?"'}</Text>
        <Text dimColor>{'                   '}</Text>
        <Text color="#22d3ee">{'→ brainstorm'}</Text>
      </Box>
      <Text> </Text>
      <Text dimColor>{'  '}<Text color="#f97316">{'/'}</Text>{' for commands    '}<Text color="#f97316">{'/clear'}</Text>{' to reset chat    '}<Text color="#ef4444">{'exit'}</Text>{' to quit'}</Text>
      <Text> </Text>
    </Box>
  );
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
  const termWidth = process.stdout.columns || 80;
  // Account for: border "│ " (2) + padding (2) + rail "▌ " (2) = 6 chars
  const codeWidth = termWidth - 8;
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
          const wrapped = wordWrap(seg.text, wrapWidth);
          if (wrapped.length === 0 || (wrapped.length === 1 && !wrapped[0])) return null;
          return (
            <Box key={`seg-${i}`} flexDirection="column">
              {wrapped.map((line, j) => (
                <Text key={`prose-${i}-${j}`}><Text color={borderColor}>{'│ '}</Text>{line}</Text>
              ))}
            </Box>
          );
        }
        // code segment
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
  const termWidth = process.stdout.columns || 80;
  const wrapWidth = termWidth - 8;
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

function OutputBlockView({ event }: { event: OutputEvent }) {
  switch (event.type) {
    case 'text': {
      const termWidth = process.stdout.columns || 80;
      const wrapped = wordWrap(event.content, termWidth - 4);
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {wrapped.map((line, i) => <Text key={`text-${i}`}>{line}</Text>)}
        </Box>
      );
    }
    case 'engine-block': return <EngineBlock engineId={event.engineId} color={event.color} content={event.content} />;
    case 'separator': return <Text dimColor>{'  ─'.padEnd(50, '─')}</Text>;
    case 'header': return <Box flexDirection="column"><Text>{' '}</Text><Text bold color="cyan">{'  ▸ '}{event.title}</Text></Box>;
    case 'success': return <Text>{'  '}<Text color="green">{'✓'}</Text>{' '}{event.message}</Text>;
    case 'error': return <Text>{'  '}<Text color="red">{'✗'}</Text>{' '}{event.message}</Text>;
    case 'warning': return <Text>{'  '}<Text color="yellow">{'⚠'}</Text>{' '}{event.message}</Text>;
    case 'info': return <Text dimColor>{'  '}{event.message}</Text>;
    case 'table': return <TableView headers={event.headers} rows={event.rows} />;
    case 'streaming-chunk': return <Text>{'  '}{event.chunk}</Text>;
    case 'kern-draft': {
      const eColor = engineColor(event.engineId);
      const termWidth = process.stdout.columns || 80;
      const wrapWidth = termWidth - 8;
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
      const termWidth = process.stdout.columns || 80;
      const wrapWidth = termWidth - 8;
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
      const termWidth = process.stdout.columns || 80;
      const wrapped = wordWrap(event.summary.trim(), termWidth - 4);
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {wrapped.map((line, i) => <Text key={`v-${i}`}>{line}</Text>)}
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
        filtered.slice(0, 12).map((cmd, i) => (
          <Box key={cmd.cmd}>
            <Text color={i === selectedIndex ? 'yellow' : undefined} bold={i === selectedIndex}>
              {i === selectedIndex ? ' ❯ ' : '   '}{cmd.cmd.padEnd(16)}
            </Text>
            <Text dimColor>{cmd.desc}</Text>
          </Box>
        ))
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
  const termWidth = process.stdout.columns || 80;
  const codeWidth = termWidth - 10;
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
  const [activeAbort, setActiveAbort] = useState<AbortController | null>(null);
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
            setOutputBlocks((blocks) => [...blocks, {
              id: Date.now(),
              event: { type: 'engine-block', engineId: prev.engineId, color, content: prev.content },
            }]);
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
        setOutputBlocks((prev) => [...prev, { id: Date.now() + Math.random(), event }]);
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
    // Open slash picker immediately when user types "/" at start
    if (value === '/' && !slashPickerOpen) {
      setSlashPickerOpen(true);
      setInputValue('');
      return;
    }
    // Accept everything as-is — pastes included, like Claude Code
    setInputValue(value);
  }, [slashPickerOpen]);

  // ── Handle input submission ──
  const handleSubmit = useCallback(async (value: string) => {
    const input = value.trim();
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
      // Run in background — don't await, return to idle immediately
      fn().then(() => {
        jobManager.complete(job.id);
        setJobList([...jobManager.list()]);
        setReplState('idle');
      }).catch((err) => {
        jobManager.fail(job.id, err instanceof Error ? err.message : String(err));
        setJobList([...jobManager.list()]);
        dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        setReplState('idle');
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
        case 'chat': setPendingImages([]); await handleChat(intent.input, dispatch, ctx, allImages); break;
        case 'leaderboard': handleLeaderboard(dispatch); break;
        case 'history': handleHistory(dispatch, intent.id); break;
        case 'engines': await handleEngines(dispatch, ctx); break;
        case 'discover': await handleDiscover(dispatch, ctx); break;
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
        case 'unknown': setPendingImages([]); await handleChat(intent.input, dispatch, ctx, allImages); break;
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

  // ── History navigation + global keys ──
  useInput((input, key) => {
    // Tab key accepts ghost text completion
    if (key.tab && !slashPickerOpen && !enginePickerOpen && !questionState && !reviewEvent) {
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
    <Box flexDirection="column" height="100%">
      {/* Breadcrumb bar */}
      <Box paddingX={1}>
        <Text dimColor>{'📂 '}{process.cwd().split('/').pop()}</Text>
        <Text dimColor>{' │ '}</Text>
        <Text color={mode === 'chat' ? '#fbbf24' : mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'}>
          {mode}
        </Text>
        <Text dimColor>{' │ '}</Text>
        <Text dimColor>{registry.availableIds().length}{' engines'}</Text>
        {replState !== 'idle' && (
          <>
            <Text dimColor>{' │ '}</Text>
            <Text color="yellow">{replState}</Text>
          </>
        )}
      </Box>

      {/* Background job rail */}
      <BackgroundJobRail jobs={jobList.filter((j: Job) => j.state === 'running')} />

      {/* Output area — scrollable */}
      <Box flexDirection="column" flexGrow={1}>
        {outputBlocks.map((block) => (
          <OutputBlockView key={block.id} event={block.event} />
        ))}
        {liveSpinner && <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />}
        {streamingText && (() => {
          const c = engineColor(streamingText.engineId);
          const cleaned = cleanEngineOutput(streamingText.content);
          const termWidth = process.stdout.columns || 80;
          const wrapped = wordWrap(cleaned, termWidth - 8);
          return (
            <Box flexDirection="column" marginY={1} paddingLeft={2}>
              <Text color={c} bold>{'┌── '}{streamingText.engineId}</Text>
              <Text color={c}>{'│'}</Text>
              {wrapped.map((line, i) => (
                <Text key={`stream-${i}`}><Text color={c}>{'│ '}</Text>{line}</Text>
              ))}
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
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
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
              <Text color="#fbbf24">{'❯ '}</Text>
              <TextInput
                key={inputKey}
                value={inputValue}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder={replState === 'idle'
                  ? mode === 'chat' ? 'What should we build?'
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

  render(<App />, { exitOnCtrlC: false });
}
