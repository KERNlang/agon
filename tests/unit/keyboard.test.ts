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
    toolDetailOpen: false,
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
    fileRailFocused: false,
    fileRailExpanded: false,
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

  it('ignores ctrl+y so native terminal copy/yank behavior is not advertised as app chrome', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x19',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'none' });
  });

  it('ignores unmapped ctrl shortcuts', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x14',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'none' });
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

  it('routes ctrl+o to the focused tool detail viewer', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x0f',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'openToolDetail' });
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

  it('keeps navigation keys owned by the focused tool detail overlay', () => {
    expect(resolveKeyboardInput(baseCtx({
      toolDetailOpen: true,
      key: { pageDown: true },
    }))).toEqual({ type: 'none' });
  });

  it('leaves PgUp/PgDn/Home/End to the terminal — main-buffer + native scrollback owns scroll', () => {
    // In Agon's current architecture (no alt-screen, transcript rows committed
    // to Static → terminal scrollback), the app has no in-app scroll surface.
    // Scroll keys fall through; the keyboard resolver emits no scroll actions.
    for (const key of [{ pageUp: true }, { pageDown: true }, { home: true }, { end: true }, { shift: true, upArrow: true }, { shift: true, downArrow: true }]) {
      expect(resolveKeyboardInput(baseCtx({ key }))).toEqual({ type: 'none' });
    }
  });
});
