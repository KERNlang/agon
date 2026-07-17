import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Source of truth: packages/core/src/kern/signals/models-registry.kern
import { lookupCatalogContextWindow } from '@kernlang/agon-core';

const CATALOG = {
  'kimi-for-coding': {
    models: {
      k3: { limit: { context: 1048576, output: 131072 } },
      k2p7: { limit: { context: 262144, output: 32768 } },
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
