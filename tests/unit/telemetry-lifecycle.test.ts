import { afterEach, expect, it, vi } from 'vitest';
import { EngineRegistry } from '../../packages/core/src/signals/engine-registry.js';
import { createTelemetryService } from '../../packages/cli/src/signals/telemetry-service.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers();
  const registry = new EngineRegistry();
  registry.register({ id: 'fixture', displayName: 'Fixture', timeout: 1, tier: 'user', exec: { args: [] }, review: { args: [] } } as any);
  const emit = vi.fn().mockResolvedValue(undefined);
  const service = createTelemetryService({ registry, eventBus: { emit } as any, __test: true, sampleIntervalMs: 100 });
  const pending: Array<(value: { network: 'healthy'; latencyMs: number }) => void> = [];
  const network = vi.spyOn(service as any, 'sampleNetwork').mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const subscriber = vi.fn();
  service.subscribe(subscriber);
  subscriber.mockClear();
  return { service, emit, pending, network, subscriber };
}

it('discards an in-flight background probe after stop, including events', async () => {
  const { service, emit, pending, subscriber } = fixture();
  const before = service.getSnapshot();
  service.start();
  await vi.advanceTimersByTimeAsync(0);
  service.stop();
  pending[0]!({ network: 'healthy', latencyMs: 17 });
  await vi.advanceTimersByTimeAsync(0);
  expect(emit).not.toHaveBeenCalled();
  expect(subscriber).not.toHaveBeenCalled();
  expect(service.getSnapshot()).toEqual(before);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not let a retired sampler overwrite or continue alongside its replacement', async () => {
  const { service, pending, network, subscriber } = fixture();
  service.start();
  await vi.advanceTimersByTimeAsync(0);
  service.stop();
  service.start();
  await vi.advanceTimersByTimeAsync(0);
  pending[1]!({ network: 'healthy', latencyMs: 2 });
  await vi.advanceTimersByTimeAsync(0);
  pending[0]!({ network: 'healthy', latencyMs: 99 });
  await vi.advanceTimersByTimeAsync(0);
  expect(service.getSnapshot().engines[0]?.latencyMs).toBe(2);
  expect(subscriber).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(network).toHaveBeenCalledTimes(3);
  service.stop();
  pending[2]!({ network: 'healthy', latencyMs: 3 });
  await vi.advanceTimersByTimeAsync(0);
});

it('allows an explicit one-shot probe while stopped', async () => {
  const { service, pending, emit, subscriber } = fixture();
  service.stop();
  const probe = service.probeNow();
  await vi.advanceTimersByTimeAsync(0);
  pending[0]!({ network: 'healthy', latencyMs: 7 });
  expect((await probe).engines[0]?.latencyMs).toBe(7);
  expect(emit).toHaveBeenCalledOnce();
  expect(subscriber).toHaveBeenCalledOnce();
  expect(service.isRunning()).toBe(false);
});

it('does not begin a network probe when stopped during PID sampling', async () => {
  const { service, network, emit, subscriber } = fixture();
  let finish!: (value: { ok: boolean }) => void;
  vi.spyOn(service as any, 'readPidusage').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  service.start();
  service.stop();
  finish({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(network).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(subscriber).not.toHaveBeenCalled();
});

it('clears a sleeping sampler immediately and makes repeated start idempotent', async () => {
  const { service, pending, network } = fixture();
  service.start();
  service.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(network).toHaveBeenCalledOnce();
  pending[0]!({ network: 'healthy', latencyMs: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(network).toHaveBeenCalledOnce();
  expect(service.isRunning()).toBe(false);
});
