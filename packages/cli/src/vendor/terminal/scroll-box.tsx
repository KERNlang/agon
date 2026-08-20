// Vendored from @kernlang/terminal v4.5.0 (dist/runtime/scroll-box.js).
// A windowing Ink container: it renders only the child rows that fall inside
// the measured viewport and scrolls them with the mouse wheel or imperatively
// through its ref handle.

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, measureElement, useStdin, useStdout } from 'ink';

import { acquireRawMode } from './terminal-mode.js';

/** SGR mouse report: ESC [ < button ; column ; row (M=press, m=release). */
const SGR_MOUSE_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Cap on the unparsed stdin tail we keep while waiting for a complete report. */
const STDIN_BUFFER_MAX = 4096;

const DEFAULT_VIEWPORT_ROWS = 24;

/** Rows scrolled per wheel notch. */
const WHEEL_STEP = 3;

export interface ScrollBoxHandle {
  scrollTo(y: number): void;
  scrollBy(dy: number): void;
  scrollToBottom(): void;
  getScrollTop(): number;
  getScrollHeight(): number;
  getFreshScrollHeight(): number;
  getViewportHeight(): number;
  getViewportTop(): number;
  isSticky(): boolean;
  setClampBounds(min: number, max: number): void;
  subscribe(listener: (scrollTop: number) => void): () => void;
}

export interface ScrollBoxProps {
  /** Stay pinned to the bottom as content grows (until the user scrolls away). */
  stickyScroll?: boolean;
  flexGrow?: number;
  flexShrink?: number;
  height?: number;
  /** Terminal rows each child occupies. */
  rowHeight?: number;
  children?: React.ReactNode;
}

interface ScrollState {
  scrollTop: number;
  viewportRows: number;
  totalRows: number;
  clampMin: number;
  clampMax: number;
  stickyScroll: boolean;
}

/**
 * Sum the wheel deltas in a stdin chunk. XTerm mouse buttons: bit 6 (64) marks
 * a wheel event, bit 7 (128) an extended one, bits 2-5 modifiers. Wheel-up has
 * the low bits at 00, wheel-down at 01. Drags, releases and plain clicks are
 * intentionally ignored.
 */
function parseWheelDelta(chunk: string): number {
  let delta = 0;
  SGR_MOUSE_PATTERN.lastIndex = 0;
  let match = SGR_MOUSE_PATTERN.exec(chunk);
  while (match !== null) {
    const button = Number(match[1]);
    const isWheel = (button & 64) === 64 && (button & 128) === 0;
    const low = button & 3;
    if (isWheel && low === 0) delta -= WHEEL_STEP;
    else if (isWheel && low === 1) delta += WHEEL_STEP;
    match = SGR_MOUSE_PATTERN.exec(chunk);
  }
  return delta;
}

export const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(function ScrollBox(
  { stickyScroll = false, flexGrow, flexShrink, height, rowHeight = 1, children },
  ref,
) {
  const { stdin, isRawModeSupported, setRawMode } = useStdin();
  const { stdout } = useStdout();

  const childArray = useMemo(() => React.Children.toArray(children), [children]);
  const totalRows = childArray.length * rowHeight;

  const [viewportRows, setViewportRows] = useState<number>(() => {
    if (typeof height === 'number') return height;
    return stdout?.rows ?? DEFAULT_VIEWPORT_ROWS;
  });

  const [scrollTop, setScrollTop] = useState<number>(() => {
    if (!stickyScroll) return 0;
    const initialViewport = typeof height === 'number' ? height : (stdout?.rows ?? DEFAULT_VIEWPORT_ROWS);
    const initialTotal = React.Children.count(children) * rowHeight;
    return Math.max(0, initialTotal - initialViewport);
  });

  const [clampMin, setClampMin] = useState(0);
  const [clampMax, setClampMax] = useState(Number.POSITIVE_INFINITY);

  const stickyRef = useRef(stickyScroll);
  const listenersRef = useRef<Set<(scrollTop: number) => void>>(new Set());
  const containerRef = useRef<any>(null);
  const stdinBufferRef = useRef('');

  // Mirror of the render state, readable from the stdin/imperative callbacks
  // without re-subscribing them on every scroll.
  const latestRef = useRef<ScrollState>({
    scrollTop: 0,
    viewportRows,
    totalRows,
    clampMin: 0,
    clampMax: Number.POSITIVE_INFINITY,
    stickyScroll,
  });

  useEffect(() => {
    stickyRef.current = stickyScroll;
  }, [stickyScroll]);

  const maxScroll = Math.max(0, Math.min(clampMax, totalRows - viewportRows));
  const minScroll = Math.max(0, clampMin);
  const clamp = useCallback(
    (value: number) => Math.max(minScroll, Math.min(maxScroll, value)),
    [minScroll, maxScroll],
  );

  useEffect(() => {
    latestRef.current = {
      scrollTop,
      viewportRows,
      totalRows,
      clampMin: minScroll,
      clampMax: maxScroll,
      stickyScroll,
    };
  });

  // Yoga knows the real height only after layout; adopt it as the viewport.
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const measured = measureElement(containerRef.current);
    const measuredHeight = measured?.height ?? 0;
    if (measuredHeight > 0 && measuredHeight !== viewportRows) {
      setViewportRows(measuredHeight);
    } else if (typeof height === 'number' && height !== viewportRows) {
      setViewportRows(height);
    }
  });

  useLayoutEffect(() => {
    setScrollTop((prev) => {
      const next = clamp(prev);
      return next === prev ? prev : next;
    });
  }, [clamp]);

  useLayoutEffect(() => {
    if (!stickyRef.current) return;
    setScrollTop(maxScroll);
  }, [totalRows, maxScroll]);

  const notifyImperative = useCallback((top: number) => {
    for (const listener of listenersRef.current) listener(top);
  }, []);

  useEffect(() => {
    if (!stdin || !isRawModeSupported) return;
    const release = acquireRawMode(setRawMode, isRawModeSupported);

    const onData = (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      stdinBufferRef.current += text;
      let buf = stdinBufferRef.current;

      // Never grow without bound: keep only from the last escape onward.
      if (buf.length > STDIN_BUFFER_MAX) {
        const keepFrom = buf.lastIndexOf('\x1b');
        buf = keepFrom >= 0 ? buf.slice(keepFrom) : '';
        stdinBufferRef.current = buf;
      }

      // Parse whole reports only; a truncated tail waits for the next chunk.
      const lastComplete = Math.max(buf.lastIndexOf('M'), buf.lastIndexOf('m'));
      if (lastComplete === -1) return;
      const toParse = buf.slice(0, lastComplete + 1);
      stdinBufferRef.current = buf.slice(lastComplete + 1);

      const delta = parseWheelDelta(toParse);
      if (delta === 0) return;

      setScrollTop((prev) => {
        const { clampMin: cMin, clampMax: cMax, stickyScroll: sticky } = latestRef.current;
        const next = Math.max(cMin, Math.min(cMax, prev + delta));
        // Scrolling off the bottom breaks stickiness; scrolling back re-arms it.
        if (next !== cMax) stickyRef.current = false;
        else if (sticky) stickyRef.current = true;
        notifyImperative(next);
        return next;
      });
    };

    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      release();
    };
  }, [stdin, isRawModeSupported, setRawMode, notifyImperative]);

  useImperativeHandle(
    ref,
    (): ScrollBoxHandle => ({
      scrollTo(y: number) {
        setScrollTop(() => {
          const { clampMin: cMin, clampMax: cMax, stickyScroll: sticky } = latestRef.current;
          const next = Math.max(cMin, Math.min(cMax, y));
          stickyRef.current = next === cMax && sticky;
          notifyImperative(next);
          return next;
        });
      },
      scrollBy(dy: number) {
        setScrollTop((prev) => {
          const { clampMin: cMin, clampMax: cMax, stickyScroll: sticky } = latestRef.current;
          const next = Math.max(cMin, Math.min(cMax, prev + dy));
          stickyRef.current = next === cMax && sticky;
          notifyImperative(next);
          return next;
        });
      },
      scrollToBottom() {
        stickyRef.current = stickyRef.current || latestRef.current.stickyScroll;
        const target = latestRef.current.clampMax;
        setScrollTop(target);
        notifyImperative(target);
      },
      getScrollTop: () => latestRef.current.scrollTop,
      getScrollHeight: () => latestRef.current.totalRows,
      // Bypasses the render-lagged mirror — callers that just appended children
      // need the height those children imply, not last frame's.
      getFreshScrollHeight: () => React.Children.count(children) * rowHeight,
      getViewportHeight: () => latestRef.current.viewportRows,
      getViewportTop: () => latestRef.current.scrollTop,
      isSticky: () => stickyRef.current,
      setClampBounds(min: number, max: number) {
        setClampMin(min);
        setClampMax(max);
      },
      subscribe(listener: (scrollTop: number) => void) {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [notifyImperative, children, rowHeight],
  );

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight));
  const endScroll = scrollTop + viewportRows;
  const endIndex = Math.min(childArray.length, Math.ceil(endScroll / rowHeight));
  const visible = childArray.slice(startIndex, endIndex);

  return (
    <Box
      ref={containerRef}
      flexDirection="column"
      overflow="hidden"
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      height={height}
    >
      {visible}
    </Box>
  );
});
