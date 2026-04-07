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

// @kern-source: ui-status:12
import type { EngineProgress } from '../handlers/types.js';

// @kern-source: ui-status:16
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

// @kern-source: ui-status:49

export function SpinnerBlock({ message, color }: { message: string; color?: number }) {
        return (
          <Text>
            <Text color={color ? String(color) : 'yellow'}><Spinner type="dots" /></Text>
            <Text> {message}</Text>
          </Text>
        );
}


// @kern-source: ui-status:65

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


// @kern-source: ui-status:87

function AgonTip({  }: {  }) {
  const [tip, setTip] = useState<string>(AGON_TIPS[Math.floor(Math.random() * AGON_TIPS.length)]);

  return (
          <Text>
            <Text dimColor>{'  \u2514 Tip: '}</Text>
            <Text dimColor>{tip}</Text>
          </Text>
  );
}


// @kern-source: ui-status:99

export function StatusBar({ config, chatSession, explorationMode, toolOutputExpanded, activity, isActive, streamSnippet }: { config: ReturnType<typeof loadConfig>; chatSession: ChatSession; explorationMode?: boolean; toolOutputExpanded?: boolean; activity?: EngineProgress[]|null; isActive?: boolean; streamSnippet?: { engineId: string; line: string } | null }) {
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
  
        // Build compact activity summary for engines during dispatch
        const activitySegments: React.ReactNode[] = [];
        if (isActive && activity && activity.length > 0) {
          for (const eng of activity) {
            const ec = color256toHex(ENGINE_COLORS[eng.id] ?? 245);
            const icon = eng.done ? '\u2713' : eng.failed ? '\u2717' : '\u25cf';
            const iconColor = eng.done ? '#4ade80' : eng.failed ? '#ef4444' : ec;
            activitySegments.push(
              <Text key={eng.id}>
                <Text color={iconColor}>{icon}</Text>
                <Text color={ec} bold>{eng.id}</Text>
                <Text dimColor>{':'}</Text>
                <Text dimColor>{eng.status.length > 16 ? eng.status.slice(0, 16) + '\u2026' : eng.status}</Text>
                <Text dimColor>{' '}</Text>
              </Text>
            );
          }
        } else if (isActive && streamSnippet) {
          const ec = color256toHex(ENGINE_COLORS[streamSnippet.engineId] ?? 245);
          const maxLen = 48;
          const line = streamSnippet.line.length > maxLen ? streamSnippet.line.slice(0, maxLen) + '\u2026' : streamSnippet.line;
          activitySegments.push(
            <Text key="stream">
              <Text color="#fbbf24">{'\u25cf '}</Text>
              <Text color={ec} bold>{streamSnippet.engineId}</Text>
              <Text dimColor>{': '}</Text>
              <Text dimColor>{line}</Text>
            </Text>
          );
        } else if (isActive) {
          activitySegments.push(<Text key="active" color="#fbbf24">{'\u25cf working\u2026'}</Text>);
        }
  
        return (
          <Box paddingTop={0}>
            <Text>
              <Text color={cesarColor} bold>{cesarId}</Text>
              {explorationMode ? <Text color="#22d3ee" bold>{' [explore]'}</Text> : null}
              <Text dimColor>{' in '}</Text>
              <Text color="#60a5fa">{cwd}</Text>
              {branch ? <Text dimColor>{' on '}<Text color="#34d399">{branch}</Text></Text> : null}
              {activitySegments.length > 0 ? <Text dimColor>{' \u2502 '}</Text> : null}
            </Text>
            {activitySegments.length > 0 && <Text>{activitySegments}</Text>}
            <Text>
              {activitySegments.length === 0 && tokens > 0 ? <Text dimColor>{' | '}</Text> : null}
              {activitySegments.length === 0 && tokens > 0 ? <TokenGauge tokens={tokens} maxTokens={contextBudget} /> : null}
              {activitySegments.length === 0 && tokens > 0 ? <Text dimColor>{` | ${(tokens / 1000).toFixed(1)}k tok`}</Text> : null}
              {msgs > 0 ? <Text dimColor>{` \u00b7 ${msgs} msgs`}</Text> : null}
              {cost ? <Text dimColor>{` \u00b7 ${cost}`}</Text> : null}
              {toolOutputExpanded !== undefined && <Text dimColor>{' \u00b7 ^E '}{toolOutputExpanded ? '\u25be' : '\u25b8'}</Text>}
              {isActive ? <Text dimColor>{' \u00b7 tab btw'}</Text> : null}
            </Text>
          </Box>
        );
}


// @kern-source: ui-status:183

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


// @kern-source: ui-status:216

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


// @kern-source: ui-status:239

export function BtwPanel({ engines, spinner, jobs, lastActivityAt, streamSnippet }: { engines: EngineProgress[]|null; spinner: { message: string; engineId?: string } | null; jobs: Job[]; lastActivityAt: number; streamSnippet?: { engineId: string; line: string } | null }) {
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
          const t = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(t);
  }, []);

        const hasEngines = engines && engines.length > 0;
        const hasSpinner = !!spinner;
        const hasJobs = jobs.length > 0;
        const hasStream = !!streamSnippet;
  
        if (!hasEngines && !hasSpinner && !hasJobs && !hasStream) {
          return (
            <Box flexDirection="column" paddingX={1} marginY={1} borderStyle="single" borderColor="#585858">
              <Text dimColor>{' btw — nothing running right now'}</Text>
              <Text dimColor>{' tab or /btw to dismiss'}</Text>
            </Box>
          );
        }
  
        // Compute age from raw timestamp so the 1s timer keeps it fresh
        const agoSec = Math.max(0, Math.floor((now - lastActivityAt) / 1000));
        const agoStr = agoSec <= 0 ? 'just now' : agoSec < 60 ? `${agoSec}s ago` : `${Math.floor(agoSec / 60)}m ${agoSec % 60}s ago`;
        const agoColor = agoSec < 5 ? '#4ade80' : agoSec < 15 ? '#fbbf24' : '#ef4444';
  
        return (
          <Box flexDirection="column" paddingX={1} marginY={1} borderStyle="single" borderColor="#6b7280">
            <Box>
              <Text bold color="#a78bfa">{' btw '}</Text>
              <Text dimColor>{'— what\u2019s happening right now'}</Text>
            </Box>
  
            {hasEngines && engines!.map((eng: EngineProgress) => {
              const ec = color256toHex(ENGINE_COLORS[eng.id] ?? 245);
              const icon = eng.done ? '\u2713' : eng.failed ? '\u2717' : '\u25b6';
              const iconColor = eng.done ? '#4ade80' : eng.failed ? '#ef4444' : '#fbbf24';
              const mins = Math.floor(eng.elapsed / 60);
              const secs = eng.elapsed % 60;
              const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
              return (
                <Box key={eng.id}>
                  <Text color={iconColor}>{' '}{icon}{' '}</Text>
                  <Text color={ec} bold>{eng.id.padEnd(12)}</Text>
                  <Text>{eng.status.padEnd(24)}</Text>
                  <Text dimColor>{timeStr.padStart(6)}</Text>
                  {eng.score ? <Text color="#4ade80">{`  \u2192 ${eng.score}`}</Text> : null}
                </Box>
              );
            })}
  
            {hasSpinner && !hasEngines && (
              <Box>
                <Text color="#fbbf24">{' \u25cf '}</Text>
                {spinner!.engineId && <Text color={color256toHex(ENGINE_COLORS[spinner!.engineId] ?? 245)} bold>{spinner!.engineId}{' '}</Text>}
                <Text>{spinner!.message}</Text>
              </Box>
            )}
  
            {hasStream && (
              <Box flexDirection="column" marginTop={hasEngines || hasSpinner ? 0 : 0}>
                <Text dimColor>{' output:'}</Text>
                <Box paddingLeft={2}>
                  <Text color={color256toHex(ENGINE_COLORS[streamSnippet!.engineId] ?? 245)} bold>{streamSnippet!.engineId}</Text>
                  <Text dimColor>{': '}</Text>
                  <Text wrap="truncate">{streamSnippet!.line}</Text>
                </Box>
              </Box>
            )}
  
            {hasJobs && (
              <Box marginTop={0}>
                <Text dimColor>{' jobs: '}</Text>
                {jobs.map((job: Job) => (
                  <Text key={job.id}>
                    <Text color="yellow">{job.type}</Text>
                    <Text dimColor>{' (' + job.label + ') '}</Text>
                  </Text>
                ))}
              </Box>
            )}
  
            <Box>
              <Text dimColor>{' last activity: '}</Text>
              <Text color={agoColor}>{agoStr}</Text>
              <Text dimColor>{'  \u00b7  tab or /btw to dismiss'}</Text>
            </Box>
          </Box>
        );
}


