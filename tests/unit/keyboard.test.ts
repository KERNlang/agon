import { describe, expect, it } from 'vitest';

import { resolveKeyboardInput } from '../../packages/cli/src/generated/signals/keyboard.js';

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    input: '',
    key: {},
    textInputActive: false,
    modelPickerOpen: false,
    cesarPickerOpen: false,
    slashPickerOpen: false,
    enginePickerOpen: false,
    reviewEventOpen: false,
    questionState: null,
    replState: 'idle',
    inputValue: '',
    inputHistory: [],
    historyIndex: -1,
    planModeQueued: false,
    activePlanState: null,
    outputBlockCount: 0,
    commands: [],
    engineIds: [],
    ...overrides,
  };
}

describe('resolveKeyboardInput', () => {
  it('defers reserved ctrl shortcuts to the active text input', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x05',
      key: { ctrl: true },
      textInputActive: true,
    }))).toEqual({ type: 'none' });
  });

  it('still handles ctrl shortcuts globally when no text input owns them', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x05',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'toggleToolExpand' });
  });

  it('routes ctrl+y to transcript copy when no text input owns it', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x19',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'copyTranscript' });
  });

  it('routes ctrl+g to selection mode toggle when no text input owns it', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x07',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'toggleSelectionMode' });
  });

  it('routes ctrl+r to results pager using the real control byte', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x12',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'openResults' });
  });

  it('keeps ctrl+c routed to cancel/exit even while text input is active', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x03',
      key: { ctrl: true },
      textInputActive: true,
    }))).toEqual({ type: 'cancelOrExit' });
  });

  it('defers ctrl+y to the active text input shortcut handler', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x19',
      key: { ctrl: true },
      textInputActive: true,
    }))).toEqual({ type: 'none' });
  });

  it('supports page and boundary scrolling keys for long transcripts', () => {
    expect(resolveKeyboardInput(baseCtx({
      key: { pageUp: true },
    }))).toEqual({ type: 'scroll', delta: 12 });

    expect(resolveKeyboardInput(baseCtx({
      key: { pageDown: true },
    }))).toEqual({ type: 'scroll', delta: -12 });

    expect(resolveKeyboardInput(baseCtx({
      key: { home: true },
    }))).toEqual({ type: 'scrollToTop' });

    expect(resolveKeyboardInput(baseCtx({
      key: { end: true },
    }))).toEqual({ type: 'scrollToBottom' });
  });
});
