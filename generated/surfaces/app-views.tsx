// @kern-source: app-views:6
import React from 'react';

// @kern-source: app-views:7
import { useEffect, useMemo, useState, useRef } from 'react';

// @kern-source: app-views:8
import { Box, Text, useInput } from 'ink';

// @kern-source: app-views:9
import { EngineProgressView, BRAND } from '../../generated/blocks/engine.js';

// @kern-source: app-views:10
import { RenderedSegments, contentWidth, engineColor, RichLineView, DiffLine, SyntaxLine, AnsiLine, GradientLine } from '../../generated/blocks/rendering.js';

// @kern-source: app-views:11
import { buildPlanPhaseGauge } from './status-helpers.js';

// @kern-source: app-views:12
import type { EngineProgress } from '../../handlers/types.js';

// @kern-source: app-views:13
import type { Job } from '../signals/job-manager.js';

// @kern-source: app-views:14
import { parseMarkdownBlocks, cleanEngineOutput } from '../blocks/markdown.js';

// @kern-source: app-views:15
import { icons } from '../signals/icons.js';

// @kern-source: app-views:17
export function renderSelectedText(text: string, start: number, end: number, keyPrefix: string): any {
  const safeText = String(text ?? '');
  const startIndex = Math.max(0, Math.min(safeText.length, Number.isFinite(start) ? start : 0));
  const endIndex = Math.max(startIndex, Math.min(safeText.length, Number.isFinite(end) ? end : safeText.length));
  const before = safeText.slice(0, startIndex);
  const middle = safeText.slice(startIndex, endIndex);
  const after = safeText.slice(endIndex);
  return (
    <Text>
      {before ? <Text key={`${keyPrefix}-before`}>{before}</Text> : null}
      {middle ? <Text key={`${keyPrefix}-middle`} backgroundColor="#2563eb" color="white">{middle}</Text> : null}
      {after ? <Text key={`${keyPrefix}-after`}>{after}</Text> : null}
    </Text>
  );
}

// @kern-source: app-views:34
/**
 * Compact sticky plan chip for the top chrome. Keeps plan progress out of the noisy bottom status strip.
 */
export function buildPlanChromeSummary(activePlan: any, activePlanState?: string|null, planModeQueued?: boolean, autoModeQueued?: boolean): any {
  const gauge = buildPlanPhaseGauge(activePlan, 8);
  const displayState = (gauge.visible && gauge.phase === 'complete') ? 'done' : String(activePlanState ?? '');
  const visible = !(!(planModeQueued || gauge.visible || ['planning', 'awaiting_approval', 'running', 'paused', 'done'].includes(displayState)));
  if (!visible) {
    return { visible: false };
  }
  let label = '';
  if (planModeQueued) {
    label = 'ready';
  } else if (displayState === 'planning') {
    label = 'thinking';
  } else if (displayState === 'awaiting_approval') {
    label = 'approval';
  } else if (displayState === 'running') {
    label = 'running';
  } else if (displayState === 'paused') {
    label = 'paused';
  } else if (displayState === 'done') {
    label = 'done';
  } else {
    label = displayState || 'plan';
  }
  let action = '';
  if (displayState === 'awaiting_approval') {
    action = 'go/yes';
  } else if (displayState === 'paused') {
    action = '/plan resume';
  } else if (displayState === 'running') {
    action = 'Ctrl+G rail';
  } else if (planModeQueued) {
    action = 'type task';
  }
  const failed = Number(gauge.failed ?? 0);
  return { visible: true, label: label, color: gauge.visible ? gauge.color : '#c084fc', shortId: gauge.shortId ?? '', bar: gauge.bar ?? '', pct: Number(gauge.pct ?? 0), stepLabel: gauge.label ?? '', current: gauge.current ?? '', failed: failed, action: action };
}

// @kern-source: app-views:78

export function ChromeBar({ mode, cwdLabel, engineCount, replState, runningJobs, planModeQueued, autoModeQueued, activePlanState, activePlan }: { mode: string; cwdLabel: string; engineCount: number; replState: string; runningJobs: Job[]; planModeQueued?: boolean; autoModeQueued?: boolean; activePlanState?: string|null; activePlan?: any }) {
        const planChrome = buildPlanChromeSummary(activePlan, activePlanState, planModeQueued, autoModeQueued);
        const planRow = planChrome.visible ? (
          <Text>
            <Text color={planChrome.color} bold>{'\u25c8 '}{String(planChrome.label).toUpperCase()}</Text>
            {planChrome.shortId ? <Text color={planChrome.color} bold>{' \u00b7 PLAN '}{planChrome.shortId}</Text> : null}
            {planChrome.stepLabel ? <Text dimColor>{' \u00b7 '}{planChrome.stepLabel}</Text> : null}
            {planChrome.bar ? <Text color={planChrome.color}>{' '}{planChrome.bar}</Text> : null}
            {planChrome.bar ? <Text dimColor>{' '}{planChrome.pct}{'%'}</Text> : null}
            {planChrome.failed > 0 ? <Text color="#ef4444">{' \u00b7 '}{planChrome.failed}{' failed'}</Text> : null}
            {planChrome.current ? <Text dimColor>{' \u00b7 '}{String(planChrome.current).slice(0, 72)}</Text> : null}
            {planChrome.action ? <Text dimColor>{' \u00b7 '}{planChrome.action}</Text> : null}
          </Text>
        ) : null;
        if (mode === 'chat') {
          return (
            <Box paddingX={1} flexDirection="column">
              <Text>
                <Text color="#f97316" bold>{'AGON'}</Text>
                <Text dimColor>{' \u2502 '}{cwdLabel}</Text>
                <Text dimColor>{' \u2502 '}{engineCount}{' engines'}</Text>
                {replState !== 'idle' && (<><Text dimColor>{' \u2502 '}</Text><Text color="yellow">{replState}</Text></>)}
                {runningJobs.length > 0 && (<><Text dimColor>{' \u203a '}</Text><Text color="#facc15">{runningJobs.map((j: Job) => `${j.type}: ${j.label.slice(0, 20)}`).join(', ')}</Text></>)}
              </Text>
              {planRow}
            </Box>
          );
        }
        return (
          <Box paddingX={1} flexDirection="column">
            <Text>
              <Text dimColor>{icons().find + ' '}{cwdLabel}</Text>
              <Text dimColor>{' \u2502 '}</Text>
              <Text color={mode === 'campfire' ? '#f97316' : mode === 'brainstorm' ? '#22d3ee' : '#a78bfa'}>{mode}</Text>
              <Text dimColor>{' \u2502 '}</Text>
              <Text dimColor>{engineCount}{' engines'}</Text>
              {replState !== 'idle' && (<><Text dimColor>{' \u2502 '}</Text><Text color="yellow">{replState}</Text></>)}
              {runningJobs.length > 0 && (<><Text dimColor>{' \u203a '}</Text><Text color="#facc15">{runningJobs.map((j: Job) => `${j.type}: ${j.label.slice(0, 20)}`).join(', ')}</Text></>)}
            </Text>
            {planRow}
          </Box>
        );
}


// @kern-source: app-views:134

export function TranscriptRowView({ row }: { row: any }) {
        const borderPrefix = row.borderColor ? <Text color={row.borderColor}>{'\u2502 '}</Text> : null;
        const selectionRail = <Text color={row.selected ? '#60a5fa' : '#2b2b2b'}>{row.selected ? '\u258c' : ' '}</Text>;
        const prefix = row.prefixText
          ? row.prefixDimColor
            ? <Text dimColor>{row.prefixText}</Text>
            : <Text color={row.prefixColor}>{row.prefixText}</Text>
          : null;
        const wrap = (child: any) => (
          <Box paddingLeft={row.paddingLeft ?? 0}>
            {selectionRail}
            {borderPrefix}
            {child}
          </Box>
        );
        const selectedText = row.selected ? renderSelectedText(
          row.selectionText ?? '',
          row.selectionStart ?? 0,
          row.selectionEnd ?? String(row.selectionText ?? '').length,
          row.key,
        ) : null;
  
        if (row.kind === 'spacer') {
          return (
            <Box paddingLeft={row.paddingLeft ?? 0}>
              {selectionRail}
              <Text>{' '}</Text>
            </Box>
          );
        }
  
        if (row.kind === 'gradient') {
          if (selectedText) {
            return (
              <Box paddingLeft={row.paddingLeft ?? 0}>
                {selectionRail}
                {selectedText}
              </Box>
            );
          }
          return (
            <Box paddingLeft={row.paddingLeft ?? 0}>
              {selectionRail}
              <GradientLine text={row.text} colors={row.colors ?? BRAND} />
            </Box>
          );
        }
  
        if (row.kind === 'rich') {
          if (selectedText) {
            return (
              <Box paddingLeft={row.paddingLeft ?? 0}>
                {selectionRail}
                {borderPrefix}
                {selectedText}
              </Box>
            );
          }
          return (
            <Box paddingLeft={row.paddingLeft ?? 0}>
              {selectionRail}
              <RichLineView line={row.richLine} borderColor={row.borderColor || undefined} />
            </Box>
          );
        }
  
        if (row.kind === 'segments') {
          if (selectedText) {
            return wrap(selectedText);
          }
          return wrap(
            <Text>
              {(row.segments ?? []).map((segment: any, index: number) => {
                if (!segment || !segment.text) return null;
                return (
                  <Text
                    key={`${row.key}-segment-${index}`}
                    color={segment.color}
                    bold={segment.bold}
                    dimColor={segment.dimColor}
                    italic={segment.italic}
                    backgroundColor={segment.backgroundColor}
                  >
                    {segment.text}
                  </Text>
                );
              })}
            </Text>,
          );
        }
  
        if (row.kind === 'ansi') {
          if (selectedText) {
            return wrap(selectedText);
          }
          return wrap(
            <>
              {prefix}
              <AnsiLine text={row.text} maxWidth={row.maxWidth} fallbackDim={row.fallbackDim} />
            </>,
          );
        }
  
        if (row.kind === 'diff') {
          if (selectedText) {
            return wrap(selectedText);
          }
          return wrap(
            <>
              {prefix}
              <DiffLine line={row.text} maxWidth={row.maxWidth} />
            </>,
          );
        }
  
        if (row.kind === 'syntax') {
          if (selectedText) {
            return wrap(selectedText);
          }
          return wrap(
            <>
              {prefix}
              <SyntaxLine line={row.text} maxWidth={row.maxWidth} />
            </>,
          );
        }
  
        return null;
}


// @kern-source: app-views:268

export function ToolDetailBlock({ title, subtitle, accentColor, rows, maxVisibleRows, onClose }: { title: string; subtitle: string; accentColor: string; rows: any[]; maxVisibleRows: number; onClose: () => void }) {
  const [offset, setOffset] = useState<number>(0);

        const totalRows = rows.length;
        const visibleCount = Math.max(6, Math.min(Math.max(1, maxVisibleRows), Math.max(1, totalRows)));
        const maxOffset = Math.max(0, totalRows - visibleCount);
        const visibleRows = useMemo(() => rows.slice(offset, offset + visibleCount), [rows, offset, visibleCount]);
  
        useEffect(() => {
          setOffset(0);
        }, [title, subtitle, totalRows, visibleCount]);
  
        useInput((input: string, key: any) => {
          const lower = input.toLowerCase();
          if (key.escape || (key.ctrl && lower === 'o')) {
            onClose();
            return;
          }
          if (key.upArrow || lower === 'k') {
            setOffset((prev: number) => Math.max(0, prev - 1));
            return;
          }
          if (key.downArrow || lower === 'j') {
            setOffset((prev: number) => Math.min(maxOffset, prev + 1));
            return;
          }
          if (key.pageUp) {
            setOffset((prev: number) => Math.max(0, prev - visibleCount));
            return;
          }
          if (key.pageDown) {
            setOffset((prev: number) => Math.min(maxOffset, prev + visibleCount));
            return;
          }
          if (key.home) {
            setOffset(0);
            return;
          }
          if (key.end) {
            setOffset(maxOffset);
          }
        });
  
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={accentColor} paddingX={1} marginY={1} width="100%">
            <Box justifyContent="space-between">
              <Text bold color={accentColor}>{title}</Text>
              <Text dimColor>{'Esc closes'}</Text>
            </Box>
            {subtitle ? <Text dimColor>{subtitle}</Text> : null}
            <Text dimColor>{'↑↓ or j/k scroll  PgUp/PgDn page  Home/End jump'}</Text>
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            {visibleRows.length === 0 ? (
              <Text dimColor>{'No detailed output available.'}</Text>
            ) : (
              <Box flexDirection="column">
                {visibleRows.map((row: any, index: number) => (
                  <TranscriptRowView key={`${row.key ?? 'tool-detail'}-${index}`} row={row} />
                ))}
              </Box>
            )}
            <Text dimColor>
              {totalRows === 0
                ? '0 lines'
                : `lines ${offset + 1}-${Math.min(totalRows, offset + visibleCount)} of ${totalRows}`}
            </Text>
          </Box>
        );
}


// @kern-source: app-views:346

export function StreamingView({ streamingText, mode, liveProgress, liveToolStreams }: { streamingText: {engineId:string,content:string} | null; mode: string; liveProgress: EngineProgress[] | null; liveToolStreams?: Record<string,any> }) {
        const toolStreams = Object.values(liveToolStreams ?? {});
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
                    <Text dimColor>{preview ? ` ${preview}` : ' thinking\u2026'}</Text>
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
            {toolStreams.length > 0 && (
              <Box flexDirection="column" paddingLeft={mode === 'chat' ? 1 : 2}>
                {toolStreams.map((entry: any) => {
                  const c = engineColor(entry.engineId);
                  const output = String(entry.output ?? '').split('\n').filter((line: string) => line.trim()).slice(-2).join(' ');
                  const preview = output.length > 96 ? output.slice(0, 95) + '\u2026' : output;
                  return (
                    <Text key={entry.streamId}>
                      <Text color={c} bold>{icons().dotOn + ' '}{entry.engineId}</Text>
                      <Text dimColor>{' tool '}</Text>
                      <Text color={c}>{entry.tool}</Text>
                      <Text dimColor>{preview ? ` ${preview}` : ' running\u2026'}</Text>
                    </Text>
                  );
                })}
              </Box>
            )}
            {liveProgress && <EngineProgressView engines={liveProgress} mode={mode} />}
          </>
        );
}


