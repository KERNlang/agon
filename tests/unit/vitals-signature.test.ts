import { describe, expect, it } from 'vitest';

import { vitalsRenderSignature } from '../../packages/cli/src/generated/cesar/telemetry.js';
import type { EngineVitals } from '../../packages/cli/src/generated/cesar/telemetry.js';

function vitals(partial: Partial<EngineVitals> & { engineId: string }): EngineVitals {
  return {
    state: 'idle',
    lastHeartbeatAt: 1_000,
    ...partial,
  } as EngineVitals;
}

describe('vitalsRenderSignature', () => {
  it('ignores volatile fields that do not change what is rendered', () => {
    const a = [vitals({ engineId: 'claude', lastHeartbeatAt: 1_000, latencyMs: 12, cpuPercent: 0.4, memPercent: 1.2 })];
    const b = [vitals({ engineId: 'claude', lastHeartbeatAt: 6_000, latencyMs: 48, cpuPercent: 1.1, memPercent: 1.9 })];
    expect(vitalsRenderSignature(a)).toBe(vitalsRenderSignature(b));
  });

  it('changes when an engine state changes', () => {
    const idle = [vitals({ engineId: 'claude', state: 'idle' })];
    const busy = [vitals({ engineId: 'claude', state: 'busy' })];
    expect(vitalsRenderSignature(idle)).not.toBe(vitalsRenderSignature(busy));
  });

  it('changes when latency crosses a health band', () => {
    const fast = [vitals({ engineId: 'claude', latencyMs: 90 })];
    const slow = [vitals({ engineId: 'claude', latencyMs: 900 })];
    expect(vitalsRenderSignature(fast)).toBe(vitalsRenderSignature([vitals({ engineId: 'claude', latencyMs: 5 })]));
    expect(vitalsRenderSignature(fast)).not.toBe(vitalsRenderSignature(slow));
  });

  it('changes on fallback / task / network transitions', () => {
    const base = [vitals({ engineId: 'codex' })];
    expect(vitalsRenderSignature(base)).not.toBe(vitalsRenderSignature([vitals({ engineId: 'codex', fallbackTo: 'claude' })]));
    expect(vitalsRenderSignature(base)).not.toBe(vitalsRenderSignature([vitals({ engineId: 'codex', task: 'forge' })]));
    expect(vitalsRenderSignature(base)).not.toBe(vitalsRenderSignature([vitals({ engineId: 'codex', network: 'degraded' })]));
  });

  it('is order-independent across engines', () => {
    const a = vitals({ engineId: 'a-engine' });
    const b = vitals({ engineId: 'b-engine', state: 'busy' });
    expect(vitalsRenderSignature([a, b])).toBe(vitalsRenderSignature([b, a]));
  });

  it('changes when an engine appears or disappears', () => {
    const one = [vitals({ engineId: 'claude' })];
    const two = [vitals({ engineId: 'claude' }), vitals({ engineId: 'codex' })];
    expect(vitalsRenderSignature(one)).not.toBe(vitalsRenderSignature(two));
  });
});
