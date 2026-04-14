// @kern-source: app-views:6
import React, { useMemo } from 'react';

// @kern-source: app-views:7
import { Box, Text } from 'ink';

// @kern-source: app-views:8
import { OutputBlockView, ToolCallGroup, DebateGroup, BidGroup, EngineProgressView, RenderedSegments, contentWidth, engineColor } from '../../components.js';

// @kern-source: app-views:9
import type { OutputBlock } from '../../components.js';

// @kern-source: app-views:10
import type { EngineProgress } from '../../handlers/types.js';

// @kern-source: app-views:11
import type { Job } from '../signals/job-manager.js';

// @kern-source: app-views:12
import { parseMarkdownBlocks, cleanEngineOutput } from '../blocks/markdown.js';

// @kern-source: app-views:13
import { icons } from '../signals/icons.js';

// @kern-source: app-views:16

export function ChromeBar({ mode, cwdLabel, engineCount, replState, runningJobs }: { mode: string; cwdLabel: string; engineCount: number; replState: string; runningJobs: Job[] }) {
        if (mode === 'chat') return null;
        return (
          <Box paddingX={1}>
            <Text dimColor>{icons().find + ' '}{cwdLabel}</Text>
            <Text dimColor>{' \u2502 '}</Text>
            <Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'}>{mode}</Text>
            <Text dimColor>{' \u2502 '}</Text>
            <Text dimColor>{engineCount}{' engines'}</Text>
            {replState !== 'idle' && (<><Text dimColor>{' \u2502 '}</Text><Text color="yellow">{replState}</Text></>)}
            {runningJobs.length > 0 && (<><Text dimColor>{' \u203a '}</Text><Text color="#facc15">{runningJobs.map((j: Job) => `${j.type}: ${j.label.slice(0, 20)}`).join(', ')}</Text></>)}
          </Box>
        );
}


// @kern-source: app-views:39

export function HistoryView({ visibleBlocks, groupedBlocks, mode, scrollOffset, thinkingExpanded }: { visibleBlocks: OutputBlock[]; groupedBlocks: (OutputBlock | OutputBlock[])[] | null; mode: string; scrollOffset: number; thinkingExpanded: boolean }) {
        return (
          <>
            {scrollOffset > 0 && (
              <Box paddingX={1}>
                <Text dimColor>{`\u2191 ${scrollOffset} block${scrollOffset > 1 ? 's' : ''} above \u2014 Shift+\u2191 to scroll`}</Text>
              </Box>
            )}
            {groupedBlocks === null
              ? visibleBlocks.map((block: OutputBlock) => (<OutputBlockView key={block.id} event={block.event} mode={mode} toolOutputExpanded={true} thinkingExpanded={thinkingExpanded} />))
              : groupedBlocks.map((item: OutputBlock | OutputBlock[]) => {
                  if (Array.isArray(item)) {
                    const firstType = item[0].event.type;
                    if (item.length === 1) return <OutputBlockView key={item[0].id} event={item[0].event} mode={mode} toolOutputExpanded={false} thinkingExpanded={thinkingExpanded} />;
                    if (firstType === 'debate-round') return <DebateGroup key={`dg-${item[0].id}`} blocks={item} />;
                    if (firstType === 'kern-draft') return <BidGroup key={`bg-${item[0].id}`} blocks={item} />;
                    return <ToolCallGroup key={`tg-${item[0].id}`} blocks={item} />;
                  }
                  return <OutputBlockView key={item.id} event={item.event} mode={mode} toolOutputExpanded={false} thinkingExpanded={thinkingExpanded} />;
                })}
          </>
        );
}


// @kern-source: app-views:71

export function StreamingView({ streamingText, mode, liveProgress }: { streamingText: {engineId:string,content:string} | null; mode: string; liveProgress: EngineProgress[] | null }) {
        return (
          <>
            {streamingText && (() => {
              const c = engineColor(streamingText.engineId);
              const cleaned = cleanEngineOutput(streamingText.content);
              const wrapWidth = contentWidth(mode === 'chat' ? 6 : 8);
              const segments = parseMarkdownBlocks(cleaned);
              if (mode === 'chat') {
                const lines = cleaned.split('\n').filter((line: string) => line.trim());
                const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
                const previewLimit = Math.max(24, wrapWidth - streamingText.engineId.length - 6);
                const preview = lastLine.length > previewLimit ? lastLine.slice(0, previewLimit - 1) + '\u2026' : lastLine;
                return (
                  <Box marginY={1} paddingLeft={1}>
                    <Text color={c} bold>{icons().dotOn + ' '}{streamingText.engineId}</Text>
                    <Text dimColor>{preview ? ` ${preview}` : ' streaming\u2026'}</Text>
                  </Box>
                );
              }
              return (
                <Box flexDirection="column" marginY={1} paddingLeft={2}>
                  <Text color={c} bold>{'\u250c\u2500\u2500 '}{streamingText.engineId}</Text>
                  <Text color={c}>{'\u2502'}</Text>
                  <RenderedSegments segments={segments} borderColor={c} wrapWidth={wrapWidth} />
                </Box>
              );
            })()}
            {liveProgress && <EngineProgressView engines={liveProgress} mode={mode} />}
          </>
        );
}


