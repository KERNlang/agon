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
});
