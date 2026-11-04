import { afterEach, expect, it, vi } from 'vitest';
import { EngineRegistry } from '../../packages/core/src/signals/engine-registry.js';
import { markEngineStalled } from '../../packages/cli/src/cesar/telemetry.js';
import { createTelemetryService } from '../../packages/cli/src/signals/telemetry-service.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(['idle', 'offline'] as const)('does not turn an old %s heartbeat into a work stall', state => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  expect(markEngineStalled({ engineId: 'fixture', state, lastHeartbeatAt: 0 }, 50).state).toBe(state);
});

it('does not borrow the host PID and gives newly assigned work its own heartbeat window', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const registry = new EngineRegistry();
  registry.register({ id: 'fixture', displayName: 'Fixture', timeout: 1, tier: 'user', exec: { args: [] }, review: { args: [] } } as any);
  let active = false;
  const service = createTelemetryService({ registry, __test: true, stallThresholdMs: 50,
    getProgressEngines: () => active ? [{ id: 'fixture', status: 'running' }] : [] });
  const loadPidusage = vi.spyOn(service as any, 'loadPidusage').mockResolvedValue(vi.fn().mockResolvedValue({ cpu: 0, memory: 1 }));
  vi.spyOn(service as any, 'sampleNetwork').mockResolvedValue({ network: 'unreachable', latencyMs: 1 });
  await vi.advanceTimersByTimeAsync(5000);
  expect((await service.probeNow()).engines[0]?.state).toBe('idle');
  active = true;
  expect((await service.probeNow()).engines[0]?.state).toBe('busy');
  expect(loadPidusage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(49);
  expect((await service.probeNow()).engines[0]?.state).toBe('busy');
  await vi.advanceTimersByTimeAsync(1);
  expect((await service.probeNow()).engines[0]?.state).toBe('stalled');
  active = false;
  expect((await service.probeNow()).engines[0]?.state).toBe('idle');
});

it('retains heartbeat sampling for an explicitly mapped engine PID', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const registry = new EngineRegistry();
  registry.register({ id: 'fixture', displayName: 'Fixture', timeout: 1, tier: 'user', exec: { args: [] }, review: { args: [] } } as any);
  const service = createTelemetryService({ registry, __test: true, stallThresholdMs: 50,
    getProgressEngines: () => [{ id: 'fixture', status: 'running' }],
    getActiveEnginePids: () => new Map([['fixture', 1234]]) });
  const sample = vi.fn().mockResolvedValue({ cpu: 2, memory: 1024 });
  vi.spyOn(service as any, 'loadPidusage').mockResolvedValue(sample);
  vi.spyOn(service as any, 'sampleNetwork').mockResolvedValue({ network: 'unreachable', latencyMs: 1 });
  await vi.advanceTimersByTimeAsync(5000);
  expect((await service.probeNow()).engines[0]?.state).toBe('busy');
  expect(sample).toHaveBeenCalledWith(1234);
});
