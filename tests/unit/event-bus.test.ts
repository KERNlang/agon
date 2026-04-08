import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../packages/core/src/event-bus.js';

describe('EventBus', () => {
  it('emits events to registered listeners', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('test:event', handler);
    await bus.emit('test:event', { key: 'value' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].event).toBe('test:event');
    expect(handler.mock.calls[0][0].data.key).toBe('value');
  });

  it('runs pre-events sequentially', async () => {
    const bus = new EventBus();
    const order: number[] = [];
    bus.on('pre:test', async () => { order.push(1); await new Promise(r => setTimeout(r, 10)); });
    bus.on('pre:test', async () => { order.push(2); });
    await bus.emit('pre:test');
    expect(order).toEqual([1, 2]);
  });

  it('runs post-events in parallel', async () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.on('post:test', handler1);
    bus.on('post:test', handler2);
    await bus.emit('post:test');
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('respects priority ordering', async () => {
    const bus = new EventBus();
    const order: number[] = [];
    bus.on('pre:test', () => { order.push(2); }, 200);
    bus.on('pre:test', () => { order.push(1); }, 50);
    await bus.emit('pre:test');
    expect(order).toEqual([1, 2]);
  });

  it('off removes listener', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('test', handler);
    bus.off('test', handler);
    await bus.emit('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAll removes by source', async () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('test', h1, 100, 'ext-a');
    bus.on('test', h2, 100, 'ext-b');
    bus.removeAll('ext-a');
    await bus.emit('test');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('listenerCount returns correct count', () => {
    const bus = new EventBus();
    bus.on('a', () => {});
    bus.on('a', () => {});
    bus.on('b', () => {});
    expect(bus.listenerCount('a')).toBe(2);
    expect(bus.listenerCount('b')).toBe(1);
    expect(bus.listenerCount('c')).toBe(0);
  });

  it('handles listener errors without crashing', async () => {
    const bus = new EventBus();
    bus.on('pre:test', () => { throw new Error('boom'); });
    bus.on('pre:test', vi.fn());
    // Should not throw
    await bus.emit('pre:test');
  });

  it('includes timestamp in payload', async () => {
    const bus = new EventBus();
    let ts = 0;
    bus.on('test', (p) => { ts = p.timestamp; });
    const before = Date.now();
    await bus.emit('test');
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});
