import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Source of truth: packages/core/src/kern/signals/models-registry.kern
import { lookupCatalogContextWindow, lookupCatalogModelCost, lookupCatalogModelAttachment, engineSupportsVision } from '../../packages/core/src/generated/signals/models-registry.js';
import { estimateCost, estimateCostCacheAware } from '../../packages/core/src/generated/signals/token-tracker.js';

const CATALOG = {
  'kimi-for-coding': {
    models: {
      k3: { limit: { context: 1048576, output: 131072 }, cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, attachment: false },
      k2p7: { limit: { context: 262144, output: 32768 }, attachment: true },
    },
  },
  metered: {
    models: {
      'sonnet-x': { limit: { context: 200000 }, cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } },
    },
  },
  'provider-a': {
    models: { 'shared-model': { limit: { context: 262144 } } },
  },
  'provider-b': {
    models: { 'shared-model': { limit: { context: 128000 } } },
  },
  'no-limit': {
    models: { mystery: {} },
  },
  partial: {
    models: {
      'half-priced': { limit: { context: 200000 }, cost: { output: 10 } },
    },
  },
};

describe('lookupCatalogContextWindow — real windows from the models.dev cache', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agon-catalog-'));
    prevHome = process.env.AGON_HOME;
    process.env.AGON_HOME = home;
    mkdirSync(join(home, 'cache'), { recursive: true });
    writeFileSync(join(home, 'cache', 'models-dev.json'), JSON.stringify(CATALOG));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves the provider+model pair via the sanitized engine id (kimi k3 = 1M)', () => {
    expect(lookupCatalogContextWindow('kimi-for-coding-k3', 'k3')).toBe(1048576);
  });

  it('falls back to an exact model-id match across providers', () => {
    expect(lookupCatalogContextWindow('some-custom-engine', 'k2p7')).toBe(262144);
  });

  it('takes the conservative MINIMUM on a cross-provider model-id collision', () => {
    expect(lookupCatalogContextWindow('unknown-engine', 'shared-model')).toBe(128000);
  });

  it('returns null for unknown models and models without a limit', () => {
    expect(lookupCatalogContextWindow('nope', 'not-a-model')).toBeNull();
    expect(lookupCatalogContextWindow('no-limit-mystery', 'mystery')).toBeNull();
  });

  it('returns null when the cache file is absent', () => {
    rmSync(join(home, 'cache', 'models-dev.json'));
    expect(lookupCatalogContextWindow('kimi-for-coding-k3', 'k3')).toBeNull();
  });
});

describe('lookupCatalogModelCost — real split pricing from the catalog', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agon-catalog-cost-'));
    prevHome = process.env.AGON_HOME;
    process.env.AGON_HOME = home;
    mkdirSync(join(home, 'cache'), { recursive: true });
    writeFileSync(join(home, 'cache', 'models-dev.json'), JSON.stringify(CATALOG));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('returns the split rates for an exact engine-id match', () => {
    expect(lookupCatalogModelCost('metered-sonnet-x')).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
  });

  it('returns all-zero rates for a plan-included model (zeros are valid, not null)', () => {
    expect(lookupCatalogModelCost('kimi-for-coding-k3')).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('returns null for unknown engines, missing cost objects, and NEVER loose model-id matches', () => {
    expect(lookupCatalogModelCost('nope-engine')).toBeNull();
    expect(lookupCatalogModelCost('kimi-for-coding-k2p7')).toBeNull(); // model known, no cost object
    expect(lookupCatalogModelCost('sonnet-x')).toBeNull(); // bare model id must not match
  });

  it('returns null when base input/output rates are missing — MISSING is not FREE', () => {
    // cost object exists but lacks `input`: fall back to legacy pricing, never $0
    expect(lookupCatalogModelCost('partial-half-priced')).toBeNull();
  });

  it('prices a metered engine with real split rates through estimateCostCacheAware', () => {
    // 1M prompt (900k cached) + 100k output:
    // 100k uncached * $2/M + 100k out * $10/M + 900k cached * $0.2/M = 0.2 + 1.0 + 0.18
    const cost = estimateCostCacheAware('metered-sonnet-x', 1_000_000, 100_000, 900_000);
    expect(cost).toBeCloseTo(1.38, 5);
  });

  it('prices the totals-only path with the blended 75/25 catalog rate', () => {
    // 1M tokens * (0.75*$2 + 0.25*$10)/M = $4
    expect(estimateCost('metered-sonnet-x', 1_000_000)).toBeCloseTo(4, 5);
  });

  it('keeps plan-included engines at exactly $0 via catalog zeros', () => {
    expect(estimateCostCacheAware('kimi-for-coding-k3', 5_000_000, 500_000, 4_000_000)).toBe(0);
  });
});


describe('engineSupportsVision — catalog-derived vision with declared override', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agon-catalog-'));
    prevHome = process.env.AGON_HOME;
    process.env.AGON_HOME = home;
    mkdirSync(join(home, 'cache'), { recursive: true });
    writeFileSync(join(home, 'cache', 'models-dev.json'), JSON.stringify(CATALOG));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('an API engine inherits catalog attachment: true without declaring capabilities', () => {
    expect(lookupCatalogModelAttachment('kimi-for-coding-k2p7')).toBe(true);
    expect(engineSupportsVision({ id: 'kimi-for-coding-k2p7' })).toBe(true);
  });

  it('a declared vision capability ALWAYS wins over a stale catalog attachment: false', () => {
    expect(lookupCatalogModelAttachment('kimi-for-coding-k3')).toBe(false);
    expect(engineSupportsVision({ id: 'kimi-for-coding-k3' })).toBe(false);
    expect(engineSupportsVision({ id: 'kimi-for-coding-k3', capabilities: ['vision'] })).toBe(true);
  });

  it('engines the catalog does not know stay declaration-only', () => {
    expect(lookupCatalogModelAttachment('claude')).toBeNull();
    expect(engineSupportsVision({ id: 'claude' })).toBe(false);
    expect(engineSupportsVision({ id: 'claude', capabilities: ['vision'] })).toBe(true);
    expect(engineSupportsVision(null)).toBe(false);
  });

  it('a catalog entry without a boolean attachment resolves to null, not false-vision', () => {
    expect(lookupCatalogModelAttachment('metered-sonnet-x')).toBeNull();
    expect(engineSupportsVision({ id: 'metered-sonnet-x' })).toBe(false);
  });

  it('a missing cache file degrades to declaration-only', () => {
    rmSync(join(home, 'cache', 'models-dev.json'));
    expect(engineSupportsVision({ id: 'kimi-for-coding-k2p7' })).toBe(false);
    expect(engineSupportsVision({ id: 'kimi-for-coding-k2p7', capabilities: ['vision'] })).toBe(true);
  });
});
