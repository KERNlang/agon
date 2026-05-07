import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import { createMockStallProbe, createTelemetryPoller } from '../../packages/cli/src/generated/cesar/telemetry-poller.js';

function makeRegistry(): EngineRegistry {
  const registry = new EngineRegistry();
  registry.register({ id: 'mock-a', displayName: 'Mock A', binary: 'node', timeout: 1, tier: 'user' } as any);
  registry.register({ id: 'mock-b', displayName: 'Mock B', binary: 'node', timeout: 1, tier: 'user' } as any);
  return registry;
}

describe('TelemetryPoller fallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out a stalled mock engine and auto-selects a fallback candidate', async () => {
    vi.useFakeTimers();
    const fallbacks: Array<{ from: string; to: string; reason: string }> = [];
    const poller = createTelemetryPoller({
      registry: makeRegistry(),
      probe: createMockStallProbe('mock-a', 100),
      stallThresholdMs: 10,
      probeTimeoutMs: 10,
      autoFallback: 'auto',
      onAutoFallback: async (from, to, reason) => {
        fallbacks.push({ from, to, reason });
        return true;
      },
    });

    const run = poller.probeNow();
    await vi.advanceTimersByTimeAsync(11);
    await run;

    const snapshot = poller.snapshot();
    expect(fallbacks).toEqual([{ from: 'mock-a', to: 'mock-b', reason: 'probe timeout > 10ms' }]);
    expect(snapshot.get('mock-a')?.state).toBe('fallback');
    expect(snapshot.get('mock-a')?.fallbackTo).toBe('mock-b');
    expect(snapshot.get('mock-b')?.state).toBe('busy');

    poller.stop();
    await vi.runOnlyPendingTimersAsync();
  });

  it('clears probe timeout timers when probes resolve before timeout', async () => {
    vi.useFakeTimers();
    const poller = createTelemetryPoller({
      registry: makeRegistry(),
      probe: async (engineId) => ({
        engineId,
        state: 'idle' as const,
        lastHeartbeatAt: Date.now(),
      }),
      probeTimeoutMs: 1000,
    });

    await poller.probeNow();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not schedule catch-up timers for one-shot probes on a stopped poller', async () => {
    vi.useFakeTimers();
    const poller = createTelemetryPoller({
      registry: makeRegistry(),
      probe: async (engineId) => ({
        engineId,
        state: 'busy' as const,
        task: 'stale',
        lastHeartbeatAt: Date.now() - 1000,
      }),
      stallThresholdMs: 10,
      probeTimeoutMs: 1000,
    });

    await poller.probeNow();

    expect(poller.snapshot().get('mock-a')?.state).toBe('stalled');
    expect(vi.getTimerCount()).toBe(0);
  });
});
