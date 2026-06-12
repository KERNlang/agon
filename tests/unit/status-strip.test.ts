import { describe, expect, it } from 'vitest';

import { buildPlanChromeSummary } from '../../packages/cli/src/generated/surfaces/app-views.js';
import { buildExecutionRailTimeline, buildPlanPhaseGauge } from '../../packages/cli/src/generated/surfaces/status.js';
import { buildGuardTelemetryView, formatStatusLine } from '../../packages/cli/src/generated/surfaces/status-helpers.js';

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

describe('buildGuardTelemetryView', () => {
  const emptyCell = () => ({
    fires: 0, ceremony: 0, prevented: 0, redirected: 0, averted: 0,
    recovered: 0, stalled: 0, wouldHaveRecovered: 0, unresolved: 0, overheadMsTotal: 0,
  });

  it('hides (visible:false) when counters is null', () => {
    const view = buildGuardTelemetryView(null);
    expect(view.visible).toBe(false);
    expect(view.guardRows).toEqual([]);
    expect(view.engineRows).toEqual([]);
  });

  it('hides when counters has no cells and no turn aggregates', () => {
    const view = buildGuardTelemetryView({ byEngineGuard: {}, byEngineTurns: {}, lastUpdated: 'x' } as any);
    expect(view.visible).toBe(false);
  });

  it('grounded-write row: CER/PRV signal cells over resolved = ceremony + prevented, avg overhead over fires', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {
        claude: {
          'grounded-write': { ...emptyCell(), fires: 10, ceremony: 6, prevented: 2, overheadMsTotal: 400 },
        },
      },
      byEngineTurns: {},
      lastUpdated: 'x',
    } as any);
    expect(view.visible).toBe(true);
    expect(view.guardRows).toHaveLength(1);
    const g = view.guardRows[0];
    expect(g.engineId).toBe('claude');
    expect(g.guardId).toBe('grounded-write');
    expect(g.fires).toBe(10);
    // codex FIX 3c: generic per-guard signal cells. resolved = 8 → 6/8 = 75%, 2/8 = 25%.
    expect(g.sig1Label).toBe('CER');
    expect(g.sig1Pct).toBe(75);
    expect(g.sig2Label).toBe('PRV');
    expect(g.sig2Pct).toBe(25);
    // overhead 400ms / 10 fires = 40ms (avg over ALL fires, not resolved)
    expect(g.avgOverheadMs).toBe(40);
    // 8 resolved < minSample(20) → insufficient-data
    expect(g.recommendation).toBe('insufficient-data');
  });

  it('read-spin row: WHR/STL signal cells over resolved = whr + stalled + recovered (codex FIX 3c)', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {
        codex: {
          'read-spin': { ...emptyCell(), fires: 22, wouldHaveRecovered: 18, stalled: 2, recovered: 2, overheadMsTotal: 220 },
        },
      },
      byEngineTurns: {},
      lastUpdated: 'x',
    } as any);
    const g = view.guardRows[0];
    expect(g.guardId).toBe('read-spin');
    // resolved = 22 → whr 18/22 ≈ 82%, stalled 2/22 ≈ 9%
    expect(g.sig1Label).toBe('WHR');
    expect(g.sig1Pct).toBe(82);
    expect(g.sig2Label).toBe('STL');
    expect(g.sig2Pct).toBe(9);
    expect(g.avgOverheadMs).toBe(10); // 220/22
    // whr/resolved 0.82 > 0.5 with 22 ≥ minSample(20) → relax
    expect(g.recommendation).toBe('relax');
  });

  it('report-confidence row: HI-HIT/LO-HIT cells, overhead n/a (-1), recommendation insufficient-data (codex FIX 3c)', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {
        agy: {
          'report-confidence': {
            ...emptyCell(), fires: 10,
            highConfHit: 6, highConfMiss: 2, lowConfHit: 1, lowConfMiss: 1,
          },
        },
      },
      byEngineTurns: {},
      lastUpdated: 'x',
    } as any);
    const g = view.guardRows[0];
    expect(g.guardId).toBe('report-confidence');
    // HI-HIT = 6/(6+2) = 75%, LO-HIT = 1/(1+1) = 50%
    expect(g.sig1Label).toBe('HI-HIT');
    expect(g.sig1Pct).toBe(75);
    expect(g.sig2Label).toBe('LO-HIT');
    expect(g.sig2Pct).toBe(50);
    // No meaningful overhead for a self-report → -1 (renders 'n/a')
    expect(g.avgOverheadMs).toBe(-1);
    expect(g.recommendation).toBe('insufficient-data');
  });

  it('guards divide-by-zero: zero resolved → 0% signals and zero fires → 0ms overhead', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {
        codex: { 'read-spin': { ...emptyCell(), fires: 0 } },
      },
      byEngineTurns: {},
      lastUpdated: 'x',
    } as any);
    const g = view.guardRows[0];
    expect(g.sig1Pct).toBe(0);
    expect(g.sig2Pct).toBe(0);
    expect(g.avgOverheadMs).toBe(0);
  });

  it('passes through the relax recommendation for a mostly-ceremony, cheap, well-sampled cell', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {
        agy: {
          // resolved = 30 ≥ 20, ceremony/resolved = 28/30 > 0.7, avg overhead 10ms < 50
          'grounded-write': { ...emptyCell(), fires: 30, ceremony: 28, prevented: 2, overheadMsTotal: 300 },
        },
      },
      byEngineTurns: {},
      lastUpdated: 'x',
    } as any);
    expect(view.guardRows[0].recommendation).toBe('relax');
  });

  it('builds per-engine turn aggregates: parallel rate, avg round-trip, avg assemble', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {},
      byEngineTurns: {
        claude: {
          turns: 4, steps: 20, totalToolCalls: 50, parallelSteps: 5,
          assembleMsTotal: 800, roundTripMsTotal: 4000,
        },
      },
      lastUpdated: 'x',
    } as any);
    expect(view.visible).toBe(true);
    expect(view.engineRows).toHaveLength(1);
    const e = view.engineRows[0];
    expect(e.engineId).toBe('claude');
    expect(e.parallelRatePct).toBe(25); // 5/20
    expect(e.avgRoundTripMs).toBe(200); // 4000/20
    expect(e.avgAssembleMs).toBe(200);  // 800/4
  });

  it('guards turn-aggregate divide-by-zero (0 steps, 0 turns → 0)', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {},
      byEngineTurns: {
        codex: { turns: 0, steps: 0, totalToolCalls: 0, parallelSteps: 0, assembleMsTotal: 0, roundTripMsTotal: 0 },
      },
      lastUpdated: 'x',
    } as any);
    const e = view.engineRows[0];
    expect(e.parallelRatePct).toBe(0);
    expect(e.avgRoundTripMs).toBe(0);
    expect(e.avgAssembleMs).toBe(0);
  });

  it('orders engine×guard rows deterministically (engine then guard, alphabetical) for stable repaints', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {
        codex: { 'read-spin': { ...emptyCell(), fires: 1 } },
        agy: {
          'report-confidence': { ...emptyCell(), fires: 1 },
          'grounded-write': { ...emptyCell(), fires: 1 },
        },
      },
      byEngineTurns: {},
      lastUpdated: 'x',
    } as any);
    const keys = view.guardRows.map((r: any) => `${r.engineId}/${r.guardId}`);
    expect(keys).toEqual([
      'agy/grounded-write',
      'agy/report-confidence',
      'codex/read-spin',
    ]);
  });
});
