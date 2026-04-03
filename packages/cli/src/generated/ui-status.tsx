import React, { useState, useEffect } from 'react';

import { Box, Text } from 'ink';

import Spinner from 'ink-spinner';

import { resolveWorkingDir, currentBranch, tracker } from '@agon/core';

import type { ChatSession } from '@agon/core';

import { loadConfig } from '@agon/core';

import { ENGINE_COLORS } from '../generated/output.js';

import { color256toHex, engineColor } from './ui-rendering.js';

import type { Job } from '../generated/job-manager.js';

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
];


export function SpinnerBlock({ message, color }: { message: string; color?: number }) {
        return (
          <Text>
            <Text color={color ? String(color) : 'yellow'}><Spinner type="dots" /></Text>
            <Text> {message}</Text>
          </Text>
        );
}



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



function AgonTip({  }: {  }) {
  const [tip, setTip] = useState<string>(AGON_TIPS[Math.floor(Math.random() * AGON_TIPS.length)]);

  return (
          <Text>
            <Text dimColor>{'  \u2514 Tip: '}</Text>
            <Text dimColor>{tip}</Text>
          </Text>
  );
}



export function StatusBar({ config, chatSession, explorationMode }: { config: ReturnType<typeof loadConfig>; chatSession: ChatSession; explorationMode?: boolean }) {
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
            </Text>
          </Box>
        );
}



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


