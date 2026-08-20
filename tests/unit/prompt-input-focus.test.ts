import React from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';

import { PromptTextInput } from '../../packages/cli/src/blocks/prompt-input.js';
import { createPseudoTty } from '../../packages/cli/src/blocks/frame-capture.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Drive the real component over a pseudo-TTY and type one character.
async function typeInto(focus: boolean | undefined, keys: string): Promise<ReturnType<typeof vi.fn>> {
  const tty = createPseudoTty(60, 12);
  const onChange = vi.fn();
  const app = render(
    React.createElement(PromptTextInput as any, {
      value: '',
      placeholder: '',
      focus,
      showCursor: true,
      highlightPastedText: false,
      ghostText: undefined,
      width: 40,
      maxVisibleLines: 3,
      onChange,
      onSubmit: undefined,
      onCtrlShortcut: undefined,
      onPaste: undefined,
      reservedPlainKeys: undefined,
    }),
    { stdout: tty.stdout as any, stderr: tty.stderr as any, stdin: tty.stdin as any, debug: true, exitOnCtrlC: false, patchConsole: false },
  );
  await sleep(20);
  tty.stdin.write(keys);
  await sleep(30);
  app.unmount();
  await sleep(10);
  return onChange;
}

// The composer never passes `focus` on the normal path — it relies on the
// component defaulting to focused. Defaulting to UNfocused makes useInput
// inactive, and the REPL prompt swallows every keystroke with no visible
// error: the user types and nothing happens.
describe('PromptTextInput focus default', () => {
  it('accepts keystrokes when focus is not passed at all', async () => {
    const onChange = await typeInto(undefined, 'a');

    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('accepts keystrokes with focus explicitly true', async () => {
    const onChange = await typeInto(true, 'b');

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('ignores keystrokes only when focus is explicitly false', async () => {
    const onChange = await typeInto(false, 'c');

    expect(onChange).not.toHaveBeenCalled();
  });
});
