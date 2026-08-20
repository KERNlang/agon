import React from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';

import { ComposerView } from '../../packages/cli/src/blocks/composer.js';
import { createComposerInputStore } from '../../packages/cli/src/signals/composer-input-store.js';
import { createPseudoTty, stripTerminalControl } from '../../packages/cli/src/blocks/frame-capture.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function frameFor(mode: string, replState: string): Promise<string> {
  const tty = createPseudoTty(80, 20);
  const app = render(
    React.createElement(ComposerView as any, {
      mode,
      replState,
      planModeQueued: false,
      autoModeQueued: false,
      activePlanState: null,
      slashPickerOpen: false,
      atPickerOpen: false,
      atPickerFiles: [],
      atPickerPrefix: '',
      atPickerQuery: '',
      onAtSelect: vi.fn(),
      onAtCancel: vi.fn(),
      composerInput: createComposerInputStore(''),
      onValueCommitted: undefined,
      handleInputChange: vi.fn(),
      handlePasteInput: (raw: string) => raw,
      handleSubmit: vi.fn(),
      allSlashCommands: [],
      availableEngines: [],
      onSlashSelect: vi.fn(),
      onSlashCancel: vi.fn(),
      questionState: null,
      questionAnswer: '',
      selectedChoiceIndex: 0,
      questionOtherActive: false,
      onQuestionAnswerChange: vi.fn(),
      onQuestionAnswerSubmit: vi.fn(),
      onCtrlShortcut: vi.fn(),
      updateBannerActive: false,
      termWidth: 80,
      termHeight: 20,
    }),
    { stdout: tty.stdout as any, stderr: tty.stderr as any, stdin: tty.stdin as any, debug: true, exitOnCtrlC: false, patchConsole: false },
  );
  await sleep(30);
  app.unmount();
  await sleep(10);
  return stripTerminalControl(tty.lastFrame());
}

// The placeholder is the ONLY thing telling the user what an orchestration
// mode expects them to type. It is shown while the REPL is idle and hidden
// while a run is in flight (a stale "What should they debate?" under a running
// tribunal reads as if nothing started).
describe('ComposerView placeholder', () => {
  it('prompts for the mode question while idle', async () => {
    expect(await frameFor('campfire', 'idle')).toContain('What should we think about?');
    expect(await frameFor('brainstorm', 'idle')).toContain('What question for the engines?');
    expect(await frameFor('tribunal', 'idle')).toContain('What should they debate?');
  });

  it('shows no placeholder for plain chat', async () => {
    const frame = await frameFor('chat', 'idle');

    expect(frame).not.toContain('What should we think about?');
    expect(frame).not.toContain('What question for the engines?');
  });

  it('drops the placeholder while a run is in flight', async () => {
    expect(await frameFor('campfire', 'running')).not.toContain('What should we think about?');
    expect(await frameFor('brainstorm', 'streaming')).not.toContain('What question for the engines?');
  });
});
