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
});
