// ── SafeTextInput ────────────────────────────────────────────────
// Forked from ink-text-input@6.0.0 with two changes:
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
};

function SafeTextInputImpl({
  value: originalValue,
  placeholder = '',
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  onChange,
  onSubmit,
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
      if (previousState.cursorOffset > newValue.length - 1) {
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
      // Skip non-text navigation/control keys — let the parent App handle them.
      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && input === 'c') ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }

      // CRITICAL FIX vs upstream: drop Ctrl-modified keystrokes entirely.
      // Without this, Ctrl+E/Ctrl+T/Ctrl+L append 'e'/'t'/'l' before the
      // App's own useInput ever runs.
      if (key.ctrl) {
        return;
      }

      if (key.return) {
        if (onSubmit) onSubmit(originalValue);
        return;
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;
      let nextCursorWidth = 0;

      if (key.leftArrow) {
        if (showCursor) nextCursorOffset--;
      } else if (key.rightArrow) {
        if (showCursor) nextCursorOffset++;
      } else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          nextValue =
            originalValue.slice(0, cursorOffset - 1) +
            originalValue.slice(cursorOffset, originalValue.length);
          nextCursorOffset--;
        }
      } else {
        nextValue =
          originalValue.slice(0, cursorOffset) +
          input +
          originalValue.slice(cursorOffset, originalValue.length);
        nextCursorOffset += input.length;
        if (input.length > 1) nextCursorWidth = input.length;
      }

      if (cursorOffset < 0) nextCursorOffset = 0;
      if (cursorOffset > originalValue.length) nextCursorOffset = originalValue.length;

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
