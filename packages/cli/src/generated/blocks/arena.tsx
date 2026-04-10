// @kern-source: arena:6
import React from 'react';

// @kern-source: arena:7
import { Box, Text } from 'ink';

// @kern-source: arena:8
import type { EngineProgress } from '../../handlers/types.js';

// @kern-source: arena:9
import { engineColor } from './rendering.js';

// @kern-source: arena:10
import { icons } from '../signals/icons.js';

// @kern-source: arena:14
export const FORGE_BORDERS: string[][] = [
  ['\u2694\u2550\u2550\u2550\u2550\u2550 T H E  F O R G E \u2550\u2550\u2550\u2550\u2550\u2694',
   '\u2694\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2694'],
  ['\u2694\u2550\u2550\u2726\u2550\u2550 T H E  F O R G E \u2550\u2550\u2726\u2550\u2550\u2694',
   '\u2694\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2694'],
  ['\u2694\u2550\u2550\u2550\u2550\u2550 T H E  F O R G E \u2550\u2550\u2550\u2550\u2550\u2694',
   '\u2694\u2550\u2726\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2726\u2550\u2694'],
];

// @kern-source: arena:26
function forgeBar(pct: number, width: number): string {
  const filled = Math.round(pct * width);
  const half = pct > 0 && filled < width ? 1 : 0;
  return '\u2588'.repeat(filled) + (half ? '\u2592' : '') + '\u2591'.repeat(Math.max(0, width - filled - half));
}

// @kern-source: arena:33

export function ForgeArena({ engines }: { engines: EngineProgress[] }) {
        const elapsed = engines[0]?.elapsed ?? 0;
        const frame = elapsed % FORGE_BORDERS.length;
        const [top, bottom] = FORGE_BORDERS[frame];
        const maxElapsed = 120;
        // Find leader
        let leaderId = '';
        let bestPct = -1;
        for (const e of engines) {
          const pct = e.done ? 1 : Math.min(e.elapsed / maxElapsed, 0.95);
          if (pct > bestPct || e.done) { bestPct = pct; leaderId = e.id; }
        }
        return (
          <Box flexDirection="column" paddingLeft={2}>
            <Text color="#f97316" bold>{top}</Text>
            <Text color="#f97316">{'\u2551'}</Text>
            {engines.map((e: EngineProgress) => {
              const pct = e.done ? 1 : Math.min(e.elapsed / maxElapsed, 0.95);
              const bar = forgeBar(pct, 12);
              const isLead = e.id === leaderId && !e.failed;
              const statusTxt = e.done
                ? (e.score ? `\u2605 ${e.score}` : '\u2713 done')
                : e.failed ? '\u2717 fail'
                : `${Math.round(pct * 100)}%`;
              return (
                <Box key={e.id}>
                  <Text color="#f97316">{'\u2551 '}</Text>
                  <Text color={e.done ? 'green' : e.failed ? 'red' : 'yellow'}>
                    {e.done ? '\u2713' : e.failed ? '\u2717' : isLead ? '\u2694' : '\u00b7'}
                  </Text>
                  <Text>{' '}</Text>
                  <Box width={14}>
                    <Text bold color={engineColor(e.id)}>{e.id}</Text>
                  </Box>
                  <Text color={e.done ? '#22c55e' : e.failed ? '#ef4444' : '#f97316'}>{bar}</Text>
                  <Text>{' '}</Text>
                  <Text dimColor>{statusTxt}</Text>
                  <Text color="#f97316">{' \u2551'}</Text>
                </Box>
              );
            })}
            <Text color="#f97316">{'\u2551'}</Text>
            <Text color="#f97316" bold>{bottom}</Text>
          </Box>
        );
}


// @kern-source: arena:85
export const STORM_BOLTS: string[] = [
  '\u26a1    \u26a1      \u26a1',
  '   \u26a1      \u26a1   ',
  '\u26a1      \u26a1    \u26a1',
  '  \u26a1   \u26a1      ',
];

// @kern-source: arena:95
export const STORM_CLOUDS: string[] = [
  '  \u2571\u2572\u2571\u2572\u2571\u2572\u2571\u2572\u2571\u2572\u2571\u2572',
  ' \u2572\u2571\u2572\u2571\u2572\u2571\u2572\u2571\u2572\u2571\u2572\u2571\u2572',
];

// @kern-source: arena:103

export function BrainstormStorm({ engines }: { engines: EngineProgress[] }) {
        const elapsed = engines[0]?.elapsed ?? 0;
        const frame = elapsed % STORM_BOLTS.length;
        const bolt = STORM_BOLTS[frame];
        const doneCount = engines.filter((e: EngineProgress) => e.done).length;
        return (
          <Box flexDirection="column" paddingLeft={2}>
            <Text color="#22d3ee" dimColor>{bolt}</Text>
            <Text color="#64748b">{STORM_CLOUDS[0]}</Text>
            <Text color="#64748b">{STORM_CLOUDS[1]}</Text>
            <Text color="#22d3ee" bold>{'  \u26a1 B R A I N S T O R M \u26a1'}</Text>
            <Text color="#22d3ee">{'\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e'}</Text>
            {engines.map((e: EngineProgress, i: number) => {
              const spark = e.done ? '\u2713' : (elapsed + i) % 3 === 0 ? '\u26a1' : '\u00b7';
              return (
                <Box key={e.id}>
                  <Text color="#22d3ee">{'\u2502 '}</Text>
                  <Text color={e.done ? 'green' : e.failed ? 'red' : (elapsed + i) % 3 === 0 ? '#22d3ee' : 'yellow'}>
                    {spark}
                  </Text>
                  <Text>{' '}</Text>
                  <Box width={12}>
                    <Text bold color={engineColor(e.id)}>{e.id}</Text>
                  </Box>
                  <Text dimColor>{e.status}</Text>
                  <Text color="#22d3ee">{' \u2502'}</Text>
                </Box>
              );
            })}
            <Text color="#22d3ee">{'\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f'}</Text>
            {doneCount > 0 && (
              <Text color="#22d3ee" italic>{'    '}{String(doneCount)}{' of '}{String(engines.length)}{' ideas sparked'}</Text>
            )}
          </Box>
        );
}


// @kern-source: arena:145
export const FIRE_FRAMES: string[][] = [
  ['       (  ) (  )  ',
   '      (    )(   ) ',
   '       )  (  ) (  ',
   '      \u2571\u2591\u2592\u2593\u2588\u2588\u2593\u2592\u2591\u2572 '],
  ['      ( )(  )( )  ',
   '       (   )(  )  ',
   '      ( )( )(  )  ',
   '      \u2571\u2591\u2592\u2593\u2588\u2588\u2593\u2592\u2591\u2572 '],
  ['        (  )(  )  ',
   '      (  )(   )(  ',
   '       ( . )( )   ',
   '      \u2571\u2591\u2592\u2593\u2588\u2588\u2593\u2592\u2591\u2572 '],
];

// @kern-source: arena:163

export function CampfireFire({ engines }: { engines: EngineProgress[] }) {
        const elapsed = engines[0]?.elapsed ?? 0;
        const frame = elapsed % FIRE_FRAMES.length;
        const flames = FIRE_FRAMES[frame];
        return (
          <Box flexDirection="column" paddingLeft={2}>
            {flames.map((line: string, i: number) => (
              <Text key={i} color={i < 3 ? '#f97316' : '#7c2d12'}>{line}</Text>
            ))}
            <Text color="#78350f">{'      \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550'}</Text>
            <Text color="#f97316" bold>{'   \u2500\u2500 C A M P F I R E \u2500\u2500'}</Text>
            <Text>{' '}</Text>
            <Box>
              <Text>{'    '}</Text>
              {engines.map((e: EngineProgress, i: number) => (
                <Box key={e.id}>
                  <Text color={engineColor(e.id)} bold>{e.id}</Text>
                  {i < engines.length - 1 && <Text dimColor>{' \u00b7 '}</Text>}
                </Box>
              ))}
            </Box>
            <Box>
              <Text>{'    '}</Text>
              {engines.map((e: EngineProgress, i: number) => {
                const bubble = e.done ? '\u2713' : (elapsed + i) % 4 < 2 ? '\u2620' : '\u00b7';
                const padLen = Math.max(0, e.id.length - 1);
                const pad = ' '.repeat(Math.floor(padLen / 2));
                return (
                  <Box key={e.id}>
                    <Text color={e.done ? 'green' : '#f97316'}>{pad}{bubble}{pad}{' '}</Text>
                    {i < engines.length - 1 && <Text>{'   '}</Text>}
                  </Box>
                );
              })}
            </Box>
            <Box>
              <Text>{'    '}</Text>
              {engines.map((e: EngineProgress, i: number) => {
                const padLen = Math.max(0, e.id.length - String(e.elapsed).length - 1);
                const pad = ' '.repeat(Math.floor(padLen / 2));
                return (
                  <Box key={e.id}>
                    <Text dimColor>{pad}{String(e.elapsed)}{'s'}{pad}</Text>
                    {i < engines.length - 1 && <Text>{'   '}</Text>}
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
}


// @kern-source: arena:222
export const SCALES_FRAMES: string[] = [
  '     \u2696  T R I B U N A L  \u2696',
  '    \u2696   T R I B U N A L   \u2696',
  '   \u2696    T R I B U N A L    \u2696',
];

