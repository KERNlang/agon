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
    autoModeQueued: false,
    activePlanState: null,
    outputBlockCount: 0,
    commands: [],
    engineIds: [],
    fileRailFocused: false,
    fileRailExpanded: false,
    executionRailFocused: false,
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

  it('routes ctrl+y to failed-tool retry when no text input owns it', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x19',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'retryFailedTool' });
  });

  it('routes ctrl+g to the live execution rail as the advertised shortcut', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x07',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'toggleExecutionRail' });
  });

  it('defers ctrl+g to the active text input', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x07',
      key: { ctrl: true },
      textInputActive: true,
    }))).toEqual({ type: 'none' });
  });

  it('ignores unmapped ctrl shortcuts', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x06',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'none' });
  });

  it('routes ctrl+r to results pager using the real control byte', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x12',
      key: { ctrl: true },
      textInputActive: false,
    }))).toEqual({ type: 'openResults' });
  });

  it('routes ctrl+i to the live execution rail before tab queues plan mode', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\t',
      key: { ctrl: true, tab: true },
      textInputActive: false,
    }))).toEqual({ type: 'toggleExecutionRail' });
  });

  it('routes raw ctrl+b to the file rail even when the terminal omits key.ctrl', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x02',
      key: {},
      textInputActive: false,
    }))).toEqual({ type: 'toggleFileRail' });
  });

  it('routes ctrl+b to the file rail when Ink reports only key.name', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '',
      key: { ctrl: true, name: 'b' },
      textInputActive: false,
    }))).toEqual({ type: 'toggleFileRail' });
  });

  it('defers key.name ctrl+b to the active text input', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '',
      key: { ctrl: true, name: 'b' },
      textInputActive: true,
    }))).toEqual({ type: 'none' });
  });

  it('keeps raw ctrl+t as a hidden live execution rail alias', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x14',
      key: {},
      textInputActive: false,
    }))).toEqual({ type: 'toggleExecutionRail' });
  });

  it('routes ctrl+i to the live rail when Ink reports key.name', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '',
      key: { ctrl: true, name: 'i' },
      textInputActive: false,
    }))).toEqual({ type: 'toggleExecutionRail' });
  });

  it('closes the focused execution rail on escape', () => {
    expect(resolveKeyboardInput(baseCtx({
      key: { escape: true },
      executionRailFocused: true,
    }))).toEqual({ type: 'executionRailClose' });
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

  it('routes plain tab to queued plan mode when the composer is idle and empty', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\t',
      key: { tab: true },
    }))).toEqual({ type: 'togglePlanQueued' });
  });

  it('routes shift+tab to the permission-mode cycle before the plain tab handler', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\t',
      key: { tab: true, shift: true },
    }))).toEqual({ type: 'cyclePermissionMode' });
  });

  it('routes raw terminal shift+tab escape sequence to the permission-mode cycle', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\x1b[Z',
      key: {},
    }))).toEqual({ type: 'cyclePermissionMode' });
  });

  it('routes ctrl+a on an idle empty composer to queued auto mode', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: 'a',
      key: { ctrl: true },
    }))).toEqual({ type: 'toggleAutoQueued' });
  });

  it('routes ctrl+a on an active empty composer to queued auto mode', () => {
    expect(resolveKeyboardInput(baseCtx({
      replState: 'streaming',
      input: 'a',
      key: { ctrl: true },
    }))).toEqual({ type: 'toggleAutoQueued' });
  });

  it('leaves ctrl+a alone when the composer has text so text editing owns it', () => {
    expect(resolveKeyboardInput(baseCtx({
      inputValue: 'hello',
      input: 'a',
      key: { ctrl: true },
    }))).toEqual({ type: 'none' });
  });

  it('does not cancel persistent auto mode with escape', () => {
    expect(resolveKeyboardInput(baseCtx({
      autoModeQueued: true,
      key: { escape: true },
    }))).toEqual({ type: 'none' });
  });

  it('resolves choice questions with their default on Enter', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\r',
      key: { return: true },
      questionState: {
        defaultChoiceKey: 'y',
        choices: [{ key: 'y', label: 'Approve' }, { key: 'n', label: 'Reject' }],
      },
    }))).toEqual({ type: 'resolveChoice', choiceKey: 'y' });
  });

  it('instantly resolves a choice by its visible key', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: 'e',
      key: {},
      questionState: {
        choices: [{ key: 'y', label: 'Approve' }, { key: 'e', label: 'Edit file' }],
      },
    }))).toEqual({ type: 'resolveChoice', choiceKey: 'e' });
  });

  it('instantly resolves a choice by its 1-based position digit', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '2',
      key: {},
      questionState: { choices: [{ key: 'y', label: 'Approve' }, { key: 'e', label: 'Edit file' }] },
    }))).toEqual({ type: 'resolveChoice', choiceKey: 'e' });
  });

  it('opens the inline Other editor (does NOT auto-apply) when the __other number is pressed', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '2',
      key: {},
      questionState: { choices: [{ key: 'y', label: 'Yes' }, { key: '__other', label: 'Other' }] },
    }))).toEqual({ type: 'enterOther' });
  });

  it('moves the cursor with arrow keys and wraps at the edges', () => {
    const choices = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }];
    expect(resolveKeyboardInput(baseCtx({ key: { downArrow: true }, questionChoiceIndex: 0, questionState: { choices } })))
      .toEqual({ type: 'moveChoice', index: 1 });
    expect(resolveKeyboardInput(baseCtx({ key: { upArrow: true }, questionChoiceIndex: 0, questionState: { choices } })))
      .toEqual({ type: 'moveChoice', index: 2 });
  });

  it('confirms the highlighted choice on Enter', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\r',
      key: { return: true },
      questionChoiceIndex: 1,
      questionState: { choices: [{ key: 'y', label: 'Approve' }, { key: 'e', label: 'Edit file' }] },
    }))).toEqual({ type: 'resolveChoice', choiceKey: 'e' });
  });

  it('opens the inline Other editor when Enter lands on the __other row', () => {
    expect(resolveKeyboardInput(baseCtx({
      input: '\r',
      key: { return: true },
      questionChoiceIndex: 1,
      questionState: { choices: [{ key: 'y', label: 'Yes' }, { key: '__other', label: 'Other' }] },
    }))).toEqual({ type: 'enterOther' });
  });

  it('lets the inline editor own typing while Other is active, and Esc returns to the list', () => {
    const questionState = { choices: [{ key: 'y', label: 'Yes' }, { key: '__other', label: 'Other' }] };
    expect(resolveKeyboardInput(baseCtx({ input: 'h', key: {}, questionOtherActive: true, questionState })))
      .toEqual({ type: 'none' });
    expect(resolveKeyboardInput(baseCtx({ key: { escape: true }, questionOtherActive: true, questionState })))
      .toEqual({ type: 'exitOther' });
  });

  it('plan approval: arrows and y/n/o move the cursor without applying', () => {
    // Indices are in VISUAL order: 0=Approve, 1=Other, 2=Reject.
    expect(resolveKeyboardInput(baseCtx({ key: { downArrow: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 0 })))
      .toEqual({ type: 'movePlanApproval', index: 1 });
    expect(resolveKeyboardInput(baseCtx({ input: 'y', key: {}, activePlanState: 'awaiting_approval' })))
      .toEqual({ type: 'movePlanApproval', index: 0 });
    expect(resolveKeyboardInput(baseCtx({ input: 'o', key: {}, activePlanState: 'awaiting_approval' })))
      .toEqual({ type: 'movePlanApproval', index: 1 });
    expect(resolveKeyboardInput(baseCtx({ input: 'n', key: {}, activePlanState: 'awaiting_approval' })))
      .toEqual({ type: 'movePlanApproval', index: 2 });
  });

  it('plan approval: Enter confirms the highlighted action', () => {
    expect(resolveKeyboardInput(baseCtx({ input: '\r', key: { return: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 0 })))
      .toEqual({ type: 'planControl', action: 'approve' });
    // index 1 = Other → revise; index 2 = Reject → cancel.
    expect(resolveKeyboardInput(baseCtx({ input: '\r', key: { return: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 1 })))
      .toEqual({ type: 'planControl', action: 'revise' });
    expect(resolveKeyboardInput(baseCtx({ input: '\r', key: { return: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 2 })))
      .toEqual({ type: 'planControl', action: 'cancel' });
  });

  it('plan approval: 3-way cursor cycles in visual order — Approve→Other→Reject; o/3 jump; Enter on Other revises', () => {
    // Arrow cycle matches the on-screen top-to-bottom layout (0=Approve,
    // 1=Other, 2=Reject). Down never skips the middle Other slot.
    expect(resolveKeyboardInput(baseCtx({ key: { downArrow: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 0 })))
      .toEqual({ type: 'movePlanApproval', index: 1 }); // Approve → Other
    expect(resolveKeyboardInput(baseCtx({ key: { downArrow: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 1 })))
      .toEqual({ type: 'movePlanApproval', index: 2 }); // Other → Reject
    expect(resolveKeyboardInput(baseCtx({ key: { downArrow: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 2 })))
      .toEqual({ type: 'movePlanApproval', index: 0 }); // Reject → Approve (wrap)
    // Up from Approve wraps to Reject (bottom).
    expect(resolveKeyboardInput(baseCtx({ key: { upArrow: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 0 })))
      .toEqual({ type: 'movePlanApproval', index: 2 });
    // o/2 jump straight to Other (middle); n/3 to Reject (bottom).
    expect(resolveKeyboardInput(baseCtx({ input: 'o', key: {}, activePlanState: 'awaiting_approval' })))
      .toEqual({ type: 'movePlanApproval', index: 1 });
    expect(resolveKeyboardInput(baseCtx({ input: '2', key: {}, activePlanState: 'awaiting_approval' })))
      .toEqual({ type: 'movePlanApproval', index: 1 });
    expect(resolveKeyboardInput(baseCtx({ input: '3', key: {}, activePlanState: 'awaiting_approval' })))
      .toEqual({ type: 'movePlanApproval', index: 2 });
    // Enter on Other emits 'revise' — the app route clears the proposal and
    // pre-fills the composer for free-form feedback.
    expect(resolveKeyboardInput(baseCtx({ input: '\r', key: { return: true }, activePlanState: 'awaiting_approval', planApprovalIndex: 1 })))
      .toEqual({ type: 'planControl', action: 'revise' });
  });

  it('leaves PgUp/PgDn/Home/End to the terminal — main-buffer + native scrollback owns scroll', () => {
    // In Agon's current architecture (no alt-screen, transcript rows committed
    // to Static → terminal scrollback), the app has no in-app scroll surface.
    // Scroll keys fall through; the keyboard resolver emits no scroll actions.
    for (const key of [{ pageUp: true }, { pageDown: true }, { home: true }, { end: true }, { shift: true, upArrow: true }, { shift: true, downArrow: true }]) {
      expect(resolveKeyboardInput(baseCtx({ key }))).toEqual({ type: 'none' });
    }
  });

  describe('update banner hotkeys (u/l/x)', () => {
    const updateInfo = { currentVersion: '0.1.3', latestVersion: '0.1.4', hasUpdate: true, releaseTag: 'latest' };

    it('routes bare u/l/x to the update banner when the composer is empty and no surface is focused', () => {
      expect(resolveKeyboardInput(baseCtx({ input: 'u', key: {}, updateInfo })))
        .toEqual({ type: 'updateBanner', action: 'update' });
      expect(resolveKeyboardInput(baseCtx({ input: 'l', key: {}, updateInfo })))
        .toEqual({ type: 'updateBanner', action: 'changelog' });
      expect(resolveKeyboardInput(baseCtx({ input: 'x', key: {}, updateInfo })))
        .toEqual({ type: 'updateBanner', action: 'dismiss' });
    });

    it('does NOT fire on uppercase U/L/X (lowercase-only by design, so they type normally)', () => {
      // The banner advertises a lowercase "u" and the composer's deferral is
      // case-sensitive, so uppercase variants must NOT trigger the banner —
      // they fall through and get typed (e.g. starting a message with "Use…").
      for (const ch of ['U', 'L', 'X']) {
        const result = resolveKeyboardInput(baseCtx({ input: ch, key: {}, updateInfo }));
        expect(result).not.toEqual(expect.objectContaining({ type: 'updateBanner' }));
      }
    });

    it('does NOT hijack u/l/x when the composer has any content (regression: user is typing a message)', () => {
      // Regression: the previous implementation matched bare u/l/x regardless
      // of inputValue, so typing a message containing those letters while the
      // update banner was visible would silently pop the update prompt.
      for (const ch of ['u', 'l', 'x', 'U', 'L', 'X']) {
        const result = resolveKeyboardInput(baseCtx({
          input: ch,
          key: {},
          inputValue: 'hello',
          updateInfo,
        }));
        expect(result).not.toEqual(expect.objectContaining({ type: 'updateBanner' }));
      }
    });

    it('fires u/l/x even while the main composer is focused (regression: textInputActive must NOT gate it)', () => {
      // The main composer is ALWAYS focused in normal chat (textInputActive
      // true), so the previous `!textInputActive` gate made this branch dead —
      // `u` fell through and got typed instead of triggering the update. The
      // composer now DEFERS these exact keys while the banner shows
      // (reservedPlainKeys), so firing here is correct and the char is never
      // also inserted. Protection against typing a message lives in the
      // empty-composer check (inputValue === ''), tested above.
      const expected = { u: 'update', l: 'changelog', x: 'dismiss' } as const;
      for (const ch of ['u', 'l', 'x'] as const) {
        const result = resolveKeyboardInput(baseCtx({
          input: ch,
          key: {},
          textInputActive: true,
          updateInfo,
        }));
        expect(result).toEqual({ type: 'updateBanner', action: expected[ch] });
      }
    });

    it('does NOT hijack u/l/x while a choice question is open (keyboard owns the question row)', () => {
      const result = resolveKeyboardInput(baseCtx({
        input: 'u',
        key: {},
        questionState: { prompt: '?', choices: [{ key: 'a', label: 'a' }] },
        updateInfo,
      }));
      expect(result).not.toEqual(expect.objectContaining({ type: 'updateBanner' }));
    });

    it('does NOT fire when updateInfo is absent (banner hidden)', () => {
      for (const ch of ['u', 'l', 'x']) {
        const result = resolveKeyboardInput(baseCtx({ input: ch, key: {} }));
        expect(result).not.toEqual(expect.objectContaining({ type: 'updateBanner' }));
      }
    });
  });

  describe('↑ pops queued steering back into the composer (edit/remove)', () => {
    it('returns popSteering on ↑ with an empty composer while steering is queued', () => {
      const result = resolveKeyboardInput(baseCtx({
        key: { upArrow: true },
        replState: 'busy',
        steeringCount: 1,
        inputHistory: ['older entry'],
      }));
      expect(result).toEqual({ type: 'popSteering' });
    });

    it('keeps ↑ on history navigation once the composer has text', () => {
      const result = resolveKeyboardInput(baseCtx({
        key: { upArrow: true },
        replState: 'busy',
        steeringCount: 1,
        inputValue: 'popped message being edited',
        inputHistory: ['older entry'],
      }));
      expect(result).toEqual(expect.objectContaining({ type: 'historySet' }));
    });

    it('keeps ↑ on history navigation when nothing is queued', () => {
      const result = resolveKeyboardInput(baseCtx({
        key: { upArrow: true },
        steeringCount: 0,
        inputHistory: ['older entry'],
      }));
      expect(result).toEqual(expect.objectContaining({ type: 'historySet' }));
    });
  });

  describe('esc with typed text interrupts AND submits the redirect', () => {
    it('maps escape during a run with composer text to interruptSubmit carrying the text', () => {
      const result = resolveKeyboardInput(baseCtx({
        key: { escape: true },
        replState: 'busy',
        inputValue: 'stop — check the auth flow instead',
      }));
      expect(result).toEqual({ type: 'interruptSubmit', value: 'stop — check the auth flow instead' });
    });

    it('keeps plain interrupt on escape with an empty composer', () => {
      const result = resolveKeyboardInput(baseCtx({
        key: { escape: true },
        replState: 'busy',
        inputValue: '',
      }));
      expect(result).toEqual({ type: 'interrupt' });
    });
  });
});
