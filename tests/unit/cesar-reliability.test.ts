import { describe, expect, it } from 'vitest';

import {
  buildWhatHappenedSummary,
  mergeCesarTelemetryRecords,
  shouldDowngradeCesarToolWork,
  summarizeCesarLatency,
  summarizeCesarToolReliability,
} from '../../packages/cli/src/generated/cesar/reliability.js';

describe('Cesar tool reliability', () => {
  it('marks tool-heavy stalled engines as advisory-only', () => {
    const records = [
      { engineId: 'kimi', backend: 'api', recommendedFlow: 'plan-first', toolCount: 0, narratedToolStalls: 1 },
      { engineId: 'kimi', backend: 'api', recommendedFlow: 'bug-fix', toolCount: 0, narratedToolStalls: 1 },
      { engineId: 'kimi', backend: 'api', intakeKind: 'feature', toolCount: 0, narratedToolStalls: 1 },
    ];

    const summary = summarizeCesarToolReliability(records, 'kimi', 'api');

    expect(summary.label).toBe('advisory-only');
    expect(summary.toolHeavyTurns).toBe(3);
    expect(shouldDowngradeCesarToolWork(summary, 'feature', 'plan-first')).toBe(true);
  });

  it('marks engines with real tool turns as tool-capable', () => {
    const records = [
      { engineId: 'claude', backend: 'cli', recommendedFlow: 'bug-fix', toolCount: 2, toolsUsed: ['Read', 'Edit'], confidenceToolUsed: true, nativeToolCalls: 2 },
      { engineId: 'claude', backend: 'cli', recommendedFlow: 'quick-fix', toolCount: 1, toolsUsed: ['Read'], nativeToolCalls: 1 },
      { engineId: 'claude', backend: 'cli', intakeKind: 'chat', toolCount: 0 },
    ];

    const summary = summarizeCesarToolReliability(records, 'claude', 'cli');

    expect(summary.label).toBe('tool-capable');
    expect(summary.toolTurns).toBe(2);
    expect(summary.topTools).toContain('Read');
  });

  it('formats compact what-happened summaries', () => {
    const summary = buildWhatHappenedSummary({
      toolCount: 3,
      toolEventCount: 4,
      toolsUsed: ['Read', 'Read', 'Grep'],
      nativeToolCalls: 2,
      mcpToolCalls: 0,
      xmlToolCalls: 1,
      confidenceToolUsed: true,
      narratedToolStalls: 1,
    });

    expect(summary).toContain('What happened:');
    expect(summary).toContain('3 tools');
    expect(summary).toContain('Read x2');
    expect(summary).toContain('native/mcp/xml 2/0/1');
    expect(summary).toContain('confidence via tool');
  });

  it('merges legacy trace latency into one decision record', () => {
    const records = mergeCesarTelemetryRecords([
      { __source: 'trace', ts: '2026-07-13T10:00:00.000Z', engineId: 'claude', mode: 'self', inputLen: 42, durationMs: 1200, tokens: { prompt: 100 } },
      { __source: 'decisions', ts: '2026-07-13T10:00:01.000Z', engineId: 'claude', mode: 'self', inputLen: 42, recommendedFlow: 'answer' },
      { __source: 'decisions', ts: '2026-07-13T10:01:00.000Z', engineId: 'claude', mode: 'self', inputLen: 42, durationMs: 3000 },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ durationMs: 1200, recommendedFlow: 'answer', tokens: { prompt: 100 } });
    expect(records[0]).not.toHaveProperty('__source');
  });

  it('uses stable turn ids without collapsing distinct retries', () => {
    const records = mergeCesarTelemetryRecords([
      { __source: 'trace', ts: '2026-07-13T10:00:00.000Z', turnId: 'turn-a', engineId: 'claude', mode: 'self', inputLen: 42, durationMs: 1200 },
      { __source: 'decisions', ts: '2026-07-13T10:00:08.000Z', turnId: 'turn-a', engineId: 'claude', mode: 'self', inputLen: 42, recommendedFlow: 'answer' },
      { __source: 'trace', ts: '2026-07-13T10:00:09.000Z', turnId: 'turn-b', engineId: 'claude', mode: 'self', inputLen: 42, durationMs: 900 },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ turnId: 'turn-a', durationMs: 1200, recommendedFlow: 'answer' });
    expect(records[1]).toMatchObject({ turnId: 'turn-b', durationMs: 900 });
  });

  it('merges legacy writers even when configured and resolved engine ids differ', () => {
    const records = mergeCesarTelemetryRecords([
      { __source: 'trace', ts: '2026-06-11T10:00:00.000Z', engineId: 'claude', mode: 'self', inputLen: 18, durationMs: 700 },
      { __source: 'decisions', ts: '2026-06-11T10:00:01.000Z', engineId: 'acting-claude', mode: 'self', inputLen: 18, recommendedFlow: 'answer' },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ durationMs: 700, recommendedFlow: 'answer' });
  });

  it('summarizes one latency stream with p50, mean, and max', () => {
    expect(summarizeCesarLatency([
      { durationMs: 100 },
      { durationMs: 300 },
      { durationMs: 900 },
      { durationMs: 'invalid' },
    ])).toEqual({ count: 3, p50Ms: 300, meanMs: 433, maxMs: 900 });
  });
});
