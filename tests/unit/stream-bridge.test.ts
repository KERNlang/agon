import { describe, it, expect } from 'vitest';
import { StreamBridge } from '../../packages/core/src/cesar/stream-bridge.js';
import type { AgentEvent } from '../../packages/core/src/models/agent-event.js';

// Pins the engine-switch edge detector: a switch event is emitted exactly
// when the incoming engineId DIFFERS from the active one — never on a repeat
// of the same engine (that would spam the transcript with phantom handoffs).

function collect(opts?: { initialEngineId?: string }) {
  const events: Array<Record<string, unknown>> = [];
  const bridge = new StreamBridge((e) => events.push(e), opts);
  return { events, bridge, switches: () => events.filter((e) => e.type === 'engine-switch') };
}

const chunk = (engineId: string, text: string): AgentEvent => ({ kind: 'assistant_chunk', engineId, text });

describe('StreamBridge engine-switch detection', () => {
  it('emits one switch for the first engine seen, then none while it stays active', () => {
    const { bridge, switches } = collect();
    bridge.bridge(chunk('claude', 'a'));
    bridge.bridge(chunk('claude', 'b'));
    bridge.bridge(chunk('claude', 'c'));
    expect(switches()).toHaveLength(1);
    expect(switches()[0]).toMatchObject({ from: undefined, to: 'claude', reason: 'cesar-route' });
  });

  it('emits a switch when the engine actually changes', () => {
    const { bridge, switches } = collect();
    bridge.bridge(chunk('claude', 'a'));
    bridge.bridge(chunk('codex', 'b'));
    expect(switches()).toHaveLength(2);
    expect(switches()[1]).toMatchObject({ from: 'claude', to: 'codex', reason: 'team-member' });
  });

  it('emits NO switch when an event repeats the pre-seeded initial engine', () => {
    const { bridge, switches } = collect({ initialEngineId: 'claude' });
    bridge.bridge(chunk('claude', 'a'));
    bridge.bridge(chunk('claude', 'b'));
    expect(switches()).toHaveLength(0);
  });

  it('notifies the onSwitch callback exactly once per real switch', () => {
    const seen: string[] = [];
    const bridge = new StreamBridge(() => {}, { initialEngineId: 'claude', onSwitch: (sw) => seen.push(`${sw.from}->${sw.to}`) });
    bridge.bridge(chunk('claude', 'a'));
    bridge.bridge(chunk('codex', 'b'));
    bridge.bridge(chunk('codex', 'c'));
    expect(seen).toEqual(['claude->codex']);
  });

  it('still converts the payload of a same-engine event', () => {
    const { bridge, events } = collect({ initialEngineId: 'claude' });
    bridge.bridge(chunk('claude', 'hello'));
    expect(events).toEqual([{ type: 'streaming-chunk', engineId: 'claude', chunk: 'hello' }]);
  });
});
