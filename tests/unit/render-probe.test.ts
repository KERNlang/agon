import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';

import { createRenderProbeTool } from '../../packages/cli/src/generated/cesar/tool-render-probe.js';
import { createPseudoTty } from '../../packages/cli/src/generated/blocks/frame-capture.js';
import { TodoList } from '../../packages/cli/src/generated/blocks/todo-list.js';

const ctx = { cwd: process.cwd(), readFileState: new Map() } as any;

describe('RenderProbe tool', () => {
  it('renders the TodoList fixture with the given todos', async () => {
    const tool = createRenderProbeTool();
    const result = await tool.execute(
      {
        surface: 'TodoList',
        cols: 60,
        rows: 20,
        props: {
          todos: [
            { id: '1', text: 'First todo item', state: 'pending' },
            { id: '2', text: 'Second todo item', state: 'pending' },
          ],
        },
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Todos 0/2');
    expect(result.content).toContain('First todo item');
    expect(result.content).toContain('Second todo item');
  });

  it('rejects an unknown surface id and lists the valid ids', async () => {
    const tool = createRenderProbeTool();
    const result = await tool.execute({ surface: 'bogus' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('StatusBar');
    expect(result.error).toContain('TodoList');
    expect(result.error).toContain('ChromeBar');
  });

  it('returns only the final frame after a rerender (final-frame semantics)', async () => {
    // Drive the pseudo-TTY directly to prove the nero-mandated contract: after a
    // rerender, lastFrame() reflects only the settled state, while read() (the
    // legacy transcript accumulator) still carries the stale intermediate render.
    const tty = createPseudoTty(60, 20);
    const app = render(
      React.createElement(TodoList as any, {
        todos: [{ id: '1', text: 'INITIAL-STATE-ROW', state: 'pending' }],
        planActive: false,
      }),
      {
        stdout: tty.stdout as any,
        stderr: tty.stderr as any,
        stdin: tty.stdin as any,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.rerender(
      React.createElement(TodoList as any, {
        todos: [{ id: '1', text: 'FINAL-STATE-ROW', state: 'pending' }],
        planActive: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.unmount();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const finalFrame = tty.lastFrame();
    expect(finalFrame).toContain('FINAL-STATE-ROW');
    expect(finalFrame).not.toContain('INITIAL-STATE-ROW');
    // The transcript accumulator still holds the stale render — proving the
    // final-frame semantics are a real distinction, not a coincidence.
    expect(tty.read()).toContain('INITIAL-STATE-ROW');
  });
});
