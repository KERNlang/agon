import { describe, expect, it } from 'vitest';

import { buildPlanChromeSummary, streamFrameIntervalMs } from '../../packages/cli/src/generated/surfaces/app-views.js';
import { buildExecutionRailTimeline, buildPlanPhaseGauge } from '../../packages/cli/src/generated/surfaces/status.js';
import {
  buildGuardTelemetryView,
  buildHeartbeatSig,
  buildHeartbeatSuffix,
  buildCompactStatusTail,
  buildPriorityStatusLine,
  buildPriorityStatusSegments,
  cosmeticUiIntervalMs,
  formatTokenCostStatus,
  formatStatusLine,
  normalizeUiMotion,
  parseHeartbeatPhase,
} from '../../packages/cli/src/generated/surfaces/status-helpers.js';

describe('stable TUI motion and footer helpers', () => {
  it('defaults invalid motion values to the steady reduced policy', () => {
    expect(normalizeUiMotion(undefined)).toBe('reduced');
    expect(normalizeUiMotion('unexpected')).toBe('reduced');
    expect(normalizeUiMotion('FULL')).toBe('full');
    expect(normalizeUiMotion('off')).toBe('off');
  });

  it('bounds chat, detail, and tool stream repaint cadence', () => {
    expect(streamFrameIntervalMs('full', 'chat')).toBe(60);
    expect(streamFrameIntervalMs('reduced', 'chat')).toBe(100);
    expect(streamFrameIntervalMs('reduced', 'detail')).toBe(66);
    expect(streamFrameIntervalMs('reduced', 'tool')).toBe(75);
    expect(streamFrameIntervalMs('off', 'chat')).toBe(250);
  });

  it('pauses cosmetic clocks during typing/selection without changing the motion policy', () => {
    expect(cosmeticUiIntervalMs('full', true, false)).toBe(1000);
    expect(cosmeticUiIntervalMs('reduced', true, false)).toBe(5000);
    expect(cosmeticUiIntervalMs('reduced', true, true)).toBe(0);
    expect(cosmeticUiIntervalMs('full', false, false)).toBe(0);
    expect(cosmeticUiIntervalMs('off', true, false)).toBe(0);
  });

  it('builds a single-line metric tail without permanent shortcut noise', () => {
    const tail = buildCompactStatusTail({
      context: { pct: 15, source: 'estimate' },
      tokens: 240,
      messages: 4,
      cost: 'cost included in plan (api)',
      auto: true,
      telemetry: '● idle',
    });
    expect(tail).toBe(' · ctx ~15% · 0.2k tok · 4 msgs · cost included in plan (api) · AUTO · ● idle');
    expect(tail).not.toContain('\n');
    expect(tail).not.toContain('Ctrl+');
  });

  it('keeps context and cost ahead of location on narrow terminals', () => {
    const narrow = buildPriorityStatusLine({
      width: 40,
      cwd: '~/KERN/agon',
      branch: 'feature/very-long-render-stability-name',
      context: { pct: 15, source: 'estimate' },
      tokens: 240,
      messages: 4,
      cost: 'cost included in plan (api)',
      telemetry: '● idle',
    });
    expect(narrow).toContain('ctx ~15%');
    expect(narrow).toContain('cost included in plan (api)');
    expect(narrow.length).toBeLessThanOrEqual(40);
    expect(narrow).not.toContain('Ctrl+');
  });

  it('fills a wide footer with lower-priority location and counters', () => {
    const wide = buildPriorityStatusLine({
      width: 120,
      exploration: true,
      cwd: '~/KERN/agon',
      branch: 'main',
      context: { pct: 15 },
      tokens: 240,
      messages: 4,
      cost: 'cost included in plan (api)',
      auto: true,
      telemetry: '● idle',
    });
    expect(wide).toContain('ctx 15% · cost included in plan (api)');
    expect(wide).toContain('AUTO');
    expect(wide).toContain('[explore] ~/KERN/agon on main');
    expect(wide).toContain('0.2k tok · 4 msgs · ● idle');
    expect(wide.length).toBeLessThanOrEqual(120);
  });

  it('retains semantic segment identities so the colored footer can survive truncation', () => {
    const segments = buildPriorityStatusSegments({
      width: 120,
      exploration: true,
      cwd: '~/KERN/agon',
      branch: 'main',
      context: { pct: 15 },
      cost: 'cost included in plan (api)',
      auto: true,
      telemetry: '● idle',
    });
    expect(segments.map((segment) => segment.kind)).toEqual([
      'context', 'cost', 'auto', 'location', 'healthy',
    ]);
    expect(segments.find((segment) => segment.kind === 'location')?.text)
      .toBe('[explore] ~/KERN/agon on main');
    expect(segments.map((segment) => segment.text).join(' · '))
      .toBe(buildPriorityStatusLine({
        width: 120,
        exploration: true,
        cwd: '~/KERN/agon',
        branch: 'main',
        context: { pct: 15 },
        cost: 'cost included in plan (api)',
        auto: true,
        telemetry: '● idle',
      }));
  });
});

describe('formatTokenCostStatus', () => {
  it('identifies a flat-rate coding-plan API as plan usage, not CLI usage', () => {
    expect(formatTokenCostStatus(0, 0, true, false)).toBe('cost included in plan (api)');
  });

  it('keeps genuine CLI usage and mixed metered usage distinct', () => {
    expect(formatTokenCostStatus(0, 0.25, false, true)).toBe('cost not countable (cli)');
    expect(formatTokenCostStatus(1.25, 1.25, true, true)).toBe('$1.25 +plan api +cli');
  });
});

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

  it('evidence / confidence-escalation rows: FIRES surfaced, signal cells are placeholders (no fabricated 0% CER/PRV)', () => {
    const view = buildGuardTelemetryView({
      byEngineGuard: {
        claude: {
          // P1 GuardPipeline guards: cells carry only fires (+ unresolved/overhead),
          // no ceremony/prevented/whr/calibration split → no honest CER/PRV %.
          evidence: { ...emptyCell(), fires: 7, unresolved: 7 },
          'confidence-escalation': { ...emptyCell(), fires: 3, unresolved: 3 },
        },
      },
      byEngineTurns: {},
      lastUpdated: 'x',
    } as any);
    expect(view.visible).toBe(true);
    const ev = view.guardRows.find((r: any) => r.guardId === 'evidence');
    const ce = view.guardRows.find((r: any) => r.guardId === 'confidence-escalation');
    expect(ev).toBeDefined();
    expect(ce).toBeDefined();
    // FIRES is the one honest number these guards carry — it must surface.
    expect(ev!.fires).toBe(7);
    expect(ce!.fires).toBe(3);
    // Both signal cells are placeholders: '—' label + sentinel pct -1, NEVER a
    // misleading CER/PRV at 0%. The dashboard renders -1 as a dim '—'.
    expect(ev!.sig1Label).toBe('—');
    expect(ev!.sig1Pct).toBe(-1);
    expect(ev!.sig2Label).toBe('—');
    expect(ev!.sig2Pct).toBe(-1);
    expect(ce!.sig1Label).toBe('—');
    expect(ce!.sig1Pct).toBe(-1);
    expect(ce!.sig2Label).toBe('—');
    expect(ce!.sig2Pct).toBe(-1);
    // Crucially: NOT the grounded-write CER/PRV labels (the misleading 0% columns).
    expect(ev!.sig1Label).not.toBe('CER');
    expect(ev!.sig2Label).not.toBe('PRV');
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

describe('parseHeartbeatPhase', () => {
  it('PRESERVES the provider-wait subphase verb (no collapse to "thinking")', () => {
    // The actual spinner strings the brain emits (cesar/brain.kern) must each map
    // to their real verb so the heartbeat label never contradicts the activity line.
    expect(parseHeartbeatPhase('Cesar thinking…')).toEqual({ kind: 'waiting', names: [], wait: 'thinking' });
    expect(parseHeartbeatPhase('Cesar responding…')).toEqual({ kind: 'waiting', names: [], wait: 'responding' });
    expect(parseHeartbeatPhase('Cesar processing tool results…')).toEqual({ kind: 'waiting', names: [], wait: 'processing' });
    expect(parseHeartbeatPhase('Cesar processing repaired tool result…')).toEqual({ kind: 'waiting', names: [], wait: 'processing' });
    expect(parseHeartbeatPhase('Cesar executing…')).toEqual({ kind: 'waiting', names: [], wait: 'executing' });
    expect(parseHeartbeatPhase('Cesar grounding…')).toEqual({ kind: 'waiting', names: [], wait: 'grounding' });
    expect(parseHeartbeatPhase('Cesar building plan…')).toEqual({ kind: 'waiting', names: [], wait: 'planning' });
    expect(parseHeartbeatPhase('Cesar finishing the answer…')).toEqual({ kind: 'waiting', names: [], wait: 'finishing' });
    expect(parseHeartbeatPhase('Cesar thinking… 12s')).toEqual({ kind: 'waiting', names: [], wait: 'thinking' });
  });

  it('retrying is a provider-wait (NOT a tool) even though it names a tool', () => {
    // 'Cesar: retrying <tool> with corrected input…' is a wait, not an in-flight tool.
    expect(parseHeartbeatPhase('Cesar: retrying Read with corrected input…')).toEqual({ kind: 'waiting', names: [], wait: 'retrying' });
  });

  it('falls back to waiting/thinking on empty / unrecognized text', () => {
    expect(parseHeartbeatPhase('')).toEqual({ kind: 'waiting', names: [], wait: 'thinking' });
    expect(parseHeartbeatPhase(null)).toEqual({ kind: 'waiting', names: [], wait: 'thinking' });
    expect(parseHeartbeatPhase(undefined)).toEqual({ kind: 'waiting', names: [], wait: 'thinking' });
    expect(parseHeartbeatPhase('something else entirely')).toEqual({ kind: 'waiting', names: [], wait: 'thinking' });
  });

  it('parses a single named in-flight tool from the spinner text', () => {
    expect(parseHeartbeatPhase('Cesar: Read…')).toEqual({ kind: 'tools', names: ['Read'] });
    expect(parseHeartbeatPhase('Cesar: AgonBash…')).toEqual({ kind: 'tools', names: ['AgonBash'] });
  });

  it('parses N parallel tools from the "awaiting N tool results" phrase', () => {
    const phase = parseHeartbeatPhase('Cesar: awaiting 3 tool results…');
    expect(phase.kind).toBe('tools');
    expect(phase.names).toHaveLength(3);
  });
});

describe('buildHeartbeatSig', () => {
  // The strip resets the dead-air anchor whenever this fingerprint changes. The
  // Legacy/provider status text can carry an embedded elapsed counter
  // ('Cesar thinking… 4s' → '… 6s'; 'Cesar timed out after Ns'), so the
  // fingerprint MUST key off a normalized phase identity (parseHeartbeatPhase
  // output), NOT the raw message — otherwise the counter tick resets the anchor
  // on each counter change and the heartbeat suffix can never clear its 2s gate during a long
  // thinking wait (the feature's primary use case).

  it('is STABLE across volatile elapsed-counter messages (Cesar thinking… 4s → 6s)', () => {
    const sig4 = buildHeartbeatSig(parseHeartbeatPhase('Cesar thinking… 4s'), '', '', '');
    const sig6 = buildHeartbeatSig(parseHeartbeatPhase('Cesar thinking… 6s'), '', '', '');
    const sig30 = buildHeartbeatSig(parseHeartbeatPhase('Cesar thinking… 30s'), '', '', '');
    expect(sig4).toBe(sig6);
    expect(sig6).toBe(sig30);
  });

  it('is STABLE across the timeout-counter re-emit (Cesar timed out after Ns)', () => {
    // The timeout message also embeds a growing counter and has no 'Cesar:'
    // colon prefix → parses to waiting/thinking; must not tick-reset either.
    const a = buildHeartbeatSig(parseHeartbeatPhase('Cesar timed out after 300s'), '', '', '');
    const b = buildHeartbeatSig(parseHeartbeatPhase('Cesar timed out after 302s'), '', '', '');
    expect(a).toBe(b);
  });

  it('CHANGES across genuine phase transitions (thinking→responding→tools→different tools)', () => {
    const thinking = buildHeartbeatSig(parseHeartbeatPhase('Cesar thinking… 4s'), '', '', '');
    const responding = buildHeartbeatSig(parseHeartbeatPhase('Cesar responding…'), '', '', '');
    const oneTool = buildHeartbeatSig(parseHeartbeatPhase('Cesar: Read…'), '', '', '');
    const otherTool = buildHeartbeatSig(parseHeartbeatPhase('Cesar: Grep…'), '', '', '');
    const twoTools = buildHeartbeatSig(parseHeartbeatPhase('Cesar: awaiting 2 tool results…'), '', '', '');
    // every adjacent transition flips the fingerprint
    expect(thinking).not.toBe(responding);
    expect(responding).not.toBe(oneTool);
    expect(oneTool).not.toBe(otherTool);
    expect(otherTool).not.toBe(twoTools);
  });

  it('folds in engine / plan / stream signals (any change flips the fingerprint)', () => {
    const phase = parseHeartbeatPhase('Cesar thinking… 4s');
    const base = buildHeartbeatSig(phase, 'claude:building', 'running:1', 'foo');
    expect(buildHeartbeatSig(phase, 'claude:done', 'running:1', 'foo')).not.toBe(base);
    expect(buildHeartbeatSig(phase, 'claude:building', 'running:2', 'foo')).not.toBe(base);
    expect(buildHeartbeatSig(phase, 'claude:building', 'running:1', 'foobar')).not.toBe(base);
    // identical inputs → identical fingerprint (deterministic)
    expect(buildHeartbeatSig(phase, 'claude:building', 'running:1', 'foo')).toBe(base);
  });

  // Model the strip's exact anchor bookkeeping (status.kern): on a sig change OR
  // the uninitialized sentinel (at === 0), anchor := now; otherwise the anchor is
  // preserved. With the OLD raw-message fingerprint the sig changed every counter tick,
  // so `at` was reset to `now` each tick and elapsed never reached the gate. With
  // the normalized fingerprint the sig is stable, so the anchor holds. Real
  // `now`/`Date.now()` is never literally 0, so use a non-zero wall-clock base.
  const T0 = 1_700_000_000_000;

  it('END-TO-END: a long thinking wait clears the 2s gate (the bug this fixes)', () => {
    const ref = { sig: '', at: 0 };
    const advance = (msg: string, now: number) => {
      const sig = buildHeartbeatSig(parseHeartbeatPhase(msg), '', '', '');
      if (ref.sig !== sig || ref.at === 0) ref.at = now;
      ref.sig = sig;
      return buildHeartbeatSuffix(now, ref.at, parseHeartbeatPhase(msg), true);
    };
    // Simulate legacy counter-bearing messages at t=0,2,4,6,8s.
    expect(advance('Cesar thinking… 0s', T0)).toBeNull();        // gate not yet reached
    expect(advance('Cesar thinking… 2s', T0 + 2_000)).toBe('· thinking… 2s');
    expect(advance('Cesar thinking… 4s', T0 + 4_000)).toBe('· thinking… 4s');
    expect(advance('Cesar thinking… 6s', T0 + 6_000)).toBe('· thinking… 6s');
    expect(advance('Cesar thinking… 8s', T0 + 8_000)).toBe('· thinking… 8s');
    // The anchor was set ONCE (at t=0) and never reset by the counter ticks.
    expect(ref.at).toBe(T0);
  });

  it('END-TO-END: a genuine phase change DOES reset the anchor (restarts the gate)', () => {
    const ref = { sig: '', at: 0 };
    const advance = (msg: string, now: number) => {
      const sig = buildHeartbeatSig(parseHeartbeatPhase(msg), '', '', '');
      if (ref.sig !== sig || ref.at === 0) ref.at = now;
      ref.sig = sig;
      return buildHeartbeatSuffix(now, ref.at, parseHeartbeatPhase(msg), true);
    };
    advance('Cesar thinking… 0s', T0);
    expect(advance('Cesar thinking… 8s', T0 + 8_000)).toBe('· thinking… 8s');
    // Phase flips thinking→responding at t=9s → anchor resets to 9s → silent again.
    expect(advance('Cesar responding…', T0 + 9_000)).toBeNull();
    expect(ref.at).toBe(T0 + 9_000);
    // 2s after the transition the responding suffix appears.
    expect(advance('Cesar responding…', T0 + 11_000)).toBe('· responding… 2s');
  });
});

describe('buildHeartbeatSuffix', () => {
  const waiting = { kind: 'waiting' as const, names: [], wait: 'thinking' as const };
  const oneTool = { kind: 'tools' as const, names: ['Read'] };
  const multiTool = { kind: 'tools' as const, names: ['Read', 'Grep', 'Bash'] };

  it('returns null when the turn is inactive (no suffix, ticker stopped)', () => {
    expect(buildHeartbeatSuffix(10_000, 0, waiting, false)).toBeNull();
    // even with lots of elapsed time, an inactive turn shows nothing
    expect(buildHeartbeatSuffix(200_000, 0, oneTool, false)).toBeNull();
  });

  it('silent gate: returns null below 2s of dead air (no flicker on fast turns)', () => {
    expect(buildHeartbeatSuffix(1_000, 0, waiting, true)).toBeNull();
    expect(buildHeartbeatSuffix(1_999, 0, waiting, true)).toBeNull();
  });

  it('waiting label: "· thinking… Ns" once past the 2s gate', () => {
    expect(buildHeartbeatSuffix(2_000, 0, waiting, true)).toBe('· thinking… 2s');
    expect(buildHeartbeatSuffix(5_000, 0, waiting, true)).toBe('· thinking… 5s');
  });

  it('waiting label RENDERS THE PRESERVED VERB (no contradictory "thinking" while responding/processing/retrying)', () => {
    // The bug this guards: parseHeartbeatPhase collapsed every wait to thinking, so a
    // 'Cesar responding…' strip showed '… · thinking… 5s'. The verb must round-trip.
    expect(buildHeartbeatSuffix(5_000, 0, { kind: 'waiting', names: [], wait: 'responding' }, true)).toBe('· responding… 5s');
    expect(buildHeartbeatSuffix(5_000, 0, { kind: 'waiting', names: [], wait: 'processing' }, true)).toBe('· processing… 5s');
    expect(buildHeartbeatSuffix(5_000, 0, { kind: 'waiting', names: [], wait: 'retrying' }, true)).toBe('· retrying… 5s');
    expect(buildHeartbeatSuffix(5_000, 0, { kind: 'waiting', names: [], wait: 'grounding' }, true)).toBe('· grounding… 5s');
  });

  it('end-to-end: a "Cesar responding…" spinner yields a "responding" suffix, never "thinking"', () => {
    const phase = parseHeartbeatPhase('Cesar responding…');
    expect(buildHeartbeatSuffix(5_000, 0, phase, true)).toBe('· responding… 5s');
  });

  it('defaults to "thinking" when the waiting phase carries no verb', () => {
    expect(buildHeartbeatSuffix(5_000, 0, { kind: 'waiting', names: [] }, true)).toBe('· thinking… 5s');
  });

  it('single-tool label: "· running <tool>… Ns"', () => {
    expect(buildHeartbeatSuffix(4_000, 0, oneTool, true)).toBe('· running Read… 4s');
  });

  it('falls back to "running tool" when a single tool has no name', () => {
    expect(buildHeartbeatSuffix(3_000, 0, { kind: 'tools', names: [''] }, true)).toBe('· running tool… 3s');
  });

  it('multi-tool label: "· running N tools… Ns"', () => {
    expect(buildHeartbeatSuffix(6_000, 0, multiTool, true)).toBe('· running 3 tools… 6s');
  });

  it('caps the counter at 120s+ and appends the reassurance while capped (nit 6b)', () => {
    expect(buildHeartbeatSuffix(120_000, 0, waiting, true)).toBe(
      '· thinking… 120s+ · still working — engine not stalled',
    );
    // keeps ticking the label, never grows the counter past the cap, and the
    // reassurance is appended on EVERY tick while capped (not once) — nit 6b.
    expect(buildHeartbeatSuffix(300_000, 0, oneTool, true)).toBe(
      '· running Read… 120s+ · still working — engine not stalled',
    );
  });

  it('below the cap shows no reassurance suffix', () => {
    expect(buildHeartbeatSuffix(119_000, 0, waiting, true)).toBe('· thinking… 119s');
  });

  it('resets relative to lastEventAt (a meaningful event restarts the gate + counter)', () => {
    // 1s after the last event → still silent
    expect(buildHeartbeatSuffix(11_000, 10_000, waiting, true)).toBeNull();
    // 3s after the last event → shows 3s, not the wall-clock total
    expect(buildHeartbeatSuffix(13_000, 10_000, oneTool, true)).toBe('· running Read… 3s');
  });

  // codex 0.93: streamed text counts as a meaningful event. The strip folds a
  // stream-progress signal (streamSnippet) into the heartbeat fingerprint, so a
  // chunk advancing resets lastEventAt to `now`. This pure check models that
  // contract via buildHeartbeatSuffix: while text is streaming (last chunk just
  // arrived) the dead-air anchor is fresh, so the suffix stays SILENT under the
  // 2s gate instead of falsely reading 'thinking… Ns' during visible streaming.
  it('a fresh stream chunk keeps the suffix silent (no false "thinking" during streaming)', () => {
    // turn started 30s ago, but the last text chunk landed 0.5s ago (anchor reset
    // by the streamSnippet change) → under the 2s gate → silent, not '· thinking… 30s'.
    expect(buildHeartbeatSuffix(30_000, 29_500, waiting, true)).toBeNull();
    // a chunk 4s ago (stream stalled) → the suffix correctly shows dead air again.
    expect(buildHeartbeatSuffix(30_000, 26_000, waiting, true)).toBe('· thinking… 4s');
  });
});

// codex FIX 2: a JOBS-ONLY active strip (background tribunal/forge job running, no
// Cesar wait) has NO spinner and NO engine activity, so parseHeartbeatPhase(undefined)
// yields waiting/'thinking' and the strip used to append a misleading '· thinking… Ns'
// next to the job label. The call site (status.kern) now gates the heartbeat on a
// genuine wait — turnActive := isActive && (spinner present OR engines active) — so a
// jobs-only strip passes turnActive=false and buildHeartbeatSuffix suppresses the
// suffix; every genuine wait (spinner set, OR multi-engine forge/tribunal progress)
// is unchanged. This models that exact call-site gate.
describe('heartbeat call-site gate — jobs-only run suppresses the suffix (codex FIX 2)', () => {
  // Mirror status.kern's _hbGenuineWait + the suffix call.
  const genuineWait = (isActive: boolean, spinner: unknown, engines: unknown[] | null) =>
    isActive && (!!spinner || (Array.isArray(engines) && engines.length > 0));
  const suffixFor = (
    now: number,
    lastEventAt: number,
    spinnerMessage: string | null | undefined,
    isActive: boolean,
    spinner: unknown,
    engines: unknown[] | null,
  ) => buildHeartbeatSuffix(now, lastEventAt, parseHeartbeatPhase(spinnerMessage), genuineWait(isActive, spinner, engines));

  it('jobs-only active strip (no spinner, no engines) → NO heartbeat suffix even past the gate', () => {
    // 30s of "dead air" but it is a background job, not a Cesar wait → suppressed.
    expect(suffixFor(30_000, 0, undefined, true, null, null)).toBeNull();
    expect(suffixFor(30_000, 0, undefined, true, null, [])).toBeNull();
  });

  it('genuine wait WITH a spinner → heartbeat unchanged (suffix shows the wait verb)', () => {
    const spinner = { message: 'Cesar thinking…' };
    expect(suffixFor(5_000, 0, spinner.message, true, spinner, null)).toBe('· thinking… 5s');
  });

  it('genuine multi-engine wait (engines active, no spinner) → heartbeat shown', () => {
    // A forge/tribunal turn streams engine progress without a Cesar spinner; that IS
    // a genuine wait, so the suffix still renders (defaults to thinking with no verb).
    const engines = [{ id: 'claude', status: 'building' }];
    expect(suffixFor(5_000, 0, undefined, true, null, engines)).toBe('· thinking… 5s');
  });

  it('inactive strip → suppressed regardless (no spinner, no engines, no jobs)', () => {
    expect(suffixFor(30_000, 0, 'Cesar thinking…', false, { message: 'Cesar thinking…' }, null)).toBeNull();
  });
});
