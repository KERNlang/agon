// Vendored from @kernlang/terminal v4.5.0 (dist/runtime/terminal-mode.js).
// Process-wide ref-counting so several components can ask for raw mode / the
// alternate screen without fighting over the terminal: the first acquirer
// enters, the last releaser exits.

/** Raw-mode acquisitions currently outstanding. */
let rawModeRefCount = 0;

/**
 * Put stdin in raw mode (if the TTY supports it) and return a release fn.
 * Releasing is idempotent; the terminal only leaves raw mode once every holder
 * has released.
 */
export function acquireRawMode(setRawMode: (value: boolean) => void, supported: boolean): () => void {
  if (!supported) return () => undefined;
  if (rawModeRefCount === 0) setRawMode(true);
  rawModeRefCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    rawModeRefCount -= 1;
    if (rawModeRefCount === 0) setRawMode(false);
  };
}

export interface AltScreenOps {
  enter: () => void;
  exit: () => void;
  enableMouse?: () => void;
  disableMouse?: () => void;
}

let altScreenRefCount = 0;
let mouseTrackingRefCount = 0;

/** Teardown writes must never throw — the stream is often already closed. */
function safeCall(fn: () => void): void {
  try {
    fn();
  } catch {
    // terminal stream already closed
  }
}

/**
 * Enter the alternate screen (and optionally mouse tracking) and return a
 * release fn. Both are ref-counted independently, so a mouse-tracking child
 * inside a non-tracking parent still restores cleanly.
 */
export function acquireAltScreen(ops: AltScreenOps): () => void {
  if (altScreenRefCount === 0) ops.enter();
  altScreenRefCount += 1;

  const enableMouse = ops.enableMouse;
  const disableMouse = ops.disableMouse;
  const tracksMouse = Boolean(enableMouse && disableMouse);
  if (tracksMouse && enableMouse) {
    if (mouseTrackingRefCount === 0) enableMouse();
    mouseTrackingRefCount += 1;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (tracksMouse && disableMouse) {
      mouseTrackingRefCount -= 1;
      if (mouseTrackingRefCount === 0) safeCall(disableMouse);
    }
    altScreenRefCount -= 1;
    if (altScreenRefCount === 0) safeCall(ops.exit);
  };
}

/** How many alternate-screen holders are live (diagnostics / tests). */
export function getAltScreenActiveCount(): number {
  return altScreenRefCount;
}
