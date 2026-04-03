import * as React from 'react'; import { useState } from 'react';

import { Box, Text, useInput } from 'ink';

import { SLASH_COMMANDS } from '../generated/intent.js';

import { contentWidth, engineColor, color256toHex, DiffLine, CODE_RAIL, CODE_RAIL_COLOR } from './ui-rendering.js';

import { ENGINE_COLORS } from '../generated/output.js';

export interface ReviewEvent {
  winnerId: string;
  patchPath: string;
  patchContent: string;
}


export function SlashPicker({ commands, onSelect, onCancel }: { commands: typeof SLASH_COMMANDS; onSelect: (cmd: string) => void; onCancel: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filter, setFilter] = useState<string>('');

        const filtered = commands.filter((c: any) => c.cmd.toLowerCase().includes(filter.toLowerCase()));
  
        useInput((input: string, key: any) => {
          if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return; }
          if (key.return) {
            if (filtered[selectedIndex]) onSelect(filtered[selectedIndex].cmd);
            return;
          }
          if (key.upArrow) { setSelectedIndex((i: number) => Math.max(0, i - 1)); return; }
          if (key.downArrow) { setSelectedIndex((i: number) => Math.min(filtered.length - 1, i + 1)); return; }
          if (key.backspace || key.delete) {
            setFilter((f: string) => f.slice(0, -1));
            setSelectedIndex(0);
            return;
          }
          if (key.tab) {
            if (filtered[selectedIndex]) onSelect(filtered[selectedIndex].cmd);
            return;
          }
          if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
            setFilter((f: string) => f + input);
            setSelectedIndex(0);
          }
        });
  
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
            <Box>
              <Text color="yellow">{'/ '}</Text>
              <Text>{filter}</Text>
              <Text dimColor>{'\u2588'}</Text>
              <Text dimColor>{'  \u2191\u2193 navigate  Enter select  Esc cancel'}</Text>
            </Box>
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            {filtered.length === 0 ? (
              <Text dimColor>{'  No matching commands'}</Text>
            ) : (
              (() => {
                const maxVisible = 12;
                const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), filtered.length - maxVisible));
                const visible = filtered.slice(start, start + maxVisible);
                return visible.map((cmd: any, vi: number) => {
                  const i = start + vi;
                  return (
                    <Box key={cmd.cmd}>
                      <Text color={i === selectedIndex ? 'yellow' : undefined} bold={i === selectedIndex}>
                        {i === selectedIndex ? ' \u276f ' : '   '}{cmd.cmd.padEnd(16)}
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



export function EnginePicker({ available, initialSelected, onConfirm, onCancel }: { available: string[]; initialSelected: string[]; onConfirm: (selected: string[]) => void; onCancel: () => void }) {
  const [cursor, setCursor] = useState<number>(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

        useInput((input: string, key: any) => {
          if (key.escape) { onCancel(); return; }
          if (key.return) {
            const result = available.filter((id: string) => selected.has(id));
            if (result.length === 0) return;
            onConfirm(result);
            return;
          }
          if (key.upArrow) setCursor((i: number) => Math.max(0, i - 1));
          if (key.downArrow) setCursor((i: number) => Math.min(available.length - 1, i + 1));
          if (input === ' ') {
            const id = available[cursor];
            setSelected((prev: Set<string>) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }
          if (input === 'a') setSelected(new Set(available));
          if (input === 'n') setSelected(new Set());
        });
  
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
            <Text bold color="cyan">{'Select active engines'}</Text>
            <Text dimColor>{'Space toggle  \u2191\u2193 navigate  a all  n none  Enter confirm  Esc cancel'}</Text>
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            {available.map((id: string, i: number) => (
              <Box key={id}>
                <Text color={i === cursor ? 'yellow' : undefined}>
                  {i === cursor ? ' \u276f ' : '   '}
                </Text>
                <Text color={selected.has(id) ? 'green' : 'red'}>
                  {selected.has(id) ? '\u25c9' : '\u25cb'}
                </Text>
                <Text>{' '}</Text>
                <Text bold color={engineColor(id)}>{id}</Text>
                {!selected.has(id) && <Text dimColor>{' (disabled)'}</Text>}
              </Box>
            ))}
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            <Text dimColor>{selected.size}{' of '}{available.length}{' selected'}</Text>
          </Box>
        );
}



export function ReviewBlock({ event, onAction }: { event: ReviewEvent; onAction: (action: 'apply' | 'edit' | 'reject' | 'copy') => void }) {
        const eColor = engineColor(event.winnerId);
        const codeWidth = contentWidth(10);
        const lines = event.patchContent.split('\n').slice(0, 30);
        const overflow = event.patchContent.split('\n').length - 30;
  
        useInput((input: string) => {
          const k = input.toLowerCase();
          if (k === 'a') onAction('apply');
          else if (k === 'e') onAction('edit');
          else if (k === 'r') onAction('reject');
          else if (k === 'c') onAction('copy');
        });
  
        return (
          <Box flexDirection="column" paddingLeft={2} marginY={1}>
            <Text color={eColor}>{'\u250c\u2500\u2500 Winner: '}<Text bold>{event.winnerId}</Text></Text>
            {lines.map((line: string, i: number) => (
              <Text key={`rv-${i}`}>
                <Text color={eColor}>{'\u2502 '}</Text>
                <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
                <Text> </Text>
                <DiffLine line={line} maxWidth={codeWidth} />
              </Text>
            ))}
            {overflow > 0 && (
              <Text>
                <Text color={eColor}>{'\u2502 '}</Text>
                <Text color={CODE_RAIL_COLOR}>{CODE_RAIL}</Text>
                <Text> </Text>
                <Text dimColor>{'\u2026 '}{overflow}{' more lines'}</Text>
              </Text>
            )}
            <Text color={eColor}>{'\u2514\u2500\u2500 '}<Text bold color="green">{'[A]'}</Text>{'pply  '}<Text bold color="cyan">{'[E]'}</Text>{'dit  '}<Text bold color="red">{'[R]'}</Text>{'eject  '}<Text bold color="yellow">{'[C]'}</Text>{'opy'}</Text>
          </Box>
        );
}


