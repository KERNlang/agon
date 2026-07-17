import { afterEach, describe, expect, it } from 'vitest';

// Source of truth: packages/cli/src/kern/cesar/steering.kern
// (regenerated via npm run kern:compile — do not edit the generated .ts by hand).
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
} from '../../packages/cli/src/generated/cesar/steering.js';

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
