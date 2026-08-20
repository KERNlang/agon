import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';

import { FileRail } from '../../packages/cli/src/blocks/file-rail.js';
import { createPseudoTty, stripTerminalControl } from '../../packages/cli/src/blocks/frame-capture.js';
import { resolveKeyboardInput } from '../../packages/cli/src/signals/keyboard.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function emptyRailFrame(): Promise<string> {
  const tty = createPseudoTty(40, 16);
  const app = render(React.createElement(FileRail as any, { files: [], maxRows: 8, width: 36 }), {
    stdout: tty.stdout as any, stderr: tty.stderr as any, stdin: tty.stdin as any,
    debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  await sleep(25);
  app.unmount();
  await sleep(10);
  return stripTerminalControl(tty.lastFrame());
}

// The empty rail's only job is to teach the shortcut that brings it back. The
// hint therefore has to name the key the keymap ACTUALLY implements — Ctrl+B —
// or the panel becomes unreachable for anyone who only reads the hint.
describe('empty FileRail hint', () => {
  it('names the Ctrl+B toggle the keymap implements', async () => {
    const frame = await emptyRailFrame();

    expect(frame).toContain('Ctrl+B');
    expect(frame).toContain('toggles');
    expect(frame).toContain('FILES');
  });

  it('is the same shortcut the keyboard resolver maps to toggleFileRail', () => {
    expect(resolveKeyboardInput({
      input: 'b',
      key: { ctrl: true },
      textInputActive: false,
      modelPickerOpen: false,
      cesarPickerOpen: false,
      slashPickerOpen: false,
      enginePickerOpen: false,
      reviewEventOpen: false,
      toolDetailOpen: false,
      questionState: null,
      replState: 'idle',
      inputValue: '',
      inputHistory: [],
      historyIndex: -1,
      planModeQueued: false,
      autoModeQueued: false,
      activePlanState: null,
      outputBlockCount: 0,
      commands: [],
      engineIds: [],
      fileRailFocused: false,
      fileRailExpanded: false,
      executionRailFocused: false,
    } as any)).toEqual({ type: 'toggleFileRail' });
  });
});
