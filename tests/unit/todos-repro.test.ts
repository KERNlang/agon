import { describe, expect, it, vi } from 'vitest';

import { handleOutputEvent } from '../../packages/cli/src/generated/signals/output.js';
import { asLiveTodos, clearLiveTodos, setTodos as reduceSetTodos } from '../../packages/cli/src/generated/signals/todos.js';
import { estimateBottomChromeExtraRows, estimateTodoListRows } from '../../packages/cli/src/generated/surfaces/app-layout.js';
import { createEagerToolContext } from '../../packages/cli/src/generated/cesar/tools.js';
import { extractAdjacentForkOptions } from '../../packages/cli/src/generated/cesar/fork-options.js';

// Exact payload captured from ~/.agon/sessions/chat-1784293814413/events.ndjson seq 600 —
// the live session where a TodoWrite checklist was set twice yet never appeared on screen.
const ledgerTodos = [
  { id: '1', text: 'Models + migration (scan_sessions, scan_corrections)', state: 'running' },
  { id: '2', text: 'Schemas (ScanResponse.scan_id, corrections DTOs)', state: 'pending' },
  { id: '3', text: 'Endpoint changes (scan, log, corrections)', state: 'pending' },
  { id: '4', text: 'Service/repository for persistence', state: 'pending' },
  { id: '5', text: 'Tests', state: 'pending' },
];

const makeActions = () => {
  const calls: any[] = [];
  return {
    calls,
    actions: new Proxy({} as any, {
      get: (_t, prop: string) => (...args: any[]) => { calls.push([prop, args]); },
    }),
  };
};

const emptyState = () => ({
  liveSpinner: null,
  liveProgress: null,
  streamingText: {},
  liveToolStreams: {},
  agentProgress: {},
  todos: [],
}) as any;

describe('todos pipeline — live-session payload through the real reducers', () => {
  it('handleOutputEvent forwards a todos-set to actions.setTodos with all items', () => {
    const { calls, actions } = makeActions();
    handleOutputEvent({ type: 'todos-set', todos: ledgerTodos } as any, emptyState(), actions, 'chat', 0);
    const setTodosCalls = calls.filter(([name]) => name === 'setTodos');
    expect(setTodosCalls).toHaveLength(1);
    const value = setTodosCalls[0][1][0];
    const resolved = typeof value === 'function' ? value([]) : value;
    expect(resolved).toHaveLength(5);
    expect(resolved[0].text).toContain('Models + migration');
  });

  it('asLiveTodos tags a TodoWrite checklist so the next turn-start scope:live clear removes it', () => {
    const live = asLiveTodos(ledgerTodos);
    expect(live.every((t) => t.source === 'live')).toBe(true);
    expect(clearLiveTodos(reduceSetTodos(live))).toHaveLength(0);
  });
});

describe('bottom-chrome row reserve — the pinned TodoList must be budgeted', () => {
  it('reserves item rows + header + margin for a pinned checklist', () => {
    const rows = estimateTodoListRows(ledgerTodos, false, 120);
    expect(rows).toBe(7); // 5 one-line items + header + marginTop at width 120
    const base = estimateBottomChromeExtraRows('chat', null, 120, 0, 0, false, false, 0);
    const withTodos = estimateBottomChromeExtraRows('chat', null, 120, 0, 0, false, false, rows);
    expect(withTodos - base).toBe(7);
  });

  it('is wrap-aware: long todo text on a narrow terminal reserves the extra wrapped rows', () => {
    const wide = estimateTodoListRows(ledgerTodos, false, 200);
    const narrow = estimateTodoListRows(ledgerTodos, false, 40);
    expect(narrow).toBeGreaterThan(wide); // items wrap at width 40 (36 text cols)
  });

  it('mirrors the plan-chip filter: source-less todos reserve nothing while the chip shows', () => {
    expect(estimateTodoListRows(ledgerTodos, true, 120)).toBe(0);
    expect(estimateTodoListRows(asLiveTodos(ledgerTodos), true, 120)).toBe(7);
  });

  it('reserves nothing when the checklist is empty (no regression for todo-less turns)', () => {
    expect(estimateTodoListRows([], false, 120)).toBe(0);
    expect(estimateBottomChromeExtraRows('chat', null, 100, 0, 0, false, false, 0))
      .toBe(estimateBottomChromeExtraRows('chat', null, 100, 0, 0, false, false));
  });
});

describe('eager streaming ToolContext — TodoWrite must reach the UI (missing onTodos)', () => {
  it('wires onTodos to dispatch todos-set with live-tagged items', () => {
    const dispatched: any[] = [];
    const ctx = createEagerToolContext(
      { cesar: {} } as any,
      {},
      new AbortController().signal,
      (event: any) => { dispatched.push(event); },
    ) as any;
    expect(typeof ctx.onTodos).toBe('function');
    ctx.onTodos(ledgerTodos);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe('todos-set');
    expect(dispatched[0].todos).toHaveLength(5);
    expect(dispatched[0].todos.every((t: any) => t.source === 'live')).toBe(true);
  });
});

describe('fork-option labels — markdown emphasis must not leak into picker rows', () => {
  it('strips ** and backticks from labels but keeps the raw text in full', () => {
    const response = [
      'Two ways forward:',
      '1. **Add the backend repo to the workspace** — then I plan + implement',
      '2. `shell-only` patches via Bash',
      'Which way?',
    ].join('\n');
    const options = extractAdjacentForkOptions(response);
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe('Add the backend repo to the workspace — then I plan + implement');
    expect(options[0].full).toContain('**');
    expect(options[1].label).toBe('shell-only patches via Bash');
  });
});
