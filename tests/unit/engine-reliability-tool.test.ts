import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEngineReliabilityTool } from '../../packages/cli/src/generated/cesar/tool-engine-reliability.js';
import { recordApiLoopDispatch, recordTextTransportDispatch } from '../../packages/core/src/generated/signals/delegate-ledger.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

const ctx = { cwd: process.cwd(), readFileState: new Map() } as any;

describe('EngineReliability tool', () => {
  it('exposes a read-only, concurrency-safe definition', () => {
    const tool = createEngineReliabilityTool();
    expect(tool.definition.name).toBe('EngineReliability');
    expect(tool.definition.isReadOnly).toBe(true);
    expect(tool.definition.isConcurrencySafe).toBe(true);
    expect(tool.checkPermission({}, ctx).behavior).toBe('allow');
  });

  it('reports "calibrating" for an engine with zero records instead of erroring', async () => {
    const tool = createEngineReliabilityTool();
    // A bogus engine id can never have logged turns, so this is deterministic
    // regardless of whatever real telemetry exists in ~/.agon/runs.
    const result = await tool.execute({ engineId: 'no-such-engine-zzz-9999' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('calibrating');
  });

  it('renders both explicitly labeled sections', async () => {
    const tool = createEngineReliabilityTool();
    const result = await tool.execute({ engineId: 'no-such-engine-zzz-9999' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('CESAR OWN-TURN RELIABILITY');
    expect(result.content).toContain('DELEGATED DISPATCH LEDGER');
    // An engine with no ledger records renders the honest empty line, not an error.
    expect(result.content).toContain('no ledger records yet');
  });

  it('summary scope (no engineId) still returns both sections without throwing', async () => {
    const tool = createEngineReliabilityTool();
    const result = await tool.execute({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('CESAR OWN-TURN RELIABILITY');
    expect(result.content).toContain('DELEGATED DISPATCH LEDGER');
  });
});

describe('EngineReliability tool — real delegate ledger section (2b)', () => {
  let home: string;
  beforeEach(() => { home = setupTestAgonHome('engine-reliability-ledger'); });
  afterEach(() => { cleanupTestAgonHome(home); });

  it('surfaces per-backend ledger stats, keeping api-loop and cli-print separate', async () => {
    recordApiLoopDispatch('eng-led', 'agent', [
      { tool: 'Read', status: 'ok', durationMs: 1, provenance: 'native' },
      { tool: 'Bash', status: 'error', durationMs: 1, provenance: 'native' },
    ]);
    recordTextTransportDispatch('eng-led', 'exec', 'cli-print');

    const tool = createEngineReliabilityTool();
    const result = await tool.execute({ engineId: 'eng-led' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('DELEGATED DISPATCH LEDGER');
    // api-loop line carries native per-call reliability...
    expect(result.content).toContain('[api-loop]');
    expect(result.content).toContain('1 ok, 1 failed');
    expect(result.content).toContain('(native)');
    // ...cli-print line is honest about having no per-call visibility.
    expect(result.content).toContain('[cli-print]');
    expect(result.content).toContain('no per-call visibility on this transport');
  });

  it('an engine with no ledger records shows the empty line, not an error', async () => {
    const tool = createEngineReliabilityTool();
    const result = await tool.execute({ engineId: 'never-delegated-to' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('no ledger records yet');
  });

  it('the all-engine view (no engineId) keeps two engines separate, never merged by backend', async () => {
    // Finding 1: two engines on the SAME backend must render as two distinct
    // lines, not one merged api-loop bucket.
    recordApiLoopDispatch('eng-alpha', 'agent', [
      { tool: 'Read', status: 'ok', durationMs: 1, provenance: 'native' },
      { tool: 'Grep', status: 'ok', durationMs: 1, provenance: 'native' },
    ]);
    recordApiLoopDispatch('eng-beta', 'agent', [
      { tool: 'Bash', status: 'error', durationMs: 1, provenance: 'native' },
    ]);

    const tool = createEngineReliabilityTool();
    const result = await tool.execute({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('eng-alpha [api-loop]');
    expect(result.content).toContain('eng-beta [api-loop]');
    // eng-alpha's 2 ok are not blended with eng-beta's failure.
    expect(result.content).toContain('eng-alpha [api-loop]: 1 dispatch, 2 tool calls — 2 ok, 0 failed');
    expect(result.content).toContain('eng-beta [api-loop]: 1 dispatch, 1 tool calls — 0 ok, 1 failed');
  });

  it('renders narrated stalls (heuristic) separately from native tool calls', async () => {
    // Finding 2: a real call plus a narrated stall in one dispatch.
    recordApiLoopDispatch('eng-stall', 'agent', [
      { tool: 'Read', status: 'ok', durationMs: 1, provenance: 'native' },
      { tool: 'narrated-stall', status: 'unknown', durationMs: 0, provenance: 'heuristic' },
    ]);

    const tool = createEngineReliabilityTool();
    const result = await tool.execute({ engineId: 'eng-stall' }, ctx);
    expect(result.ok).toBe(true);
    // The stall does NOT inflate the tool-call total (1, not 2)...
    expect(result.content).toContain('1 tool calls — 1 ok, 0 failed');
    // ...it is surfaced as its own heuristic clause.
    expect(result.content).toContain('1 narrated stall (heuristic)');
  });
});
