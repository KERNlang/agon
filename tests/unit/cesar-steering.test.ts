import { afterEach, describe, expect, it } from 'vitest';

import {
  markSteeringTurn,
  pushSteering,
  drainSteering,
  peekSteeringCount,
  releaseSteeringTurn,
  drainLeftoverSteering,
  clearSteering,
  onSteeringChange,
  popSteering,
  hasPendingSteering,
  formatSteeringIntoSend,
} from '../../packages/cli/src/cesar/steering.js';

describe('Cesar steering buffer', () => {
  // The singleton is module-level and shared across tests in this process —
  // reset it after each test so cases stay independent (mirrors the real
  // interrupt/clear path).
  afterEach(() => {
    clearSteering();
  });

  describe('turn-scoping', () => {
    it('drops pushes when no turn is active', () => {
      expect(pushSteering('hello')).toBe(false);
      expect(peekSteeringCount()).toBe(0);
      expect(drainSteering('t1')).toEqual([]);
    });

    it('buffers only while a turn is active and stamps the active turn', () => {
      markSteeringTurn('t1');
      expect(pushSteering('first')).toBe(true);
      expect(peekSteeringCount()).toBe(1);
      expect(drainSteering('t1')).toEqual([{ input: 'first', images: undefined }]);
      // Consumed — nothing left.
      expect(peekSteeringCount()).toBe(0);
    });

    it('never lets a stale turn drain another turn\'s entries', () => {
      markSteeringTurn('t1');
      pushSteering('for-t1');
      // A new turn starts: marking it clears the old turn's buffer.
      markSteeringTurn('t2');
      expect(peekSteeringCount()).toBe(0);
      // Draining the OLD turn id returns nothing.
      expect(drainSteering('t1')).toEqual([]);
      pushSteering('for-t2');
      expect(drainSteering('t1')).toEqual([]);
      expect(drainSteering('t2')).toEqual([{ input: 'for-t2', images: undefined }]);
    });
  });

  describe('hasPendingSteering (the cooperative-yield peek)', () => {
    it('is false with no active turn and for a foreign turn id', () => {
      expect(hasPendingSteering('t1')).toBe(false);
      markSteeringTurn('t1');
      pushSteering('steer me');
      expect(hasPendingSteering('t2')).toBe(false);
      expect(hasPendingSteering('')).toBe(false);
    });

    it('is true once this turn owns a queued message, and NEVER consumes it', () => {
      markSteeringTurn('t1');
      expect(hasPendingSteering('t1')).toBe(false);
      pushSteering('stop reading, just patch it');
      expect(hasPendingSteering('t1')).toBe(true);
      // Repeated peeks are pure — the entry is still there for the real drain.
      expect(hasPendingSteering('t1')).toBe(true);
      expect(peekSteeringCount()).toBe(1);
      expect(drainSteering('t1')).toEqual([{ input: 'stop reading, just patch it', images: undefined }]);
      expect(hasPendingSteering('t1')).toBe(false);
    });

    it('goes false again after the turn is released or the queue cleared', () => {
      markSteeringTurn('t1');
      pushSteering('later');
      releaseSteeringTurn('t1');
      expect(hasPendingSteering('t1')).toBe(false);
      markSteeringTurn('t2');
      pushSteering('now');
      clearSteering();
      expect(hasPendingSteering('t2')).toBe(false);
    });
  });

  describe('formatSteeringIntoSend (steering is USER content, not guard feedback)', () => {
    it('frames every drained block as an explicit mid-turn user instruction', () => {
      const out = formatSteeringIntoSend('TOOL RESULT: 42 matches', ['stop reading', 'just patch it']);
      expect(out).toBe([
        'TOOL RESULT: 42 matches',
        '',
        '[User steering — injected mid-turn]',
        'stop reading',
        '',
        '[User steering — injected mid-turn]',
        'just patch it',
      ].join('\n'));
    });

    it('returns the steering alone when there is no carrier (the yield-to-deliver path)', () => {
      expect(formatSteeringIntoSend('', ['use the cached brief'])).toBe(
        '[User steering — injected mid-turn]\nuse the cached brief',
      );
    });

    it('leaves the carrier untouched when nothing meaningful was drained', () => {
      expect(formatSteeringIntoSend('carrier', [])).toBe('carrier');
      expect(formatSteeringIntoSend('carrier', ['   ', ''])).toBe('carrier');
      expect(formatSteeringIntoSend('carrier', undefined as unknown as string[])).toBe('carrier');
    });
  });

  // ── The drain path, end to end (agy B1) ──────────────────────────────────
  // What brain.ts's drainSteeringIntoSend does with the queue, driven against
  // the REAL steering singleton: pop this turn's entries, render + persist each
  // one and record one telemetry event per message from that message's own text,
  // collect the images, then frame the whole thing as user content. The review
  // claimed the per-message `text` was read outside its loop (a runtime
  // ReferenceError the moment steering drains); the structural counterpart of this
  // test lives in cesar-steering-yield-wiring.test.ts, which asserts the shape in
  // the brain module itself. This one pins the observable contract: one render,
  // one history append and one telemetry record per drained message — never a
  // record built from a stale or missing text.
  describe('drain → render → persist → frame (the brain\'s drainSteeringIntoSend contract)', () => {
    function drainIntoSend(turnId: string, carrier: string) {
      const rendered: string[] = [];
      const persisted: string[] = [];
      const telemetry: Array<{ text: string; images: number | undefined }> = [];
      const pending = drainSteering(turnId);
      if (pending.length === 0) return { message: carrier, rendered, persisted, telemetry, images: [] as string[] };
      const blocks: string[] = [];
      const drainedImages: string[] = [];
      for (const msg of pending) {
        const text = (msg.input ?? '').trim();
        for (const img of (msg.images ?? [])) {
          const p = (img as any)?.path;
          if (typeof p === 'string' && p) drainedImages.push(p);
        }
        if (!text) continue;
        rendered.push(text);
        persisted.push(text);
        blocks.push(text);
        telemetry.push({ text, images: drainedImages.length || undefined });
      }
      return {
        message: formatSteeringIntoSend(carrier, blocks),
        rendered,
        persisted,
        telemetry,
        images: drainedImages,
      };
    }

    it('renders, persists and records EVERY drained message once, from its own text', () => {
      markSteeringTurn('t1');
      pushSteering('  stop reading  ');
      pushSteering('just patch session.kern');
      const out = drainIntoSend('t1', 'TOOL RESULT: 42 matches');

      expect(out.rendered).toEqual(['stop reading', 'just patch session.kern']);
      expect(out.persisted).toEqual(['stop reading', 'just patch session.kern']);
      expect(out.telemetry).toEqual([
        { text: 'stop reading', images: undefined },
        { text: 'just patch session.kern', images: undefined },
      ]);
      expect(out.message).toContain('TOOL RESULT: 42 matches');
      expect(out.message).toContain('[User steering — injected mid-turn]\nstop reading');
      // Consumed: a second drain has nothing left (the queue entry is gone, which
      // is why every send site must forward what it drained).
      expect(drainSteering('t1')).toEqual([]);
    });

    it('carries images out of the drain and counts them in the record', () => {
      markSteeringTurn('t2');
      pushSteering('look at this', [{ path: '/tmp/a.png' }] as any);
      const out = drainIntoSend('t2', '');
      expect(out.images).toEqual(['/tmp/a.png']);
      expect(out.telemetry).toEqual([{ text: 'look at this', images: 1 }]);
      // No carrier: the steering IS the message (the yield-to-deliver path).
      expect(out.message).toBe('[User steering — injected mid-turn]\nlook at this');
    });

    it('skips a whitespace-only message but still harvests its attachment', () => {
      markSteeringTurn('t3');
      pushSteering('   ', [{ path: '/tmp/b.png' }] as any);
      const out = drainIntoSend('t3', 'carrier');
      expect(out.rendered).toEqual([]);
      expect(out.telemetry).toEqual([]);
      expect(out.images).toEqual(['/tmp/b.png']);
      expect(out.message).toBe('carrier');
    });

    it('leaves the carrier alone when the queue is empty', () => {
      markSteeringTurn('t4');
      const out = drainIntoSend('t4', 'carrier');
      expect(out.message).toBe('carrier');
      expect(out.telemetry).toEqual([]);
    });
  });

  describe('FIFO ordering', () => {
    it('drains multiple messages in submit order', () => {
      markSteeringTurn('t1');
      pushSteering('one');
      pushSteering('two');
      pushSteering('three');
      expect(peekSteeringCount()).toBe(3);
      expect(drainSteering('t1').map((m) => m.input)).toEqual(['one', 'two', 'three']);
    });

    it('preserves images alongside the message', () => {
      markSteeringTurn('t1');
      const img = [{ path: '/tmp/a.png' }] as any;
      pushSteering('look', img);
      expect(drainSteering('t1')).toEqual([{ input: 'look', images: img }]);
    });
  });

  describe('normal turn end (release + leftover drain)', () => {
    it('releaseSteeringTurn clears the marker but keeps unconsumed entries', () => {
      markSteeringTurn('t1');
      pushSteering('leftover');
      releaseSteeringTurn('t1');
      // Marker cleared: a new push is dropped.
      expect(pushSteering('after')).toBe(false);
      // But the leftover survives for the app-side idle drain.
      expect(drainLeftoverSteering().map((m) => m.input)).toEqual(['leftover']);
    });

    it('releaseSteeringTurn is a no-op for a turn it does not own', () => {
      markSteeringTurn('t1');
      releaseSteeringTurn('t2'); // different turn — must not release t1
      expect(pushSteering('still-active')).toBe(true);
      expect(peekSteeringCount()).toBe(1);
    });

    it('drainLeftoverSteering returns ALL entries (any turn) and empties the buffer', () => {
      markSteeringTurn('t1');
      pushSteering('a');
      pushSteering('b');
      releaseSteeringTurn('t1');
      const left = drainLeftoverSteering();
      expect(left.map((m) => m.input)).toEqual(['a', 'b']);
      expect(drainLeftoverSteering()).toEqual([]);
    });

    // phase-A review finding 2: a steering message that referenced an image must
    // keep that image when it is NOT consumed mid-turn and falls through to the
    // app-side idle leftover-drain → inputQueue → next handleSubmit path (which is
    // the path that actually re-attaches the image to the next turn). Asserts the
    // images survive the release+leftover hop, not just the message text.
    it('drainLeftoverSteering preserves image attachments on unconsumed steering', () => {
      markSteeringTurn('t1');
      const img = [{ path: '/tmp/shot.png' }] as any;
      pushSteering('see this', img);
      releaseSteeringTurn('t1');
      expect(drainLeftoverSteering()).toEqual([{ input: 'see this', images: img }]);
    });
  });

  describe('interrupt (clear / drop)', () => {
    it('clearSteering drops everything and releases the marker — no carryover', () => {
      markSteeringTurn('t1');
      pushSteering('dropped');
      clearSteering();
      expect(peekSteeringCount()).toBe(0);
      expect(drainLeftoverSteering()).toEqual([]);
      // Marker released: pushes are dropped until a new turn is marked.
      expect(pushSteering('after-interrupt')).toBe(false);
    });
  });

  describe('onSteeringChange (count-change notification — UI mirror)', () => {
    it('fires with the active-turn count on push and on (mid-turn) drain', () => {
      const counts: number[] = [];
      const off = onSteeringChange((n) => counts.push(n));
      markSteeringTurn('t1');
      counts.length = 0; // ignore the mark notification; focus on push/drain
      pushSteering('a');
      pushSteering('b');
      // Each push notifies with the running count.
      expect(counts).toEqual([1, 2]);
      // Mid-turn drain (what the brain does) must notify so the hint clears —
      // this is the stale-hint fix: the count drops to 0 on drain, not on idle.
      const drained = drainSteering('t1').map((m) => m.input);
      expect(drained).toEqual(['a', 'b']);
      expect(counts[counts.length - 1]).toBe(0);
      off();
    });

    it('fires on clearSteering (count → 0)', () => {
      const counts: number[] = [];
      markSteeringTurn('t1');
      pushSteering('x');
      const off = onSteeringChange((n) => counts.push(n));
      clearSteering();
      expect(counts[counts.length - 1]).toBe(0);
      off();
    });

    it('fires on releaseSteeringTurn — active count reads 0 once the marker is gone', () => {
      const counts: number[] = [];
      markSteeringTurn('t1');
      pushSteering('leftover');
      const off = onSteeringChange((n) => counts.push(n));
      releaseSteeringTurn('t1');
      // peekSteeringCount returns 0 when no turn is active, so the mirror is 0
      // even though a leftover entry survives for the idle drain.
      expect(counts[counts.length - 1]).toBe(0);
      expect(drainLeftoverSteering().map((m) => m.input)).toEqual(['leftover']);
      off();
    });

    it('unsubscribe stops further notifications', () => {
      const counts: number[] = [];
      const off = onSteeringChange((n) => counts.push(n));
      markSteeringTurn('t1');
      pushSteering('one');
      const seen = counts.length;
      off();
      pushSteering('two');
      // No new notifications after unsubscribe.
      expect(counts.length).toBe(seen);
    });

    it('a throwing listener does not break steering or other listeners', () => {
      const ok: number[] = [];
      const offBad = onSteeringChange(() => { throw new Error('boom'); });
      const offOk = onSteeringChange((n) => ok.push(n));
      markSteeringTurn('t1');
      // Push must still succeed and the well-behaved listener must still fire.
      expect(pushSteering('survives')).toBe(true);
      expect(ok[ok.length - 1]).toBe(1);
      offBad();
      offOk();
    });
  });

  describe('popSteering (↑ edit/remove affordance)', () => {
    it('pops the NEWEST entry of the active turn and removes it from the queue', () => {
      markSteeringTurn('t1');
      pushSteering('first');
      pushSteering('second');
      expect(popSteering()).toEqual({ input: 'second', images: undefined });
      expect(peekSteeringCount()).toBe(1);
      // The remaining entry still drains normally.
      expect(drainSteering('t1')).toEqual([{ input: 'first', images: undefined }]);
    });

    it('returns null when no turn is active or the queue is empty', () => {
      expect(popSteering()).toBeNull();
      markSteeringTurn('t1');
      expect(popSteering()).toBeNull();
    });

    it('notifies listeners so the queued banner updates on pop', () => {
      markSteeringTurn('t1');
      pushSteering('msg');
      const counts: number[] = [];
      const off = onSteeringChange((n) => counts.push(n));
      popSteering();
      off();
      expect(counts[counts.length - 1]).toBe(0);
    });

    it('carries images back with the popped entry', () => {
      markSteeringTurn('t1');
      const img = { path: '/tmp/a.png', filename: 'a.png', mimeType: 'image/png' };
      pushSteering('look at this', [img]);
      expect(popSteering()).toEqual({ input: 'look at this', images: [img] });
    });
  });
});
