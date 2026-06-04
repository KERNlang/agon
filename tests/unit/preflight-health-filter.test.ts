import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Import engineHealth from the SAME specifier the generated forge code uses
// (@kernlang/agon-core) so the singleton instance is shared — importing the core
// source facade directly would yield a second instance and mark() would not propagate.
import { engineHealth } from '@kernlang/agon-core';
import { preflightHealthFilter } from '../../packages/forge/src/generated/health-check.js';

// Layer 1 of the interactive-orchestration pre-flight filter is a PURE read of the
// engineHealth quarantine store — no dispatch, no mutation. The active probe (Layer 2)
// is opt-in only for these modes, so with probe off (the default) the adapter/registry
// are never touched and minimal stubs suffice.
const registry = {} as any;
const adapter = {
  dispatch: () => {
    throw new Error('Layer 2 probe must not run when probe is off');
  },
} as any;

describe('preflightHealthFilter — Layer 1 quarantine filter', () => {
  beforeEach(() => {
    engineHealth.clearAll();
    delete process.env.AGON_FORCE_HEALTH_PROBE;
  });

  it('keeps every engine when none are quarantined', async () => {
    const r = await preflightHealthFilter({ engineIds: ['a', 'b', 'c'], registry, adapter });
    expect(r.healthy).toEqual(['a', 'b', 'c']);
    expect(r.skipped).toEqual([]);
  });

  it('drops auth-failed and unreachable engines, preserving order of the rest', async () => {
    engineHealth.mark('b', 'auth-failed', 'invalid api key');
    engineHealth.mark('c', 'unreachable', 'ENOTFOUND');
    const r = await preflightHealthFilter({ engineIds: ['a', 'b', 'c', 'd'], registry, adapter });
    expect(r.healthy).toEqual(['a', 'd']);
    expect(r.skipped.map((s) => s.engineId).sort()).toEqual(['b', 'c']);
    expect(r.skipped.find((s) => s.engineId === 'b')?.status).toBe('auth-failed');
    expect(r.skipped.find((s) => s.engineId === 'c')?.reason).toContain('ENOTFOUND');
  });

  it('keeps transient (timeout/failed) engines — they may recover this session', async () => {
    engineHealth.mark('b', 'timeout', 'slow');
    engineHealth.mark('c', 'failed', 'generic miss');
    const r = await preflightHealthFilter({ engineIds: ['a', 'b', 'c'], registry, adapter });
    expect(r.healthy).toEqual(['a', 'b', 'c']);
    expect(r.skipped).toEqual([]);
  });

  it('is idempotent — re-filtering the healthy output is a no-op (safe to nest)', async () => {
    engineHealth.mark('b', 'auth-failed', 'bad key');
    const once = await preflightHealthFilter({ engineIds: ['a', 'b', 'c'], registry, adapter });
    const twice = await preflightHealthFilter({ engineIds: once.healthy, registry, adapter });
    expect(twice.healthy).toEqual(once.healthy);
    expect(twice.skipped).toEqual([]);
  });

  it('does not run the active probe by default (probe is opt-in)', async () => {
    engineHealth.mark('b', 'auth-failed', 'x');
    // The throwing adapter proves dispatch is never called on the probe-off path.
    const r = await preflightHealthFilter({ engineIds: ['a', 'b'], registry, adapter });
    expect(r.healthy).toEqual(['a']);
  });

  it('returns an empty healthy set (never resurrects) when all are quarantined', async () => {
    engineHealth.mark('a', 'auth-failed', 'x');
    engineHealth.mark('b', 'unreachable', 'y');
    const r = await preflightHealthFilter({ engineIds: ['a', 'b'], registry, adapter });
    expect(r.healthy).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });
});

describe('preflightHealthFilter — Layer 2 active probe (opt-in)', () => {
  // The global test setup (tests/setup.ts) sets AGON_DISABLE_FORGE_HEALTH_CHECK so
  // mock adapters never have to answer a probe; these Layer 2 tests re-enable it and
  // restore the original value afterward.
  const savedDisable = process.env.AGON_DISABLE_FORGE_HEALTH_CHECK;

  // A non-API-backed (CLI) engine: registry.findBinary returns a path, so
  // isApiBackedEngine is false and the probe runs un-throttled with the short timeout.
  const probeRegistry = {
    get: (id: string) => ({ id, binary: `bin-${id}` }),
    findBinary: () => '/usr/bin/stub',
  } as any;
  const makeProbeAdapter = (calls: string[]) =>
    ({
      dispatch: async ({ engine }: any) => {
        calls.push(engine.id);
        return engine.id === 'bad'
          ? { exitCode: 1, stdout: '', stderr: 'kaput', timedOut: false }
          : { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
      },
    }) as any;

  beforeEach(() => {
    engineHealth.clearAll();
    delete process.env.AGON_DISABLE_FORGE_HEALTH_CHECK;
    delete process.env.AGON_FORCE_HEALTH_PROBE;
  });
  afterEach(() => {
    if (savedDisable === undefined) delete process.env.AGON_DISABLE_FORGE_HEALTH_CHECK;
    else process.env.AGON_DISABLE_FORGE_HEALTH_CHECK = savedDisable;
    delete process.env.AGON_FORCE_HEALTH_PROBE;
  });

  it('probe:true dispatches a liveness ping and moves non-responders to skipped', async () => {
    const calls: string[] = [];
    const r = await preflightHealthFilter({ engineIds: ['good', 'bad'], registry: probeRegistry, adapter: makeProbeAdapter(calls), probe: true });
    expect(calls.sort()).toEqual(['bad', 'good']); // both engines were probed
    expect(r.healthy).toEqual(['good']);
    expect(r.skipped.map((s) => s.engineId)).toEqual(['bad']);
    expect(r.skipped[0].status).toBe('health-check-failed');
  });

  it('AGON_FORCE_HEALTH_PROBE triggers the probe without an explicit probe:true', async () => {
    process.env.AGON_FORCE_HEALTH_PROBE = '1';
    const calls: string[] = [];
    const r = await preflightHealthFilter({ engineIds: ['good'], registry: probeRegistry, adapter: makeProbeAdapter(calls) });
    expect(calls).toEqual(['good']);
    expect(r.healthy).toEqual(['good']);
  });

  it('AGON_DISABLE_FORGE_HEALTH_CHECK short-circuits the probe even with probe:true', async () => {
    process.env.AGON_DISABLE_FORGE_HEALTH_CHECK = '1';
    const calls: string[] = [];
    const r = await preflightHealthFilter({ engineIds: ['good', 'bad'], registry: probeRegistry, adapter: makeProbeAdapter(calls), probe: true });
    expect(calls).toEqual([]); // probe short-circuited inside healthCheckEngines
    expect(r.healthy).toEqual(['good', 'bad']);
  });

  it('Layer 1 still runs before the probe — quarantined engines are never probed', async () => {
    engineHealth.mark('bad', 'auth-failed', 'no key');
    const calls: string[] = [];
    const r = await preflightHealthFilter({ engineIds: ['good', 'bad'], registry: probeRegistry, adapter: makeProbeAdapter(calls), probe: true });
    expect(calls).toEqual(['good']); // 'bad' dropped by Layer 1, never dispatched
    expect(r.healthy).toEqual(['good']);
    expect(r.skipped.map((s) => s.engineId)).toEqual(['bad']);
    expect(r.skipped[0].status).toBe('auth-failed');
  });
});
