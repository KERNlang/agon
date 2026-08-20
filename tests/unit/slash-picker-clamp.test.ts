import React from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';

import { SlashPicker } from '../../packages/cli/src/blocks/controls.js';
import { createPseudoTty } from '../../packages/cli/src/blocks/frame-capture.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DOWN = '\x1b[B';
const ENTER = '\r';

const cmd = (name: string) => ({ cmd: `/${name}`, desc: `${name} command` });
const FIVE = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(cmd);

function mount(commands: ReturnType<typeof cmd>[]) {
  const tty = createPseudoTty(80, 24);
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const app = render(React.createElement(SlashPicker as any, { commands, onSelect, onCancel }), {
    stdout: tty.stdout as any, stderr: tty.stderr as any, stdin: tty.stdin as any,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  const press = async (keys: string) => { tty.stdin.write(keys); await sleep(25); };
  return { app, tty, onSelect, onCancel, press };
}

// The cursor is state; the list is a prop. When the list SHRINKS under a cursor
// that has already been moved down, the clamp is the only thing keeping the
// selection on a real row — without it Enter resolves to `undefined` and the
// picker silently does nothing at all.
describe('SlashPicker selection clamp', () => {
  it('selects the row under the cursor', async () => {
    const { app, onSelect, press } = mount(FIVE);
    await sleep(25);

    await press(DOWN);
    await press(DOWN);
    await press(ENTER);
    app.unmount();

    expect(onSelect).toHaveBeenCalledWith('/charlie');
  });

  it('clamps onto the last row when the command list shrinks under the cursor', async () => {
    const { app, onSelect, press } = mount(FIVE);
    await sleep(25);

    await press(DOWN);
    await press(DOWN);
    await press(DOWN);
    app.rerender(React.createElement(SlashPicker as any, {
      commands: FIVE.slice(0, 2),
      onSelect: (onSelect as any),
      onCancel: vi.fn(),
    }));
    await sleep(25);
    await press(ENTER);
    app.unmount();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('/bravo');
  });

  it('selects nothing and never crashes when every command is filtered away', async () => {
    const { app, onSelect, onCancel, press } = mount([]);
    await sleep(25);

    await press(ENTER);
    app.unmount();

    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
