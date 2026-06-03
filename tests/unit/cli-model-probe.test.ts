import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
import {
  readProbedCliModels,
  buildCliModelGroups,
  getBinaryVersionAsync,
  refreshCliGroupVersion,
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

  it('CLI group effortLevels mirror engines/*.json (guards the hardcoded copy against drift)', () => {
    home = setupTestAgonHome('probe-effort-sync');
    const claudeJson = JSON.parse(readFileSync(new URL('../../engines/claude.json', import.meta.url), 'utf-8'));
    const codexJson = JSON.parse(readFileSync(new URL('../../engines/codex.json', import.meta.url), 'utf-8'));
    const groups = buildCliModelGroups();
    // ENGINE_PROVIDER_MAP hardcodes effortLevels for the picker; if an engine
    // def's effort.levels change, this fails so the copy gets updated.
    expect(groups.find((g) => g.engineId === 'claude')!.effortLevels).toEqual(claudeJson.effort.levels);
    expect(groups.find((g) => g.engineId === 'codex')!.effortLevels).toEqual(codexJson.effort.levels);
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

// The picker's instant first paint depends on these resolving versions OFF the
// main thread (no execSync). `node` is guaranteed present under the test runner,
// so we use it as a stand-in binary for deterministic spawn behaviour.
describe('CLI binary version (async, non-blocking)', () => {
  const NODE = process.execPath;

  it('returns null for an empty version command without spawning', async () => {
    expect(await getBinaryVersionAsync('vtest-empty', NODE, [])).toBeNull();
  });

  it('resolves a real version string for a working binary', async () => {
    const v = await getBinaryVersionAsync('vtest-ok', NODE, ['--version']);
    expect(v).toMatch(/^v\d+\.\d+/); // e.g. "v24.2.0"
  });

  it('memoizes by engineId — a cache hit ignores a later (broken) command', async () => {
    const v1 = await getBinaryVersionAsync('vtest-cache', NODE, ['--version']);
    expect(v1).toMatch(/^v\d+\./);
    // Second call with a command that would FAIL must still return the cached
    // value, proving the cache short-circuits before any spawn.
    const v2 = await getBinaryVersionAsync('vtest-cache', NODE, ['-e', 'process.exit(1)']);
    expect(v2).toBe(v1);
  });

  it('returns null on a nonzero exit even when the command wrote to stdout', async () => {
    // Guards the execSync→spawnWithTimeout migration: spawnWithTimeout RESOLVES
    // on failure, so without the exitCode check this would cache "9.9.9".
    const v = await getBinaryVersionAsync('vtest-exit', NODE, ['-e', 'process.stdout.write("9.9.9"); process.exit(1)']);
    expect(v).toBeNull();
  });

  it('refreshCliGroupVersion returns null for an unknown engine', async () => {
    expect(await refreshCliGroupVersion('no-such-engine-xyz')).toBeNull();
  });
});
