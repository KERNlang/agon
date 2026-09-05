import { expect, it, vi } from 'vitest';
import { runHandleCancelOrExit, runHandleKeyboardInput } from '../../packages/cli/src/surfaces/app-keyboard.js';
import type { KeyboardInputDeps } from '../../packages/cli/src/surfaces/app-keyboard.js';

it('Ctrl+C dismisses a question with refusal, never the affirmative empty default', () => {
  const resolve = vi.fn();
  const interruptActiveRun = vi.fn();
  runHandleCancelOrExit({
    questionState: { resolve }, replState: 'idle', inputValue: 'fixture',
    activeAbortRef: { current: null }, setQuestionState: vi.fn(),
    setQuestionAnswer: vi.fn(), setSelectedChoiceIndex: vi.fn(),
    setQuestionOtherActive: vi.fn(), interruptActiveRun,
    setInputValue: vi.fn(), dispatch: vi.fn(),
  });
  expect(resolve).toHaveBeenCalledWith('n');
});

it('Escape dismisses a free-text approval with refusal', () => {
  const resolve = vi.fn();
  runHandleKeyboardInput({
    questionState: { resolve, prompt: 'Approve? [Y/n]' }, replState: 'idle', inputValue: '',
    jobManager: { running: () => [] }, activePlanRef: { current: null },
    outputBlocks: [], liveToolStreamsRef: { current: {} },
    inputHistory: [], allSlashCommands: [], availableEngines: [],
    setQuestionState: vi.fn(), setQuestionAnswer: vi.fn(),
  } as unknown as KeyboardInputDeps, '', { escape: true });
  expect(resolve).toHaveBeenCalledWith('n');
});
