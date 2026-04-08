// @kern-source: controls:3
import { useState, useMemo } from 'react';

// @kern-source: controls:4
import { Box, Text, useInput } from 'ink';

// @kern-source: controls:5
import { SLASH_COMMANDS } from '../signals/intent.js';

// @kern-source: controls:6
import { contentWidth, engineColor, color256toHex, DiffLine, CODE_RAIL, CODE_RAIL_COLOR } from './rendering.js';

// @kern-source: controls:7
import { ENGINE_COLORS } from './output-format.js';

// @kern-source: controls:8
import { icons } from '../signals/icons.js';

// @kern-source: controls:9
import { setAuthKey, getAuthKey, loadConfig, configSet } from '@agon/core';

// @kern-source: controls:13
export interface ReviewEvent {
  winnerId: string;
  patchPath: string;
  patchContent: string;
}

// @kern-source: controls:20

export function SlashPicker({ commands, onSelect, onCancel }: { commands: typeof SLASH_COMMANDS; onSelect: (cmd: string) => void; onCancel: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filter, setFilter] = useState<string>('');

        const normalizedFilter = filter.trim().toLowerCase();
        const filtered = commands
          .map((c: any) => {
            const name = c.cmd.toLowerCase().replace(/^\//, '');
            const startsWith = normalizedFilter ? name.startsWith(normalizedFilter) : true;
            const includes = normalizedFilter ? name.includes(normalizedFilter) : true;
            const rank = !normalizedFilter ? 0 : startsWith ? 0 : includes ? 1 : 2;
            return { ...c, rank };
          })
          .filter((c: any) => c.rank < 2)
          .sort((a: any, b: any) => a.rank - b.rank || a.cmd.localeCompare(b.cmd));
  
        useInput((input: string, key: any) => {
          if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return; }
          if (key.return) {
            if (filtered[selectedIndex]) onSelect(filtered[selectedIndex].cmd);
            return;
          }
          if (key.upArrow) { setSelectedIndex((i: number) => Math.max(0, i - 1)); return; }
          if (key.downArrow) { setSelectedIndex((i: number) => Math.min(filtered.length - 1, i + 1)); return; }
          if (key.backspace || key.delete) {
            if (!filter) { onCancel(); return; }
            setFilter((f: string) => f.slice(0, -1));
            setSelectedIndex(0);
            return;
          }
          if (key.tab) {
            if (filtered[selectedIndex]) {
              setFilter(filtered[selectedIndex].cmd.replace(/^\//, ''));
              setSelectedIndex(0);
            }
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
              <Text dimColor>{'  \u2191\u2193 navigate  Tab fill  Enter select  Esc cancel'}</Text>
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


// @kern-source: controls:102

export function EnginePicker({ available, initialSelected, userEngines, onConfirm, onCancel, onRemove }: { available: string[]; initialSelected: string[]; userEngines: Set<string>; onConfirm: (selected: string[]) => void; onCancel: () => void; onRemove: (engineId: string) => void }) {
  const [cursor, setCursor] = useState<number>(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [hidden, setHidden] = useState<Set<string>>(new Set((loadConfig() as any).hiddenEngines ?? []));

        // Only show: selected engines + user engines + non-hidden available engines
        const visible = useMemo(() => available.filter((id: string) =>
          selected.has(id) || userEngines.has(id) || !hidden.has(id)
        ), [available, selected, userEngines, hidden]);
  
        useInput((input: string, key: any) => {
          if (key.escape) { onCancel(); return; }
          if (key.return) {
            const result = visible.filter((id: string) => selected.has(id));
            if (result.length === 0) return;
            onConfirm(result);
            return;
          }
          if (key.upArrow) setCursor((i: number) => Math.max(0, i - 1));
          if (key.downArrow) setCursor((i: number) => Math.min(visible.length - 1, i + 1));
          if (input === ' ') {
            const id = visible[cursor];
            if (!id) return;
            setSelected((prev: Set<string>) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }
          if (input === 'a') setSelected(new Set(visible));
          if (input === 'n') setSelected(new Set());
          if (input === 'd' || input === 'x') {
            const id = visible[cursor];
            if (!id) return;
            if (userEngines.has(id)) {
              // User engine: fully remove
              onRemove(id);
            } else {
              // Builtin engine: hide from picker + deselect
              const nextHidden = new Set([...hidden, id]);
              setHidden(nextHidden);
              setSelected((prev: Set<string>) => { const next = new Set(prev); next.delete(id); return next; });
              configSet('hiddenEngines', [...nextHidden]);
              setCursor((i: number) => Math.min(i, visible.length - 2));
            }
          }
          if (input === 'u') {
            // Unhide all — bring back hidden builtins
            setHidden(new Set());
            configSet('hiddenEngines', []);
          }
        });
  
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
            <Box justifyContent="space-between">
              <Text bold color="cyan">{'Select active engines'}</Text>
              <Text dimColor>{'esc'}</Text>
            </Box>
            <Text dimColor>{'Space toggle  \u2191\u2193 navigate  a all  n none  d hide/remove  u unhide  Enter confirm'}</Text>
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            {visible.map((id: string, i: number) => (
              <Box key={id}>
                <Text color={i === cursor ? 'yellow' : undefined}>
                  {i === cursor ? ' \u276f ' : '   '}
                </Text>
                <Text color={selected.has(id) ? 'green' : 'red'}>
                  {selected.has(id) ? icons().dotOn : icons().dotOff}
                </Text>
                <Text>{' '}</Text>
                <Text bold color={engineColor(id)}>{id}</Text>
                {userEngines.has(id) && <Text dimColor>{' (user)'}</Text>}
                {!selected.has(id) && !userEngines.has(id) && <Text dimColor>{' (disabled)'}</Text>}
              </Box>
            ))}
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            <Text dimColor>{selected.size}{' of '}{visible.length}{' selected'}{hidden.size > 0 ? `  (${hidden.size} hidden \u2014 u to unhide)` : ''}</Text>
          </Box>
        );
}


// @kern-source: controls:193
export interface ModelPickerEntry {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  baseUrl: string;
  apiKeyEnv: string;
  format: 'openai'|'anthropic';
  contextWindow?: number;
  costInput?: number;
  costOutput?: number;
}

// @kern-source: controls:205

export function ModelPicker({ entries, onSelect, onCancel, loading }: { entries: ModelPickerEntry[]; onSelect: (entry: ModelPickerEntry) => void; onCancel: () => void; loading?: boolean }) {
  const [cursor, setCursor] = useState<number>(0);
  const [filter, setFilter] = useState<string>('');
  const [phase, setPhase] = useState<'search'|'apikey'>('search');
  const [selectedEntry, setSelectedEntry] = useState<ModelPickerEntry|null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');

        const filtered = useMemo(() => {
          if (!filter.trim()) return entries.slice(0, 50);
          const terms = filter.toLowerCase().split(/\s+/);
          return entries.filter((e: ModelPickerEntry) => {
            const hay = `${e.providerName} ${e.modelName} ${e.modelId}`.toLowerCase();
            return terms.every((t: string) => hay.includes(t));
          }).slice(0, 50);
        }, [entries, filter]);
  
        useInput((input: string, key: any) => {
          if (phase === 'apikey') {
            if (key.escape) { setPhase('search'); setSelectedEntry(null); setApiKeyInput(''); return; }
            if (key.return && apiKeyInput.trim()) {
              // Store key and select
              const entry = selectedEntry!;
              setAuthKey(entry.apiKeyEnv, apiKeyInput.trim(), entry.providerName);
              onSelect(entry);
              return;
            }
            if (key.return && !apiKeyInput.trim()) {
              // Skip key, select anyway
              onSelect(selectedEntry!);
              return;
            }
            if (key.backspace || key.delete) { setApiKeyInput((v: string) => v.slice(0, -1)); return; }
            if (input && !key.ctrl && !key.meta) {
              // Strip bracketed paste escape sequences (\e[200~ and \e[201~)
              const clean = input.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '').replace(/\[200~/g, '').replace(/\[201~/g, '');
              if (clean) setApiKeyInput((v: string) => v + clean);
            }
            return;
          }
  
          // Search phase
          if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return; }
          if (key.return) {
            if (filtered[cursor]) {
              const entry = filtered[cursor];
              if (getAuthKey(entry.apiKeyEnv)) {
                onSelect(entry);
              } else {
                setSelectedEntry(entry);
                setPhase('apikey');
                setApiKeyInput('');
              }
            }
            return;
          }
          if (key.upArrow) { setCursor((i: number) => Math.max(0, i - 1)); return; }
          if (key.downArrow) { setCursor((i: number) => Math.min(filtered.length - 1, i + 1)); return; }
          if (key.backspace || key.delete) {
            setFilter((f: string) => f.slice(0, -1));
            setCursor(0);
            return;
          }
          if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
            setFilter((f: string) => f + input);
            setCursor(0);
          }
        });
  
        if (loading) {
          return (
            <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
              <Text bold color="magenta">{'Select model'}</Text>
              <Text dimColor>{'Fetching models.dev registry\u2026'}</Text>
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>{'\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 '}<Text color="#555">{'provider/model-name'}</Text></Text>
                <Text dimColor>{'\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 '}<Text color="#444">{'provider/another-model'}</Text></Text>
                <Text dimColor>{'\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 '}<Text color="#444">{'provider/third-model'}</Text></Text>
              </Box>
            </Box>
          );
        }
  
        if (phase === 'apikey' && selectedEntry) {
          return (
            <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
              <Text bold color="magenta">{'Connect: '}{selectedEntry.providerName}</Text>
              <Text dimColor>{'\u2500'.repeat(48)}</Text>
              <Text>{'  Model:    '}<Text bold>{selectedEntry.modelName}</Text></Text>
              <Text>{'  API:      '}<Text dimColor>{selectedEntry.baseUrl}</Text></Text>
              <Text>{''}</Text>
              <Box>
                <Text color="yellow">{'  '}{selectedEntry.apiKeyEnv}{': '}</Text>
                <Text>{apiKeyInput ? '*'.repeat(apiKeyInput.length) : ''}</Text>
                <Text dimColor>{'\u2588'}</Text>
              </Box>
              <Text dimColor>{'  Enter key \u2022 Enter to skip \u2022 Esc back'}</Text>
            </Box>
          );
        }
  
        // Search phase — grouped model list
        const maxVisible = 16;
        const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible));
        const visible = filtered.slice(start, start + maxVisible);
        let lastProvider = '';
  
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
            <Box justifyContent="space-between">
              <Text bold color="magenta">{'Select model'}</Text>
              <Text dimColor>{'esc'}</Text>
            </Box>
            <Box>
              <Text dimColor>{'\u2588'}</Text>
              <Text color="magenta">{'search '}</Text>
              <Text>{filter}</Text>
              <Text dimColor>{filter ? '' : 'type to filter'}</Text>
            </Box>
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            {filtered.length === 0 ? (
              <Text dimColor>{'  No matching models'}</Text>
            ) : (
              visible.map((entry: ModelPickerEntry, vi: number) => {
                const i = start + vi;
                const showHeader = entry.providerName !== lastProvider;
                lastProvider = entry.providerName;
                const ctx = entry.contextWindow ? `${Math.round(entry.contextWindow / 1024)}k` : '';
                const cost = entry.costInput != null ? `$${entry.costInput}/${entry.costOutput}` : '';
                return (
                  <Box key={`${entry.providerId}-${entry.modelId}`} flexDirection="column">
                    {showHeader && <Text bold color="white">{'\n  '}{entry.providerName}</Text>}
                    <Box>
                      <Text color={i === cursor ? 'magenta' : undefined} bold={i === cursor}>
                        {i === cursor ? ' \u276f ' : '   '}
                      </Text>
                      <Text color={i === cursor ? 'magenta' : undefined} bold={i === cursor}>
                        {entry.modelName}
                      </Text>
                      {ctx ? <Text dimColor>{'  '}{ctx}</Text> : null}
                      {cost ? <Text dimColor>{'  '}{cost}</Text> : null}
                    </Box>
                  </Box>
                );
              })
            )}
            {filtered.length > maxVisible && (
              <Text dimColor>{'  ... '}{filtered.length - maxVisible}{' more \u2014 narrow search'}</Text>
            )}
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            <Text dimColor>{filtered.length}{' models  \u2191\u2193 navigate  Enter select  Esc cancel'}</Text>
          </Box>
        );
}


// @kern-source: controls:366

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


// @kern-source: controls:408

export function CesarPicker({ engines, currentCesar, onSelect, onCancel }: { engines: string[]; currentCesar: string; onSelect: (engineId: string) => void; onCancel: () => void }) {
  const [cursor, setCursor] = useState<number>(0);
  const [filter, setFilter] = useState<string>('');

        const filtered = useMemo(() => {
          if (!filter.trim()) return engines;
          const q = filter.toLowerCase();
          return engines.filter((id: string) => id.toLowerCase().includes(q));
        }, [engines, filter]);
  
        useInput((input: string, key: any) => {
          if (key.escape || (key.ctrl && input === 'c')) { onCancel(); return; }
          if (key.return) {
            if (filtered[cursor]) onSelect(filtered[cursor]);
            return;
          }
          if (key.upArrow) { setCursor((i: number) => Math.max(0, i - 1)); return; }
          if (key.downArrow) { setCursor((i: number) => Math.min(filtered.length - 1, i + 1)); return; }
          if (key.backspace || key.delete) {
            setFilter((f: string) => f.slice(0, -1));
            setCursor(0);
            return;
          }
          if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
            setFilter((f: string) => f + input);
            setCursor(0);
          }
        });
  
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="#a78bfa" paddingX={1}>
            <Box justifyContent="space-between">
              <Text bold color="#a78bfa">{'Select Cesar brain'}</Text>
              <Text dimColor>{'esc'}</Text>
            </Box>
            <Box>
              <Text color="#a78bfa">{'\u2588 search '}</Text>
              <Text>{filter}</Text>
              <Text dimColor>{filter ? '' : 'type to filter'}</Text>
            </Box>
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            {filtered.length === 0 ? (
              <Text dimColor>{'  No matching engines'}</Text>
            ) : (
              filtered.map((id: string, i: number) => (
                <Box key={id}>
                  <Text color={i === cursor ? '#a78bfa' : undefined} bold={i === cursor}>
                    {i === cursor ? ' \u276f ' : '   '}
                  </Text>
                  <Text color={i === cursor ? '#a78bfa' : undefined} bold={i === cursor}>
                    {id}
                  </Text>
                  {id === currentCesar && <Text color="green">{' ' + icons().success + ' current'}</Text>}
                </Box>
              ))
            )}
            <Text dimColor>{'\u2500'.repeat(48)}</Text>
            <Text dimColor>{filtered.length}{' engines  \u2191\u2193 navigate  Enter select  Esc cancel'}</Text>
          </Box>
        );
}


