import { describe, expect, it } from 'vitest';

import {
  buildWhatHappenedSummary,
  shouldDowngradeCesarToolWork,
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
});
