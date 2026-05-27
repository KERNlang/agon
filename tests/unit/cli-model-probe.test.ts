import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
import {
  readProbedCliModels,
  buildCliModelGroups,
} from '../../packages/core/src/cli-models-registry.js';

function writeProbeCache(home: string, engineId: string, models: any[]): string {
  const dir = join(home, 'cache');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `cli-models-${engineId}.json`);
  writeFileSync(file, JSON.stringify({ ts: Date.now(), engineId, models }));
  return file;
}

const AGY_PROBE = [
  { id: 'gemini-3.5-flash-medium', name: 'Gemini 3.5 Flash (Medium)', current: false },
  { id: 'gemini-3.5-flash-high', name: 'Gemini 3.5 Flash (High)', current: true },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', current: false },
];

describe('CLI live-model probe cache', () => {
  let home: string | undefined;
  afterEach(() => {
    cleanupTestAgonHome(home);
    home = undefined;
  });

  it('readProbedCliModels returns the fresh cached probe with the current flag', () => {
    home = setupTestAgonHome('probe-read');
    writeProbeCache(home, 'agy', AGY_PROBE);
    const models = readProbedCliModels('agy');
    expect(models).not.toBeNull();
    expect(models!.map((m) => m.name)).toContain('Gemini 3.5 Flash (High)');
    expect(models!.find((m) => m.current)?.name).toBe('Gemini 3.5 Flash (High)');
  });

  it('returns null when no probe has been cached', () => {
    home = setupTestAgonHome('probe-absent');
    expect(readProbedCliModels('agy')).toBeNull();
  });

  it('treats a probe older than the TTL as stale (falls back)', () => {
    home = setupTestAgonHome('probe-stale');
    const file = writeProbeCache(home, 'agy', AGY_PROBE);
    // Age the file 2 days back; default TTL is 24h, so it must read as stale.
    const twoDaysAgoSec = (Date.now() - 2 * 86_400_000) / 1000;
    utimesSync(file, twoDaysAgoSec, twoDaysAgoSec);
    expect(readProbedCliModels('agy')).toBeNull();
  });

  it('buildCliModelGroups prefers the probed list over the static fallback for agy', () => {
    home = setupTestAgonHome('probe-merge');
    writeProbeCache(home, 'agy', AGY_PROBE);
    const groups = buildCliModelGroups();
    const google = groups.find((g) => g.engineId === 'agy');
    expect(google).toBeTruthy();
    const names = google!.models.map((m) => m.name);
    // The probed tiers (NOT in FALLBACK_MODELS[google]) must win.
    expect(names).toContain('Gemini 3.5 Flash (High)');
    expect(names).toContain('GPT-OSS 120B (Medium)');
  });

  it('opencode group prefers the probed provider/model list (plain `opencode models`)', () => {
    home = setupTestAgonHome('probe-opencode');
    writeProbeCache(home, 'opencode', [
      { id: 'github-copilot/gpt-5.5', name: 'github-copilot/gpt-5.5', current: false },
      { id: 'kimi-for-coding/k2p6', name: 'kimi-for-coding/k2p6', current: false },
    ]);
    const grp = buildCliModelGroups().find((g) => g.engineId === 'opencode');
    expect(grp).toBeTruthy();
    const ids = grp!.models.map((m) => m.id);
    expect(ids).toContain('github-copilot/gpt-5.5');
    expect(ids).toContain('kimi-for-coding/k2p6');
  });

  it('labels CLI groups by engine (Antigravity, not Google) and carries effort levels', () => {
    home = setupTestAgonHome('probe-labels');
    const groups = buildCliModelGroups();
    const agy = groups.find((g) => g.engineId === 'agy');
    const claude = groups.find((g) => g.engineId === 'claude');
    const codex = groups.find((g) => g.engineId === 'codex');
    // CLI view names the engine, not the API provider.
    expect(agy!.providerName).toBe('Antigravity');
    expect(claude!.providerName).toBe('Claude');
    // Effort dimension: claude/codex have levels; agy bakes effort into its model tiers.
    expect(claude!.effortLevels).toContain('high');
    expect(codex!.effortLevels).toContain('xhigh');
    expect(agy!.effortLevels ?? []).toHaveLength(0);
  });

  it('falls back to the static google list when no probe is cached', () => {
    home = setupTestAgonHome('probe-fallback');
    const groups = buildCliModelGroups();
    const google = groups.find((g) => g.engineId === 'agy');
    expect(google).toBeTruthy();
    const names = google!.models.map((m) => m.name);
    // Static fallback has the bare names, not the agy CLI effort tiers.
    expect(names).toContain('Gemini 3.5 Flash');
    expect(names).not.toContain('Gemini 3.5 Flash (High)');
  });
});
