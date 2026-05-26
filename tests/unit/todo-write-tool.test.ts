// RED test for Cesar gap #3 (todo shim): an agent-facing TodoWrite tool.
// The todo UI/state/reducers + todos-set/update/clear events already exist;
// this tool lets the model drive that rolling list itself. The pure
// normalizer maps the model's input (incl. Claude-style content/status) onto
// agon's native Todo shape ({id, text, state}); execute surfaces it via the
// optional ctx.onTodos hook and returns a readable checklist.
import { describe, it, expect } from 'vitest';
import {
  normalizeTodos,
  createTodoWriteTool,
} from '../../packages/core/src/generated/tools/tool-todo-write.js';

describe('normalizeTodos', () => {
  it('maps Claude-style content/status onto agon {id,text,state}', () => {
    const out = normalizeTodos([
      { content: 'do X', status: 'in_progress' },
      { content: 'do Y', status: 'completed' },
      { content: 'do Z', status: 'pending' },
    ]);
    expect(out).toEqual([
      { id: 't1', text: 'do X', state: 'running' },
      { id: 't2', text: 'do Y', state: 'done' },
      { id: 't3', text: 'do Z', state: 'pending' },
    ]);
  });

  it('accepts agon-native shape and preserves explicit ids', () => {
    const out = normalizeTodos([{ id: 'a', text: 'task', state: 'failed' }]);
    expect(out).toEqual([{ id: 'a', text: 'task', state: 'failed' }]);
  });

  it('defaults unknown/missing state to pending', () => {
    expect(normalizeTodos([{ text: 'x' }])[0].state).toBe('pending');
    expect(normalizeTodos([{ text: 'x', status: 'weird' }])[0].state).toBe('pending');
  });

  it('returns [] for non-array input', () => {
    expect(normalizeTodos(null)).toEqual([]);
    expect(normalizeTodos('nope' as unknown)).toEqual([]);
    expect(normalizeTodos(undefined)).toEqual([]);
  });
});

describe('createTodoWriteTool', () => {
  it('exposes a read-only TodoWrite definition', () => {
    const tool = createTodoWriteTool();
    expect(tool.definition.name).toBe('TodoWrite');
    expect(tool.definition.isReadOnly).toBe(true);
  });

  it('execute surfaces todos via ctx.onTodos and echoes a checklist', async () => {
    const tool = createTodoWriteTool();
    let captured: Array<{ text: string; state: string }> | null = null;
    const ctx = {
      cwd: process.cwd(),
      readFileState: new Map(),
      onTodos: (todos: Array<{ text: string; state: string }>) => { captured = todos; },
    } as never;

    const res = await tool.execute({ todos: [{ content: 'ship it', status: 'in_progress' }] }, ctx);
    expect(res.ok).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured![0]).toEqual({ id: 't1', text: 'ship it', state: 'running' });
    expect(res.content).toContain('ship it');
  });

  it('execute still works when no onTodos hook is provided (API-loop path)', async () => {
    const tool = createTodoWriteTool();
    const ctx = { cwd: process.cwd(), readFileState: new Map() } as never;
    const res = await tool.execute({ todos: [{ text: 'lonely' }] }, ctx);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('lonely');
  });
});
