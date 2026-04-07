// @kern-source: ui-status:3
import React, { useState, useEffect } from 'react';

// @kern-source: ui-status:4
import { Box, Text } from 'ink';

// @kern-source: ui-status:5
import Spinner from 'ink-spinner';

// @kern-source: ui-status:6
import { resolveWorkingDir, currentBranch, tracker } from '@agon/core';

// @kern-source: ui-status:7
import type { ChatSession } from '@agon/core';

// @kern-source: ui-status:8
import { loadConfig } from '@agon/core';

// @kern-source: ui-status:9
import { ENGINE_COLORS } from '../generated/output.js';

// @kern-source: ui-status:10
import { color256toHex, engineColor } from './ui-rendering.js';

// @kern-source: ui-status:11
import type { Job } from '../generated/job-manager.js';

// @kern-source: ui-status:15
export const AGON_TIPS: string[] = [
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
  "Run /apply <patch> to apply a forge winner's diff",
  // ── Arena flavor — Greek agon + Roman imperium ──
  'The arena does not reward the swift, but the precise.',
  'In the agon, every contestant bleeds — only the best ship code.',
  'Veni, vidi, forged — the emperor demands results.',
  'The Colosseum had gladiators. You have engines. Same rules apply.',
  'Ave Cesar — those about to compile salute you.',
  'The strongest steel is forged in the hottest fire.',
  'In the arena, there are no allies — only the next challenger.',
  'The crowd waits. The engines compete. You ship.',
  'Even Rome was built with tests.',
  'The tribunal has spoken — but the emperor decides.',
];

// @kern-source: ui-status:48

export function SpinnerBlock({ message, color }: { message: string; color?: number }) {
        return (
          <Text>
            <Text color={color ? String(color) : 'yellow'}><Spinner type="dots" /></Text>
            <Text> {message}</Text>
          </Text>
        );
}


// @kern-source: ui-status:64

export function TokenGauge({ tokens, maxTokens }: { tokens: number; maxTokens: number }) {
        const pct = Math.min(100, Math.round((tokens / maxTokens) * 100));
        const barWidth = 12;
        const filled = Math.round((pct / 100) * barWidth);
        const empty = barWidth - filled;
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
        const barColor = pct > 80 ? '#ef4444' : pct > 60 ? '#fbbf24' : '#4ade80';
  
        return (
          <Text>
            <Text color={barColor}>{bar}</Text>
            <Text dimColor>{` ${pct}%`}</Text>
          </Text>
        );
}


// @kern-source: ui-status:86

function AgonTip({  }: {  }) {
  const [tip, setTip] = useState<string>(AGON_TIPS[Math.floor(Math.random() * AGON_TIPS.length)]);

  return (
          <Text>
            <Text dimColor>{'  \u2514 Tip: '}</Text>
            <Text dimColor>{tip}</Text>
          </Text>
  );
}


// @kern-source: ui-status:98

export function StatusBar({ config, chatSession, explorationMode, toolOutputExpanded }: { config: ReturnType<typeof loadConfig>; chatSession: ChatSession; explorationMode?: boolean; toolOutputExpanded?: boolean }) {
        const cesarId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
        const cesarColor = color256toHex(ENGINE_COLORS[cesarId] ?? 245);
        const workDir = resolveWorkingDir();
        let branch = '';
        try { branch = currentBranch(workDir); } catch {}
        const cwd = workDir.replace(process.env.HOME ?? '', '~');
        const stats = tracker.getStats();
        const cost = stats.totalCostUsd > 0 ? `$${stats.totalCostUsd.toFixed(2)}` : '';
        const msgs = chatSession.messages.length;
        const tokens = stats.totalTokens;
        const contextWindows: Record<string, number> = {
          claude: 1000000, codex: 200000, gemini: 1000000, opencode: 200000,
        };
        const contextBudget = contextWindows[cesarId] ?? 200000;
  
        return (
          <Box paddingTop={0}>
            <Text>
              <Text color={cesarColor} bold>{cesarId}</Text>
              {explorationMode ? <Text color="#22d3ee" bold>{' [explore]'}</Text> : null}
              <Text dimColor>{' in '}</Text>
              <Text color="#60a5fa">{cwd}</Text>
              {branch ? <Text dimColor>{' on '}<Text color="#34d399">{branch}</Text></Text> : null}
              {tokens > 0 ? <Text dimColor>{' | '}</Text> : null}
              {tokens > 0 ? <TokenGauge tokens={tokens} maxTokens={contextBudget} /> : null}
              {tokens > 0 ? <Text dimColor>{` | ${(tokens / 1000).toFixed(1)}k tok`}</Text> : null}
              {msgs > 0 ? <Text dimColor>{` \u00b7 ${msgs} msgs`}</Text> : null}
              {cost ? <Text dimColor>{` \u00b7 ${cost}`}</Text> : null}
              {toolOutputExpanded !== undefined && <Text dimColor>{' \u00b7 ^E '}{toolOutputExpanded ? '\u25be' : '\u25b8'}</Text>}
            </Text>
          </Box>
        );
}


// @kern-source: ui-status:141

export function StatusLine({ startTime, engineId, color }: { startTime: number; engineId?: string; color?: number }) {
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
          const t = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(t);
  }, []);

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


// @kern-source: ui-status:174

export function BackgroundJobRail({ jobs }: { jobs: Job[] }) {
        if (jobs.length === 0) return null;
        return (
          <Box paddingX={1}>
            <Text dimColor>{'jobs: '}</Text>
            {jobs.map((job: Job, i: number) => (
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


