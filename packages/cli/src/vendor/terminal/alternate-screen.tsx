// Vendored from @kernlang/terminal v4.5.0 (dist/runtime/alternate-screen.js).
// Renders its children on the terminal's alternate screen buffer (optionally
// with mouse tracking) and guarantees the buffer is restored — on unmount, on
// SIGINT/SIGTERM, and on an uncaught exception.

import React, { useEffect, useInsertionEffect, useRef, useState } from 'react';
import { Box, useStdin, useStdout } from 'ink';

import { acquireAltScreen, acquireRawMode } from './terminal-mode.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

const DEFAULT_ROWS = 24;
const DEFAULT_COLUMNS = 80;

/** POSIX exit codes for signal-terminated processes (128 + signal number). */
const EXIT_CODE_SIGINT = 130;
const EXIT_CODE_SIGTERM = 143;

interface AltScreenInstance {
  release: () => void;
}

interface SignalHandlers {
  cleanup: () => void;
  onInt: () => void;
  onTerm: () => void;
  onExcept: (err: unknown) => void;
}

// Module-level so N mounted AlternateScreens share one set of process hooks.
const activeInstances = new Set<AltScreenInstance>();
let signalHandlers: SignalHandlers | null = null;

function runGlobalCleanup(): void {
  for (const inst of activeInstances) {
    try {
      inst.release();
    } catch {
      // stream already closed
    }
  }
}

function attachSignalHandlers(): void {
  if (signalHandlers) return;

  const cleanup = () => runGlobalCleanup();
  const onInt = () => {
    cleanup();
    process.exit(EXIT_CODE_SIGINT);
  };
  const onTerm = () => {
    cleanup();
    process.exit(EXIT_CODE_SIGTERM);
  };
  // Restore the screen first, then let the exception keep propagating so the
  // crash is still reported normally.
  const onExcept = (err: unknown) => {
    cleanup();
    throw err;
  };

  signalHandlers = { cleanup, onInt, onTerm, onExcept };
  process.on('exit', cleanup);
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.on('uncaughtException', onExcept);
}

function detachSignalHandlers(): void {
  if (!signalHandlers) return;
  process.off('exit', signalHandlers.cleanup);
  process.off('SIGINT', signalHandlers.onInt);
  process.off('SIGTERM', signalHandlers.onTerm);
  process.off('uncaughtException', signalHandlers.onExcept);
  signalHandlers = null;
}

export interface AlternateScreenProps {
  /** Emit SGR mouse-tracking escapes so children can read wheel/click events. */
  mouseTracking?: boolean;
  children?: React.ReactNode;
}

export function AlternateScreen({ mouseTracking = false, children }: AlternateScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const { stdin, setRawMode, isRawModeSupported } = useStdin();

  const [dimensions, setDimensions] = useState(() => ({
    rows: stdout?.rows ?? DEFAULT_ROWS,
    columns: stdout?.columns ?? DEFAULT_COLUMNS,
  }));

  const instanceRef = useRef<AltScreenInstance | null>(null);

  // useInsertionEffect: switch buffers BEFORE Ink paints the first frame, so
  // no output ever lands on the primary screen.
  useInsertionEffect(() => {
    const release = acquireAltScreen({
      enter: () => stdout.write(ENTER_ALT_SCREEN),
      exit: () => stdout.write(EXIT_ALT_SCREEN),
      enableMouse: mouseTracking ? () => stdout.write(ENABLE_MOUSE) : undefined,
      disableMouse: mouseTracking ? () => stdout.write(DISABLE_MOUSE) : undefined,
    });

    const inst: AltScreenInstance = { release };
    instanceRef.current = inst;
    activeInstances.add(inst);
    attachSignalHandlers();

    return () => {
      release();
      activeInstances.delete(inst);
      instanceRef.current = null;
      if (activeInstances.size === 0) detachSignalHandlers();
    };
  }, [stdout, mouseTracking]);

  useEffect(() => {
    if (!mouseTracking) return;
    const release = acquireRawMode(setRawMode, isRawModeSupported);
    return () => {
      release();
    };
  }, [mouseTracking, isRawModeSupported, setRawMode, stdin]);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setDimensions({
        rows: stdout.rows ?? DEFAULT_ROWS,
        columns: stdout.columns ?? DEFAULT_COLUMNS,
      });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return (
    <Box flexDirection="column" width={dimensions.columns} height={dimensions.rows} flexShrink={0}>
      {children}
    </Box>
  );
}
