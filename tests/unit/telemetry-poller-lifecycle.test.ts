import { afterEach, expect, it, vi } from 'vitest';
import { EngineRegistry } from '../../packages/core/src/signals/engine-registry.js';
import { createTelemetryPoller } from '../../packages/cli/src/cesar/telemetry-poller.js';
import type { EngineVitals } from '../../packages/cli/src/cesar/telemetry.js';

afterEach(() => { vi.useRealTimers(); });

function registry() {
  const result = new EngineRegistry();
  for (const id of ['a', 'b']) result.register({ id, displayName: id, binary: 'node', timeout: 1, tier: 'user' } as any);
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('discards stopped probes before fallback, notification or state mutation', async () => {
  vi.useFakeTimers();
  const sample = deferred<Partial<EngineVitals>>();
  const fallback = vi.fn();
  const auto = vi.fn().mockResolvedValue(true);
  const poller = createTelemetryPoller({ registry: registry(), probe: () => sample.promise,
    onFallback: fallback, autoFallback: 'auto', onAutoFallback: auto, stallThresholdMs: 10 });
  const notify = vi.fn();
  poller.subscribe(notify);
  notify.mockClear();
  poller.start();
  poller.stop();
  sample.resolve({ state: 'busy', lastHeartbeatAt: Date.now() - 1000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(fallback).not.toHaveBeenCalled();
  expect(auto).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(poller.snapshot().size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('starts fresh probes immediately after stop and rejects late old results', async () => {
  vi.useFakeTimers();
  const old = deferred<Partial<EngineVitals>>();
  const fresh = deferred<Partial<EngineVitals>>();
  const probe = vi.fn().mockImplementationOnce(() => old.promise).mockImplementation(() => fresh.promise);
  const poller = createTelemetryPoller({ registry: registry(), activeEngineIds: () => ['a'], probe });
  poller.start();
  poller.stop();
  poller.start();
  expect(probe).toHaveBeenCalledTimes(2);
  fresh.resolve({ state: 'idle', latencyMs: 2 });
  await vi.advanceTimersByTimeAsync(0);
  old.resolve({ state: 'busy', latencyMs: 99 });
  await vi.advanceTimersByTimeAsync(0);
  expect(poller.getVitals('a')?.latencyMs).toBe(2);
  poller.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('releases pending timeout waits on stop even if the probe never settles', async () => {
  vi.useFakeTimers();
  const poller = createTelemetryPoller({ registry: registry(), probe: () => new Promise(() => {}), probeTimeoutMs: 10000 });
  const tick = poller.probeNow();
  poller.stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  await tick;
  expect(poller.snapshot().size).toBe(0);
});

it.each(['auto', 'ask'] as const)('ignores a pending %s approval after stop', async autoFallback => {
  vi.useFakeTimers();
  const approval = deferred<boolean>();
  const poller = createTelemetryPoller({ registry: registry(), autoFallback,
    probe: async id => ({ state: id === 'a' ? 'busy' : 'idle', lastHeartbeatAt: Date.now() - 1000 }),
    stallThresholdMs: 10, onAutoFallback: () => approval.promise });
  await poller.probeNow();
  const before = poller.snapshot();
  poller.stop();
  approval.resolve(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(poller.snapshot()).toEqual(before);
});

it('ignores an approval for a stall superseded by a healthy probe', async () => {
  vi.useFakeTimers();
  const approval = deferred<boolean>();
  let stalled = true;
  const poller = createTelemetryPoller({ registry: registry(), autoFallback: 'ask',
    probe: async id => ({ state: stalled && id === 'a' ? 'busy' : 'idle', lastHeartbeatAt: stalled ? Date.now() - 1000 : Date.now() }),
    stallThresholdMs: 10, onAutoFallback: () => approval.promise });
  await poller.probeNow();
  stalled = false;
  await poller.probeNow();
  approval.resolve(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(poller.getVitals('a')?.state).toBe('idle');
  expect(poller.getVitals('b')?.state).toBe('idle');
});

it('keeps an approval valid across repeated observations of the same stall', async () => {
  vi.useFakeTimers();
  const approval = deferred<boolean>();
  const accept = vi.fn(() => approval.promise);
  const poller = createTelemetryPoller({ registry: registry(), autoFallback: 'ask',
    probe: async id => ({ state: id === 'a' ? 'busy' : 'idle', lastHeartbeatAt: Date.now() - 1000 }),
    stallThresholdMs: 10, onAutoFallback: accept });
  await poller.probeNow();
  await poller.probeNow();
  approval.resolve(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(accept).toHaveBeenCalledOnce();
  expect(poller.getVitals('a')?.state).toBe('fallback');
  expect(poller.getVitals('b')?.state).toBe('busy');
});

it('does not let approval for an earlier stall authorize a later stall', async () => {
  vi.useFakeTimers();
  const first = deferred<boolean>();
  const second = deferred<boolean>();
  const accept = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  let stalled = true;
  const poller = createTelemetryPoller({ registry: registry(), autoFallback: 'ask',
    probe: async id => ({ state: stalled && id === 'a' ? 'busy' : 'idle', lastHeartbeatAt: stalled ? Date.now() - 1000 : Date.now() }),
    stallThresholdMs: 10, onAutoFallback: accept });
  await poller.probeNow();
  stalled = false;
  await poller.probeNow();
  stalled = true;
  await poller.probeNow();
  first.resolve(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(poller.getVitals('a')?.state).toBe('stalled');
  second.resolve(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(accept).toHaveBeenCalledTimes(2);
  expect(poller.getVitals('a')?.state).toBe('fallback');
});

it('requests fresh approval after restart instead of retaining a cancelled stall episode', async () => {
  vi.useFakeTimers();
  const old = deferred<boolean>();
  const accept = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(true);
  const poller = createTelemetryPoller({ registry: registry(), autoFallback: 'ask',
    probe: async id => ({ state: id === 'a' ? 'busy' : 'idle', lastHeartbeatAt: Date.now() - 1000 }),
    stallThresholdMs: 10, onAutoFallback: accept });
  await poller.probeNow();
  poller.stop();
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(accept).toHaveBeenCalledTimes(2);
  expect(poller.getVitals('a')?.state).toBe('fallback');
  poller.stop();
  old.resolve(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['auto', 'ask'] as const)('contains a rejected %s handoff without claiming success', async autoFallback => {
  vi.useFakeTimers();
  const poller = createTelemetryPoller({ registry: registry(), autoFallback,
    probe: async id => ({ state: id === 'a' ? 'busy' : 'idle', lastHeartbeatAt: Date.now() - 1000 }),
    stallThresholdMs: 10, onAutoFallback: async () => { throw new Error('fixture handoff failure'); } });
  await poller.probeNow();
  await vi.advanceTimersByTimeAsync(0);
  expect(poller.getVitals('a')?.state).toBe('stalled');
  expect(poller.getVitals('b')?.state).toBe('idle');
  expect(vi.getTimerCount()).toBe(0);
});
