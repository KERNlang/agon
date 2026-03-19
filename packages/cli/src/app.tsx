import React, { useState, useCallback, useEffect } from 'react';
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
  getElo,
  getActiveWorkspace,
  configSet,
  RUNS_DIR,
} from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import type { EngineAdapter } from '@agon/core';
import { detectIntent, SLASH_COMMANDS } from './intent.js';
import { loadCaesar, isCaesarReady, caesarClassify } from './caesar.js';
import { ENGINE_COLORS } from './output.js';
import type { OutputEvent, HandlerContext, EngineProgress } from './handlers/types.js';
import {
  handleForge, handleChat, handleBrainstorm, handleCampfire, handleTribunal,
  handleLeaderboard, handleHistory, handleEngines, handleDiscover,
  handleConfig, handleUse, handleTokens, handleModels, handleWorkspace, handleChats,
  handlePlanShow, handlePlansList, handleApprove, handleRetry, handleCancel,
  handleApplyPatch,
} from './handlers/index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

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
            <Text bold color={ENGINE_COLORS[engine.id] ? String(ENGINE_COLORS[engine.id]) : undefined}>
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
            <Text color={ENGINE_COLORS[id] ? String(ENGINE_COLORS[id]) : '#888'} bold={event.enabled.includes(id)} dimColor={!event.enabled.includes(id)}>
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
        <Text bold color={ENGINE_COLORS[event.defaultEngine] ? String(ENGINE_COLORS[event.defaultEngine]) : '#fbbf24'}>{event.defaultEngine}</Text>
        <Text dimColor>{'  (change with /use)'}</Text>
      </Box>

      {/* ELO */}
      {event.eloTop ? (
        <Box>
          <Text color="#fbbf24">{' ♛  '}</Text>
          <Text bold color={ENGINE_COLORS[event.eloTop.id] ? String(ENGINE_COLORS[event.eloTop.id]) : 'white'}>{event.eloTop.id}</Text>
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

/** Word wrap text to fit terminal width, accounting for prefix */
function wrapLines(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.length <= maxWidth) {
      lines.push(rawLine);
    } else {
      let remaining = rawLine;
      while (remaining.length > maxWidth) {
        // Try to break at last space within maxWidth
        let breakAt = remaining.lastIndexOf(' ', maxWidth);
        if (breakAt <= 0) breakAt = maxWidth;
        lines.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt).trimStart();
      }
      if (remaining) lines.push(remaining);
    }
  }
  return lines;
}

/** Filter out system/hook JSON lines from engine output */
function cleanEngineOutput(raw: string): string {
  return raw.split('\n').filter((line) => {
    const trimmed = line.trim();
    // Drop system JSON (Patrol hooks, session data, tool results)
    if (trimmed.startsWith('{"type":"system"')) return false;
    if (trimmed.startsWith('{"type":"hook_')) return false;
    if (trimmed.startsWith('{"type":"result"')) return false;
    if (trimmed.startsWith('{"type":"tool_')) return false;
    // Drop lines that are pure JSON objects (likely metadata)
    if (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes('"type"') && trimmed.length > 200) return false;
    return true;
  }).join('\n').trim();
}

function EngineBlock({ engineId, color, content }: { engineId: string; color: number; content: string }) {
  const termWidth = process.stdout.columns || 80;
  const wrapWidth = termWidth - 8;
  const cleaned = cleanEngineOutput(content);
  const wrapped = wrapLines(cleaned, wrapWidth);
  const colorStr = String(color);

  if (wrapped.length === 0 || (wrapped.length === 1 && !wrapped[0])) {
    return (
      <Box flexDirection="column" marginY={0} paddingLeft={2}>
        <Text color={colorStr}>{'┌── '}<Text bold>{engineId}</Text></Text>
        <Text color={colorStr}>{'│ '}<Text dimColor>{'(no response)'}</Text></Text>
        <Text color={colorStr}>{'└──'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Text color={colorStr}>{'┌── '}<Text bold color={colorStr}>{engineId}</Text></Text>
      <Text color={colorStr}>{'│'}</Text>
      {wrapped.slice(0, 50).map((line, i) => (
        <Text key={`${engineId}-${i}`}><Text color={colorStr}>{'│ '}</Text>{line}</Text>
      ))}
      {wrapped.length > 50 && (
        <Text><Text color={colorStr}>{'│ '}</Text><Text dimColor>{'…'}{wrapped.length - 50}{' more lines'}</Text></Text>
      )}
      <Text color={colorStr}>{'└──'}</Text>
    </Box>
  );
}

function OutputBlockView({ event }: { event: OutputEvent }) {
  switch (event.type) {
    case 'text': {
      const termWidth = process.stdout.columns || 80;
      const wrapped = wrapLines(event.content, termWidth - 4);
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
      const eColor = String(ENGINE_COLORS[event.engineId] ?? 245);
      const termWidth = process.stdout.columns || 80;
      const wrapped = wrapLines(event.content.trim(), termWidth - 8);
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={eColor}>{'┌── '}<Text bold>{event.engineId}</Text>{event.critique ? <Text color="green">{' '}{event.critique}</Text> : ''}</Text>
          <Text color={eColor}>{'│'}</Text>
          {wrapped.slice(0, 30).map((line, i) => (
            <Text key={`draft-${i}`}><Text color={eColor}>{'│ '}</Text>{line}</Text>
          ))}
          {wrapped.length > 30 && (
            <Text><Text color={eColor}>{'│ '}</Text><Text dimColor>{'…'}{wrapped.length - 30}{' more lines'}</Text></Text>
          )}
          <Text color={eColor}>{'└──'}</Text>
        </Box>
      );
    }
    case 'debate-round': {
      const dColor = String(ENGINE_COLORS[event.engineId] ?? 245);
      const termWidth = process.stdout.columns || 80;
      const wrapped = wrapLines(event.argument.trim(), termWidth - 8);
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={dColor}>{'┌── '}<Text bold>{event.engineId}</Text>{' '}<Text dimColor>{'('}{event.position}{')'}</Text></Text>
          {wrapped.slice(0, 25).map((line, i) => (
            <Text key={`debate-${i}`}><Text color={dColor}>{'│ '}</Text>{line}</Text>
          ))}
          {wrapped.length > 25 && (
            <Text><Text color={dColor}>{'│ '}</Text><Text dimColor>{'…truncated'}</Text></Text>
          )}
          <Text color={dColor}>{'└──'}</Text>
        </Box>
      );
    }
    case 'verdict': {
      const termWidth = process.stdout.columns || 80;
      const wrapped = wrapLines(event.summary.trim(), termWidth - 4);
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
          <Text bold color={ENGINE_COLORS[id] ? String(ENGINE_COLORS[id]) : undefined}>{id}</Text>
          {!selected.has(id) && <Text dimColor>{' (disabled)'}</Text>}
        </Box>
      ))}
      <Text dimColor>{'─'.repeat(48)}</Text>
      <Text dimColor>{selected.size}{' of '}{available.length}{' selected'}</Text>
    </Box>
  );
}

// ── Main App ─────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [replState, setReplState] = useState<ReplState>('idle');
  const [outputBlocks, setOutputBlocks] = useState<OutputBlock[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [pastedContent, setPastedContent] = useState<string | null>(null);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [liveSpinner, setLiveSpinner] = useState<{ message: string; color?: number } | null>(null);
  const [liveProgress, setLiveProgress] = useState<EngineProgress[] | null>(null);
  const [slashPickerOpen, setSlashPickerOpen] = useState(false);
  const [questionState, setQuestionState] = useState<{ prompt: string; resolve: (answer: string) => void } | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [enginePickerOpen, setEnginePickerOpen] = useState(false);
  const [streamingText, setStreamingText] = useState<{ engineId: string; content: string } | null>(null);

  // Module-level state (mutable refs via closures)
  // Load persisted engine selection from config — null means "all available"
  const [sessionEngines, setSessionEngines] = useState<string[] | null>(() => {
    const cfg = loadConfig();
    const saved = cfg.forgeEnabledEngines;
    return saved && saved.length > 0 ? saved : null;
  });
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [chatSession] = useState<ChatSession>(() => startChatSession());
  const [activeAbort, setActiveAbort] = useState<AbortController | null>(null);
  const [registry] = useState<EngineRegistry>(() => {
    const reg = new EngineRegistry();
    const enginesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../engines');
    reg.load(enginesDir);
    return reg;
  });
  const [adapter] = useState<EngineAdapter>(() => createCliAdapter(registry));

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
      case 'clear':
        setOutputBlocks([]);
        setStreamingText(null);
        break;
      case 'question':
        setQuestionState({ prompt: event.prompt, resolve: event.resolve });
        break;
      default:
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
  const buildContext = useCallback((): HandlerContext => ({
    registry,
    adapter,
    activeEngines,
    config: loadConfig(),
    chatSession,
    currentPlan,
    setCurrentPlan,
    setActiveAbort,
    askQuestion,
  }), [registry, adapter, activeEngines, chatSession, currentPlan, askQuestion]);

  // ── Paste detection + slash picker trigger ──
  const handleInputChange = useCallback((value: string) => {
    // Open slash picker immediately when user types "/" at start
    if (value === '/' && !slashPickerOpen) {
      setSlashPickerOpen(true);
      setInputValue('');
      return;
    }

    const lines = value.split('\n');
    if (lines.length > 3 || value.length > 300) {
      // Multi-line paste detected — store full content, show preview
      setPastedContent(value);
      const lineCount = lines.length;
      const charCount = value.length;
      const firstLine = lines[0].slice(0, 60) + (lines[0].length > 60 ? '…' : '');
      setInputValue(`[Pasted ${lineCount} lines, ${charCount} chars] ${firstLine}`);
    } else {
      setPastedContent(null);
      setInputValue(value);
    }
  }, [slashPickerOpen]);

  // ── Handle input submission ──
  const handleSubmit = useCallback(async (value: string) => {
    // Use full pasted content if available, otherwise the input value
    const raw = pastedContent ?? value;
    const input = raw.trim();
    if (!input) return;

    setInputValue('');
    setPastedContent(null);
    setInputHistory((prev) => [...prev, input]);
    setHistoryIndex(-1);

    if (replState !== 'idle') {
      dispatch({ type: 'warning', message: 'A command is running. Please wait...' });
      return;
    }

    setReplState('busy');
    dispatch({ type: 'separator' });

    let intent = detectIntent(input);
    if (intent.type === 'unknown' && isCaesarReady()) {
      const caesarIntent = await caesarClassify(input);
      if (caesarIntent) {
        switch (caesarIntent) {
          case 'forge': intent = { type: 'forge', task: input, fitnessCmd: null }; break;
          case 'brainstorm': intent = { type: 'brainstorm', question: input }; break;
          case 'tribunal': intent = { type: 'tribunal', question: input }; break;
          default: break;
        }
      }
    }

    const ctx = buildContext();

    try {
      switch (intent.type) {
        case 'forge': await handleForge(intent.task, intent.fitnessCmd, dispatch, ctx); break;
        case 'brainstorm': await handleBrainstorm(intent.question, dispatch, ctx); break;
        case 'tribunal': await handleTribunal(intent.question, dispatch, ctx); break;
        case 'campfire': await handleCampfire(intent.topic, dispatch, ctx); break;
        case 'chat': await handleChat(intent.input, dispatch, ctx); break;
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
        case 'chats': handleChats(dispatch, intent.sessionId); break;
        case 'plan': handlePlanShow(dispatch, ctx, intent.planId); break;
        case 'plans': handlePlansList(dispatch); break;
        case 'approve': await handleApprove(dispatch, ctx); break;
        case 'retry': await handleRetry(dispatch, ctx); break;
        case 'cancel': handleCancel(dispatch, ctx); break;
        case 'apply': await handleApplyPatch(dispatch, ctx, intent.patchPath, intent.force); break;
        case 'clear': dispatch({ type: 'clear' }); dispatch({ type: 'info', message: 'Chat history cleared.' }); break;
        case 'help': dispatch({ type: 'text', content: SLASH_COMMANDS.map((c) => `${c.cmd.padEnd(16)} ${c.desc}`).join('\n') }); break;
        case 'exit': exit(); return;
        case 'unknown': await handleChat(intent.input, dispatch, ctx); break;
      }
    } catch (err) {
      dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setReplState('idle');
    }
  }, [replState, dispatch, buildContext, slashPickerOpen, exit, pastedContent]);

  // ── Handle slash picker selection ──
  const handleSlashSelect = useCallback((cmd: string) => {
    setSlashPickerOpen(false);
    setInputValue(cmd + ' ');
  }, []);

  // ── Handle question answer ──
  const handleQuestionAnswer = useCallback((answer: string) => {
    if (questionState) {
      questionState.resolve(answer);
      setQuestionState(null);
      setQuestionAnswer('');
    }
  }, [questionState]);

  // ── History navigation ──
  useInput((input, key) => {
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
    // Ctrl+C to cancel running command or exit
    if (input === '\x03') {
      if (replState !== 'idle' && activeAbort) {
        activeAbort.abort();
        setActiveAbort(null);
        dispatch({ type: 'warning', message: 'Cancelled.' });
        setReplState('idle');
      } else {
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Output area — scrollable */}
      <Box flexDirection="column" flexGrow={1}>
        {outputBlocks.map((block) => (
          <OutputBlockView key={block.id} event={block.event} />
        ))}
        {liveSpinner && <SpinnerBlock message={liveSpinner.message} color={liveSpinner.color} />}
        {streamingText && (() => {
          const c = String(ENGINE_COLORS[streamingText.engineId] ?? 245);
          const cleaned = cleanEngineOutput(streamingText.content);
          const termWidth = process.stdout.columns || 80;
          const wrapped = wrapLines(cleaned, termWidth - 8);
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
          {questionState ? (
            <Box>
              <Text bold color="yellow">{questionState.prompt} </Text>
              <TextInput value={questionAnswer} onChange={setQuestionAnswer} onSubmit={handleQuestionAnswer} />
            </Box>
          ) : (
            <Box>
              <Text color="yellow">{'❯ '}</Text>
              <TextInput
                value={inputValue}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                placeholder={replState === 'idle' ? 'What should we build?' : ''}
              />
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

  // Initialize Caesar in background (non-blocking)
  const config = loadConfig();
  if (config.caesarModel && config.caesarModel !== 'none') {
    loadCaesar(config.caesarModel).catch(() => {});
  }

  render(<App />);
}
