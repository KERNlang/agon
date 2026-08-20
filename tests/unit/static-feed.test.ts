import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  archiveCountAfterPrefixDrop,
  absoluteSealedCount,
  sealedBoundaryFromAbsolute,
  padStaticFeed,
  effectiveNativeArchiveBlockCount,
  nativeArchiveBlockCount,
} from '../../packages/cli/src/surfaces/app-blocks.js';
import { appendBlockWithCap, transcriptDroppedTotal, resetTranscriptDroppedTotal } from '../../packages/cli/src/signals/block-archive.js';
import type { OutputBlock } from '../../packages/cli/src/blocks/engine.js';

/**
 * Model of Ink's <Static>: it prints `items.slice(index)` and then advances
 * `index` to `items.length` (see node_modules/ink/build/components/Static.js).
 */
function makeStaticCursor() {
  let index = 0;
  const printed: number[] = [];
  return {
    feed(items: (OutputBlock | null)[]) {
      for (const item of items.slice(index)) if (item) printed.push(item.id);
      index = items.length;
    },
    get printed() { return printed; },
  };
}

/** Drive a long transcript past the 500-block cap and record what <Static> printed. */
function runTranscript(opts: { pad: boolean; carryArchiveCount: boolean }): number[] {
  const dir = mkdtempSync(join(tmpdir(), 'agon-static-feed-'));
  const archivePath = join(dir, 'transcript.ndjson');
  try {
    resetTranscriptDroppedTotal();
    const cursor = makeStaticCursor();
    let blocks: OutputBlock[] = [];
    let archiveCount = 0;
    let seenDropped = 0;

    for (let id = 0; id < 900; id += 1) {
      blocks = appendBlockWithCap(blocks, { id, event: { type: 'info', message: `m${id}` } as any }, archivePath);
      const droppedTotal = transcriptDroppedTotal();
      const droppedNow = droppedTotal - seenDropped;
      const base = opts.carryArchiveCount
        ? archiveCountAfterPrefixDrop(archiveCount, droppedNow)
        : (droppedNow > 0 ? 0 : archiveCount);
      const target = nativeArchiveBlockCount(blocks, 'chat', 30, false, false);
      const effective = effectiveNativeArchiveBlockCount(blocks, base, target, false);
      const archived = blocks.slice(0, effective);
      cursor.feed(opts.pad ? padStaticFeed(archived, droppedTotal) : archived);
      seenDropped = droppedTotal;
      archiveCount = effective;
    }
    return cursor.printed;
  } finally {
    resetTranscriptDroppedTotal();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('archiveCountAfterPrefixDrop', () => {
  it('leaves the archive count alone when nothing was dropped', () => {
    expect(archiveCountAfterPrefixDrop(494, 0)).toBe(494);
    expect(archiveCountAfterPrefixDrop(494, -3)).toBe(494);
  });

  it('slides the sealed/live boundary down by exactly the dropped prefix', () => {
    expect(archiveCountAfterPrefixDrop(494, 101)).toBe(393);
  });

  it('never goes negative', () => {
    expect(archiveCountAfterPrefixDrop(5, 40)).toBe(0);
  });
});

describe('padStaticFeed', () => {
  const blocks = [1, 2, 3].map((id) => ({ id, event: { type: 'info', message: `m${id}` } })) as OutputBlock[];

  it('is identity when no prefix was dropped', () => {
    expect(padStaticFeed(blocks, 0)).toBe(blocks);
    expect(padStaticFeed(blocks, -2)).toBe(blocks);
  });

  it('holds one index slot per dropped block, ahead of the live archive', () => {
    const padded = padStaticFeed(blocks, 2);
    expect(padded).toHaveLength(5);
    expect(padded.slice(0, 2)).toEqual([null, null]);
    expect(padded.slice(2)).toEqual(blocks);
  });
});

describe('<Static> transcript feed across a cap-spill', () => {
  it('prints every completed block exactly once, in order', () => {
    const printed = runTranscript({ pad: true, carryArchiveCount: true });

    expect(new Set(printed).size).toBe(printed.length);
    // A contiguous ascending prefix: nothing swallowed, nothing reordered.
    expect(printed).toEqual(printed.map((_, index) => index));
    expect(printed.length).toBeGreaterThan(700);
  });

  it('regression: an unpadded feed loses completed blocks at the cap boundary', () => {
    const printed = runTranscript({ pad: false, carryArchiveCount: false });
    const contiguous = printed.every((id, index) => id === index);
    expect(contiguous).toBe(false);
  });
});

/**
 * Model of App's sealed/live boundary across one commit, including the window
 * that `__inkSafe` opens: EVERY setState in App is deferred by a `setTimeout(0)`,
 * while a ref assigned in the same effect lands synchronously. Any repaint that
 * happens between the effect commit and the deferred setState therefore sees a
 * ref that has already moved and a count that has not.
 *
 * `policy` is what the render uses to derive the boundary:
 *   'delta-from-ref' — subtract only the drop the committed ref has not seen yet.
 *   'absolute'       — keep the boundary in absolute (never-shifting) transcript
 *                      coordinates and project it onto the live array on read.
 */
type BoundaryFrame = { feedLength: number; firstLiveId: number | null };

function driveBoundary(policy: 'delta-from-ref' | 'absolute', repaintInDeferredWindow: boolean): { append: BoundaryFrame[]; all: BoundaryFrame[] } {
  const dir = mkdtempSync(join(tmpdir(), 'agon-static-window-'));
  const archivePath = join(dir, 'transcript.ndjson');
  try {
    resetTranscriptDroppedTotal();
    let blocks: OutputBlock[] = [];
    let archiveState = 0;         // useState: nativeArchiveCount / sealedAbsoluteCount
    let seenDroppedRef = 0;       // useRef: droppedPrefixRef.current
    let pending: number | null = null; // the __inkSafe-deferred setState payload
    const append: BoundaryFrame[] = [];
    const all: BoundaryFrame[] = [];

    const render = (): number => {
      const droppedTotal = transcriptDroppedTotal();
      const base = policy === 'absolute'
        ? sealedBoundaryFromAbsolute(archiveState, droppedTotal)
        : archiveCountAfterPrefixDrop(archiveState, droppedTotal - seenDroppedRef);
      const target = nativeArchiveBlockCount(blocks, 'chat', 30, false, false);
      const effective = effectiveNativeArchiveBlockCount(blocks, base, target, false);
      const frame: BoundaryFrame = {
        feedLength: padStaticFeed(blocks.slice(0, effective), droppedTotal).length,
        firstLiveId: blocks[effective]?.id ?? null,
      };
      all.push(frame);
      return effective;
    };
    const commitEffects = (effective: number): void => {
      const droppedTotal = transcriptDroppedTotal();
      // The count update is deferred; the ref lands now.
      pending = policy === 'absolute' ? absoluteSealedCount(effective, droppedTotal) : effective;
      seenDroppedRef = droppedTotal;
    };
    const flushDeferredState = (): void => {
      if (pending !== null) { archiveState = pending; pending = null; }
    };

    for (let id = 0; id < 900; id += 1) {
      blocks = appendBlockWithCap(blocks, { id, event: { type: 'info', message: `m${id}` } as any }, archivePath);
      commitEffects(render());
      append.push(all[all.length - 1]!);
      // An unrelated repaint (spinner tick, telemetry poll, stream chunk — every
      // one of them is its own deferred macrotask) lands here, BEFORE the count
      // setState queued above has been applied.
      if (repaintInDeferredWindow) commitEffects(render());
      flushDeferredState();
    }
    return { append, all };
  } finally {
    resetTranscriptDroppedTotal();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('sealed/live boundary inside the deferred-setState window', () => {
  it('an unrelated repaint neither moves the boundary nor changes what gets sealed', () => {
    const withRepaint = driveBoundary('absolute', true);
    const withoutRepaint = driveBoundary('absolute', false);

    // The repaint (frame 2n+1) must land on exactly the same split as the
    // append render (frame 2n) that preceded it: no block added, no block moved.
    for (let index = 1; index < withRepaint.all.length; index += 2) {
      expect(withRepaint.all[index]).toEqual(withRepaint.all[index - 1]);
    }
    // …and it must not perturb any later frame either.
    expect(withRepaint.append).toEqual(withoutRepaint.append);
  });

  it('regression: deriving the boundary from the effect-committed ref breaks in that window', () => {
    const withRepaint = driveBoundary('delta-from-ref', true);
    const withoutRepaint = driveBoundary('delta-from-ref', false);

    const movedFrames = withRepaint.all.filter(
      (frame, index) => index % 2 === 1 && JSON.stringify(frame) !== JSON.stringify(withRepaint.all[index - 1]),
    );
    // The stale count seals blocks that are still live: same blocks, longer feed.
    expect(movedFrames.length).toBeGreaterThan(0);
    expect(withRepaint.append).not.toEqual(withoutRepaint.append);
  });
});
