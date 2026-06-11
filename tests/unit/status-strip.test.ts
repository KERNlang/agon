import { describe, expect, it } from 'vitest';

import { buildPlanChromeSummary } from '../../packages/cli/src/generated/surfaces/app-views.js';
import { buildExecutionRailTimeline, buildPlanPhaseGauge } from '../../packages/cli/src/generated/surfaces/status.js';
import { formatStatusLine } from '../../packages/cli/src/generated/surfaces/status-helpers.js';

describe('buildPlanPhaseGauge', () => {
  it('shows the running step and completion percentage', () => {
    const gauge = buildPlanPhaseGauge({
      id: 'cplan-1777467535612-6e3ue9',
      state: 'running',
      steps: [
        { state: 'done', description: 'Write spec' },
        { state: 'running', description: 'Build telemetry dashboard primitives' },
        { state: 'pending', description: 'Wire status command' },
        { state: 'pending', description: 'Verify' },
      ],
    }, 8);

    expect(gauge.visible).toBe(true);
    expect(gauge.shortId).toBe('1777467535');
    expect(gauge.label).toBe('Step 2/4');
    expect(gauge.phase).toBe('executing');
    expect(gauge.pct).toBe(25);
    expect(gauge.done).toBe(1);
    expect(gauge.total).toBe(4);
    expect(gauge.current).toBe('Build telemetry dashboard primitives');
    expect(gauge.bar).toHaveLength(8);
  });

  it('shows paused failed steps as the current phase target', () => {
    const gauge = buildPlanPhaseGauge({
      id: 'cplan-paused',
      state: 'paused',
      steps: [
        { state: 'done', description: 'Spec' },
        { state: 'failed', description: 'Compile generated files' },
        { state: 'pending', description: 'Test' },
      ],
    }, 10);

    expect(gauge.label).toBe('Step 2/3');
    expect(gauge.phase).toBe('paused');
    expect(gauge.failed).toBe(1);
    expect(gauge.color).toBe('#ef4444');
    expect(gauge.current).toBe('Compile generated files');
  });

  it('normalizes stale paused plans with all steps done to complete', () => {
    const gauge = buildPlanPhaseGauge({
      id: 'cplan-paused-complete',
      state: 'paused',
      steps: [
        { state: 'done', description: 'Patch app' },
        { state: 'done', description: 'Verify' },
      ],
    }, 10);

    expect(gauge.label).toBe('Step 2/2');
    expect(gauge.phase).toBe('complete');
    expect(gauge.pct).toBe(100);
    expect(gauge.failed).toBe(0);
    expect(gauge.terminalComplete).toBe(true);
    expect(gauge.rawPhase).toBe('paused');
  });

  it('hides when there is no active plan with steps', () => {
    expect(buildPlanPhaseGauge(null).visible).toBe(false);
    expect(buildPlanPhaseGauge({ state: 'running', steps: [] }).visible).toBe(false);
  });
});

describe('buildPlanChromeSummary', () => {
  it('moves paused plan progress into the sticky chrome summary', () => {
    const summary = buildPlanChromeSummary({
      id: 'cplan-1777496797-abc',
      state: 'paused',
      steps: [
        { state: 'done', description: 'Inspect' },
        { state: 'failed', description: 'Verify mutating changes against intent' },
      ],
    }, 'paused', false, false);

    expect(summary.visible).toBe(true);
    expect(summary.label).toBe('paused');
    expect(summary.shortId).toBe('1777496797');
    expect(summary.stepLabel).toBe('Step 2/2');
    expect(summary.failed).toBe(1);
    expect(summary.action).toBe('/plan resume');
  });

  it('shows approval actions without an active plan gauge', () => {
    expect(buildPlanChromeSummary(null, 'awaiting_approval', false, false).action).toBe('go/yes');
    expect(buildPlanChromeSummary(null, null, false, true).visible).toBe(false);
  });
});

describe('formatStatusLine', () => {
  const parts = { engine: 'claude', model: 'opus', context: '42%', branch: 'feat/x', cwd: '/repo' };

  it('returns null when the status line is off (false / null / empty)', () => {
    expect(formatStatusLine(false, parts)).toBeNull();
    expect(formatStatusLine(null, parts)).toBeNull();
    expect(formatStatusLine(undefined, parts)).toBeNull();
    expect(formatStatusLine('', parts)).toBeNull();
  });

  it('renders the standard line for true / "default"', () => {
    expect(formatStatusLine(true, parts)).toBe('claude/opus · ctx 42% · feat/x');
    expect(formatStatusLine('default', parts)).toBe('claude/opus · ctx 42% · feat/x');
  });

  it('drops empty segments from the default line (engine only, no model/context/branch)', () => {
    expect(formatStatusLine('default', { engine: 'codex' })).toBe('codex');
    expect(formatStatusLine('default', { engine: 'codex', context: '10%' })).toBe('codex · ctx 10%');
  });

  it('substitutes each placeholder in a custom format string', () => {
    expect(
      formatStatusLine('{engine} | {model} | {context} | {branch} | {cwd}', parts),
    ).toBe('claude | opus | 42% | feat/x | /repo');
  });

  it('renders empty for a missing/failed value (e.g. git branch read failure) without crashing', () => {
    expect(formatStatusLine('[{branch}]', { engine: 'claude' })).toBe('[]');
    expect(formatStatusLine('default', { engine: 'claude', branch: '' })).toBe('claude');
  });

  it('passes unknown placeholders through literally', () => {
    expect(formatStatusLine('{engine} {bogus}', parts)).toBe('claude {bogus}');
  });
});

describe('buildExecutionRailTimeline', () => {
  it('surfaces current plan step, latest tool, and fallback context', () => {
    const rows = buildExecutionRailTimeline(
      {
        state: 'running',
        steps: [
          { state: 'done', description: 'Inspect' },
          { state: 'running', description: 'Patch fallback retry', engine: 'claude' },
          { state: 'pending', description: 'Verify' },
        ],
      },
      { tool: 'Edit', status: 'done', input: '{"file_path":"packages/cli/src/kern/surfaces/status.kern"}' },
      [{ id: 'claude', status: 'building' }],
      [{ from: 'claude', to: 'codex', reason: 'probe timeout > 30s', at: Date.now() }],
      6,
    );

    expect(rows.some((row: any) => row.label === '2/3 running')).toBe(true);
    expect(rows.some((row: any) => row.label === 'Edit done')).toBe(true);
    expect(rows.at(-1)?.label).toBe('claude -> codex');
  });
});
