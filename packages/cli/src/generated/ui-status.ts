import { Box, Text } from 'ink';

import { resolveWorkingDir, currentBranch, tracker } from '@agon/core';

import type { ChatSession, AgonConfig } from '@agon/core';

import { engineColor, color256toHex, ENGINE_COLORS, TokenGauge } from '../components.js';

import React, {  } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export function StatusBar({ config, chatSession }: { config: AgonConfig; chatSession: ChatSession }) {
  return (
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
                <Text dimColor>{' in '}</Text>
                <Text color="#60a5fa">{cwd}</Text>
                {branch ? <Text dimColor>{' on '}<Text color="#34d399">{branch}</Text></Text> : null}
                {tokens > 0 ? <Text dimColor>{' | '}</Text> : null}
                {tokens > 0 ? <TokenGauge tokens={tokens} maxTokens={contextBudget} /> : null}
                {tokens > 0 ? <Text dimColor>{` | ${(tokens / 1000).toFixed(1)}k tok`}</Text> : null}
                {msgs > 0 ? <Text dimColor>{` · ${msgs} msgs`}</Text> : null}
                {cost ? <Text dimColor>{` · ${cost}`}</Text> : null}
              </Text>
            </Box>
          );
  );
}


import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export function StatusLine({ startTime, engineId, color }: { startTime: number; engineId?: string; color?: number }) {
  const [elapsed, setElapsed] = useState<number>(0);

  useEffect(() => {
          const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startTime) / 1000));
          }, 1000);
          return () => clearInterval(interval);
  }, []);

  return (
          const c = color ? color256toHex(color) : '#a78bfa';
          const secs = elapsed;
          const eId = engineId ?? 'cesar';
          return (
            <Box paddingLeft={1}>
              <Text>
                <Text color={c}><Spinner type="dots" /></Text>
                <Text color={c} bold>{` ${eId}`}</Text>
                <Text dimColor>{` thinking\u2026 (${secs}s)`}</Text>
              </Text>
            </Box>
          );
  );
}


import React, {  } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export function BackgroundJobRail({ jobs }: { jobs: any[] }) {
  return (
          if (jobs.length === 0) return null;
          return (
            <Box paddingX={1}>
              {jobs.map((job: any) => (
                <Text key={job.id} dimColor>
                  {'⟳ '}{job.type}{': '}{job.label.slice(0, 30)}{'  '}
                </Text>
              ))}
            </Box>
          );
  );
}


