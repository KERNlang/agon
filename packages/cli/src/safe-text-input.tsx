// ── SafeTextInput ────────────────────────────────────────────────
// Forked from ink-text-input@6.0.0 with local fixes:
//
//   1. Ignore Ctrl-modified keystrokes (key.ctrl === true). The upstream
//      package processes Ctrl+E, Ctrl+T, Ctrl+L, etc. as plain text and
//      appends the letter to the value before the parent's own useInput
//      ever runs — leaking 'e' into the composer when Ctrl+E should toggle
//      tool-output expand. The fix is to drop ctrl-modified input at the
//      source so the parent's useInput is the sole consumer of those
//      shortcuts. Ctrl+C still passes (we already early-return for it
//      below) so cancel/exit shortcuts keep working.
//
//   2. Wrapped in React.memo so the App re-rendering ~11x/sec while Cesar
//      streams doesn't force the input to reconcile against stdin. With
//      stable handler refs from useCallback in app.kern, shallow-equal
//      props let React skip the re-render entirely.
//
//   3. Added shell-style editing primitives so the composer feels closer to
//      Codex / Claude Code: Home/End, Ctrl+A, word-wise Alt+Left/Right or
//      Alt+B/F, plus Ctrl+W/U/K for deleting word/start/end of line.
//
// Source of truth: ink-text-input GitHub
// (https://github.com/vadimdemedes/ink-text-input). When upstream gains
// the ctrl-skip, we can drop this fork.

import React, { useState, useEffect } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';

type Props = {
  value: string;
  placeholder?: string;
  focus?: boolean;
  mask?: string;
  highlightPastedText?: boolean;
  showCursor?: boolean;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onCtrlShortcut?: (shortcut: string) => void;
};

function isMouseReportInput(input: string): boolean {
  if (!input) return false;

  // xterm SGR mouse mode: full sequence or truncated fragments that sometimes
  // leak through Ink/input parsing when wheel scrolling is enabled.
  if (/\x1b\[<\d+;\d+;\d+[mM]/.test(input)) return true;
  if (/\[<\d+;\d+;\d+[mM]/.test(input)) return true;
  if (/^<\d+;\d+;\d+[mM]$/.test(input)) return true;
  if (/^\[<\d+;\d+;\d+[mM]$/.test(input)) return true;
  if (/^(?:\x1b\[)?<\d+;\d+;\d*$/.test(input)) return true;
  if (/^(?:\x1b\[|\[)?<\d+;\d+;\d*$/.test(input)) return true;

  return false;
}

function stripMouseReportInput(input: string): string {
  if (!input) return input;
  return input
    .replace(/\x1b\[<\d+;\d+;\d+[mM]/g, '')
    .replace(/\[<\d+;\d+;\d+[mM]/g, '')
    .replace(/(?:\x1b\[|\[)?<\d+;\d+;\d*(?:[mM])?/g, '');
}

function isWordChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_]/.test(char);
}

function charClass(char: string | undefined): 'space' | 'word' | 'punct' | 'none' {
  if (!char) return 'none';
  if (/\s/.test(char)) return 'space';
  if (isWordChar(char)) return 'word';
  return 'punct';
}

export function classifyDeleteInput(
  input: string,
  key: { backspace?: boolean; delete?: boolean },
): 'none' | 'backward' | 'forward' {
  if (input === '\x1b[3~') return 'forward';
  if (key.backspace || key.delete || input === '\x7f' || input === '\b' || input === '\x08') {
    return 'backward';
  }
  return 'none';
}

export function findLineStart(value: string, cursorOffset: number): number {
  const bounded = Math.max(0, Math.min(cursorOffset, value.length));
  const lineBreak = value.lastIndexOf('\n', bounded - 1);
  return lineBreak === -1 ? 0 : lineBreak + 1;
}

export function findLineEnd(value: string, cursorOffset: number): number {
  const bounded = Math.max(0, Math.min(cursorOffset, value.length));
  const lineBreak = value.indexOf('\n', bounded);
  return lineBreak === -1 ? value.length : lineBreak;
}

export function findWordBoundaryLeft(value: string, cursorOffset: number): number {
  let nextOffset = Math.max(0, Math.min(cursorOffset, value.length));
  while (nextOffset > 0 && charClass(value[nextOffset - 1]) === 'space') nextOffset--;
  const cls = charClass(value[nextOffset - 1]);
  while (nextOffset > 0 && charClass(value[nextOffset - 1]) === cls) nextOffset--;
  return nextOffset;
}

export function findWordBoundaryRight(value: string, cursorOffset: number): number {
  let nextOffset = Math.max(0, Math.min(cursorOffset, value.length));
  while (nextOffset < value.length && charClass(value[nextOffset]) === 'space') nextOffset++;
  const cls = charClass(value[nextOffset]);
  while (nextOffset < value.length && charClass(value[nextOffset]) === cls) nextOffset++;
  return nextOffset;
}

export function deleteWordBackward(value: string, cursorOffset: number): { value: string; cursorOffset: number } {
  const nextCursorOffset = findWordBoundaryLeft(value, cursorOffset);
  let deleteEnd = cursorOffset;
  if (deleteEnd > 0 && /\s/.test(value[deleteEnd] ?? '') && !/\s/.test(value[deleteEnd - 1] ?? '')) {
    while (deleteEnd < value.length && /\s/.test(value[deleteEnd] ?? '')) deleteEnd++;
  }
  return {
    value: value.slice(0, nextCursorOffset) + value.slice(deleteEnd),
    cursorOffset: nextCursorOffset,
  };
}

export function applyInlineInputEdits(
  value: string,
  cursorOffset: number,
  input: string,
): { value: string; cursorOffset: number; cursorWidth: number } {
  let nextValue = value;
  let nextCursorOffset = cursorOffset;
  let insertedChars = 0;

  for (const char of input) {
    if (char === '\x7f' || char === '\b' || char === '\x08') {
      if (nextCursorOffset > 0) {
        nextValue =
          nextValue.slice(0, nextCursorOffset - 1) +
          nextValue.slice(nextCursorOffset, nextValue.length);
        nextCursorOffset--;
      }
      continue;
    }

    nextValue =
      nextValue.slice(0, nextCursorOffset) +
      char +
      nextValue.slice(nextCursorOffset, nextValue.length);
    nextCursorOffset += char.length;
    insertedChars += char.length;
  }

  return {
    value: nextValue,
    cursorOffset: nextCursorOffset,
    cursorWidth: insertedChars > 1 ? insertedChars : 0,
  };
}

function SafeTextInputImpl({
  value: originalValue,
  placeholder = '',
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  onChange,
  onSubmit,
  onCtrlShortcut,
}: Props) {
  const [state, setState] = useState({
    cursorOffset: (originalValue || '').length,
    cursorWidth: 0,
  });
  const { cursorOffset, cursorWidth } = state;

  useEffect(() => {
    setState((previousState) => {
      if (!focus || !showCursor) return previousState;
      const newValue = originalValue || '';
      // Sync cursor when value shrinks past cursor position.
      // Was `> newValue.length - 1` which failed on single-char delete
      // (cursor 5, value "hello" → "hell" length 4: 5 > 3 ✓ but
      // cursor 5 on "hello" → "hell" should become 4, not wait until 5 > 3).
      if (previousState.cursorOffset > newValue.length) {
        return { cursorOffset: newValue.length, cursorWidth: 0 };
      }
      return previousState;
    });
  }, [originalValue, focus, showCursor]);

  const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
  const value = mask ? mask.repeat(originalValue.length) : originalValue;
  let renderedValue = value;
  let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

  if (showCursor && focus) {
    renderedPlaceholder = placeholder.length > 0
      ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
      : chalk.inverse(' ');
    renderedValue = value.length > 0 ? '' : chalk.inverse(' ');
    let i = 0;
    for (const char of value) {
      renderedValue += i >= cursorOffset - cursorActualWidth && i <= cursorOffset
        ? chalk.inverse(char)
        : char;
      i++;
    }
    if (value.length > 0 && cursorOffset === value.length) {
      renderedValue += chalk.inverse(' ');
    }
  }

  useInput(
    (input, key) => {
      if (isMouseReportInput(input)) return;
      input = stripMouseReportInput(input);
      const deleteMode = classifyDeleteInput(input, key);
      const isForwardDelete = deleteMode === 'forward';
      const isBackspace = deleteMode === 'backward';
      const extendedKey = key as typeof key & { home?: boolean; end?: boolean };
      const normalizedCtrlInput = key.ctrl
        ? ({
            '\x01': 'a',
            '\x03': 'c',
            '\x05': 'e',
            '\x0a': 'j',
            '\x0b': 'k',
            '\x0c': 'l',
            '\x12': 'r',
            '\x14': 't',
            '\x15': 'u',
            '\x17': 'w',
          } as Record<string, string>)[input] ?? input
        : input;
      const isReservedCtrlShortcut = key.ctrl && ['e', 'j', 'l', 'r', 't'].includes(normalizedCtrlInput);
      const isSupportedCtrlEditShortcut = key.ctrl && ['a', 'k', 'u', 'w'].includes(normalizedCtrlInput);
      const isWordLeft = (key.meta && (key.leftArrow || input === 'b')) || input === '\x1bb';
      const isWordRight = (key.meta && (key.rightArrow || input === 'f')) || input === '\x1bf';
      const isDeleteWordBackward = (key.ctrl && normalizedCtrlInput === 'w') || (key.meta && isBackspace) || input === '\x1b\x7f';
      const hasSpecialKeySignal =
        isBackspace ||
        isForwardDelete ||
        key.return ||
        key.leftArrow ||
        key.rightArrow ||
        key.upArrow ||
        key.downArrow ||
        key.pageUp ||
        key.pageDown ||
        key.tab ||
        (key.shift && key.tab) ||
        isWordLeft ||
        isWordRight ||
        isDeleteWordBackward ||
        extendedKey.home ||
        extendedKey.end;

      if (!input && !hasSpecialKeySignal) return;

      // Skip non-text navigation/control keys — let the parent App handle them.
      if (isReservedCtrlShortcut) {
        onCtrlShortcut?.(normalizedCtrlInput);
        return;
      }

      if (
        key.upArrow ||
        key.downArrow ||
        key.pageUp ||
        key.pageDown ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }

      if (key.ctrl && !isSupportedCtrlEditShortcut) {
        return;
      }

      // Ignore unrecognized Meta combos so Alt-based navigation doesn't leak
      // raw escape-prefixed text into the composer.
      if (key.meta && !isWordLeft && !isWordRight && !isDeleteWordBackward) {
        return;
      }

      if (key.return) {
        if (onSubmit) onSubmit(originalValue);
        return;
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;
      let nextCursorWidth = 0;

      if (extendedKey.home || (key.ctrl && normalizedCtrlInput === 'a')) {
        if (showCursor) nextCursorOffset = findLineStart(originalValue, cursorOffset);
      } else if (extendedKey.end) {
        if (showCursor) nextCursorOffset = findLineEnd(originalValue, cursorOffset);
      } else if (isWordLeft) {
        if (showCursor) nextCursorOffset = findWordBoundaryLeft(originalValue, cursorOffset);
      } else if (isWordRight) {
        if (showCursor) nextCursorOffset = findWordBoundaryRight(originalValue, cursorOffset);
      } else if (key.leftArrow) {
        if (showCursor) nextCursorOffset--;
      } else if (key.rightArrow) {
        if (showCursor) nextCursorOffset++;
      } else if (isDeleteWordBackward) {
        if (cursorOffset > 0) {
          const updated = deleteWordBackward(originalValue, cursorOffset);
          nextValue = updated.value;
          nextCursorOffset = updated.cursorOffset;
        }
      } else if (key.ctrl && normalizedCtrlInput === 'u') {
        const lineStart = findLineStart(originalValue, cursorOffset);
        nextValue = originalValue.slice(0, lineStart) + originalValue.slice(cursorOffset);
        nextCursorOffset = lineStart;
      } else if (key.ctrl && normalizedCtrlInput === 'k') {
        const lineEnd = findLineEnd(originalValue, cursorOffset);
        nextValue = originalValue.slice(0, cursorOffset) + originalValue.slice(lineEnd);
      } else if (isBackspace) {
        if (cursorOffset > 0) {
          nextValue =
            originalValue.slice(0, cursorOffset - 1) +
            originalValue.slice(cursorOffset, originalValue.length);
          nextCursorOffset--;
        }
      } else if (isForwardDelete) {
        if (cursorOffset < originalValue.length) {
          nextValue =
            originalValue.slice(0, cursorOffset) +
            originalValue.slice(cursorOffset + 1, originalValue.length);
        }
      } else {
        const updated = applyInlineInputEdits(originalValue, cursorOffset, input);
        nextValue = updated.value;
        nextCursorOffset = updated.cursorOffset;
        nextCursorWidth = updated.cursorWidth;
      }

      if (nextCursorOffset < 0) nextCursorOffset = 0;
      if (nextCursorOffset > nextValue.length) nextCursorOffset = nextValue.length;

      setState({ cursorOffset: nextCursorOffset, cursorWidth: nextCursorWidth });

      if (nextValue !== originalValue) {
        onChange(nextValue);
      }
    },
    { isActive: focus },
  );

  return React.createElement(
    Text,
    null,
    placeholder ? (value.length > 0 ? renderedValue : renderedPlaceholder) : renderedValue,
  );
}

export const SafeTextInput = React.memo(SafeTextInputImpl);
