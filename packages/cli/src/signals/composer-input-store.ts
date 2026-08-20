import { useSyncExternalStore } from 'react';

/**
 * External store for the composer's text.
 *
 * WHY this is not `useState` in App: the REPL's App component is the whole
 * surface (transcript, chrome, rails, pickers, ~50 memos). Holding the
 * composer value in App state means every single keystroke re-renders that
 * entire tree, and the measured cost of one App commit dominates keystroke
 * latency (see scripts/perf/repl-typing-probe.mjs). Keeping the value in an
 * external store lets the composer leaf subscribe to it while App does not,
 * so typing costs one *leaf* commit instead of one *whole-app* commit.
 *
 * `ref` is a live view of the same value: reads see the latest text and
 * writes go through `set` (so the historical `inputValueRef.current = x`
 * idiom in App keeps working and still notifies subscribers).
 */
export interface ComposerInputStore {
  /** Current composer text. */
  get(): string;
  /** Replace the text (value or updater). No-op + no notify when unchanged. */
  set(next: string | ((prev: string) => string)): void;
  /** Subscribe to text changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Live `{ current }` view — reads and writes proxy to get/set. */
  readonly ref: { current: string };
}

export function createComposerInputStore(initial = ''): ComposerInputStore {
  let value = initial;
  const listeners = new Set<() => void>();

  const get = (): string => value;

  const set = (next: string | ((prev: string) => string)): void => {
    const resolved = typeof next === 'function' ? next(value) : next;
    if (resolved === value) return;
    value = resolved;
    for (const listener of [...listeners]) listener();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  const ref = {
    get current(): string { return value; },
    set current(next: string) { set(next); },
  };

  return { get, set, subscribe, ref };
}

/**
 * Subscribe a component to the composer text. Only the subscribing component
 * re-renders when the text changes.
 */
export function useComposerInputValue(store: ComposerInputStore): string {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Subscribe to the *emptiness* of the composer only. Used by App for the
 * side-rail focus rules: this flips at most twice per typing burst, so App
 * stays out of the per-keystroke render path.
 */
export function useComposerInputEmpty(store: ComposerInputStore): boolean {
  const isEmpty = (): boolean => store.get().trim().length === 0;
  return useSyncExternalStore(store.subscribe, isEmpty, isEmpty);
}
