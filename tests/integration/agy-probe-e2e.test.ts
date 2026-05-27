import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
import {
  refreshProbedCliModels,
  readProbedCliModels,
  buildCliModelGroups,
} from '../../packages/core/src/cli-models-registry.js';

const agyInstalled = existsSync(join(homedir(), '.local', 'bin', 'agy'));
const claudeInstalled = existsSync(join(homedir(), '.local', 'bin', 'claude'));

describe.skipIf(!agyInstalled)('agy live /model probe — full TS→python→cache→read chain', () => {
  it('refresh spawns the probe, caches, and the group builder shows live tiers', async () => {
    const home = setupTestAgonHome('agy-e2e');
    try {
      const ok = await refreshProbedCliModels('agy', 'agy');
      expect(ok).toBe(true);
      const models = readProbedCliModels('agy');
      expect(models).not.toBeNull();
      expect(models!.length).toBeGreaterThanOrEqual(3);
      expect(models!.some((m) => m.current)).toBe(true);
      const google = buildCliModelGroups().find((g) => g.engineId === 'agy');
      expect(google!.models.some((m) => /\(High\)|\(Medium\)|\(Low\)/.test(m.name))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 60_000);
});

const codexInstalled = existsSync('/opt/homebrew/bin/codex') || existsSync(join(homedir(), '.local', 'bin', 'codex'));
const opencodeInstalled = existsSync(join(homedir(), '.opencode', 'bin', 'opencode'));

describe.skipIf(!opencodeInstalled)('opencode live model list — plain `opencode models` (no TUI scrape)', () => {
  it('refresh runs `opencode models`, caches, and the opencode group shows provider/model ids', async () => {
    const home = setupTestAgonHome('opencode-e2e');
    try {
      const binary = join(homedir(), '.opencode', 'bin', 'opencode');
      const ok = await refreshProbedCliModels('opencode', binary, ['models']);
      if (!ok) return; // no providers configured → empty list is a valid no-op
      const models = readProbedCliModels('opencode');
      expect(models).not.toBeNull();
      expect(models!.some((m) => m.id.includes('/'))).toBe(true); // provider/model form
      const grp = buildCliModelGroups().find((g) => g.engineId === 'opencode');
      expect(grp!.models.length).toBeGreaterThan(0);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 30_000);
});

describe.skipIf(!codexInstalled)('codex live /model probe — per-engine parser + chain', () => {
  it('probes codex /model when available (tolerates the brew auto-update intercept)', async () => {
    const home = setupTestAgonHome('codex-e2e');
    try {
      const ok = await refreshProbedCliModels('codex', 'codex');
      // codex is a brew cask — `codex` can trigger `brew upgrade --cask codex`,
      // which intercepts the TUI and yields no list. That path is a valid
      // graceful fallback, not a failure, so only assert when the probe landed.
      if (!ok) return;
      const models = readProbedCliModels('codex');
      expect(models).not.toBeNull();
      expect(models!.some((m) => /^gpt-/.test(m.id))).toBe(true);
      expect(models!.some((m) => m.current)).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 60_000);
});

describe.skipIf(!claudeInstalled)('claude live /model probe — per-engine parser + chain', () => {
  it('refresh probes claude /model and the anthropic group shows the live models', async () => {
    const home = setupTestAgonHome('claude-e2e');
    try {
      const ok = await refreshProbedCliModels('claude', 'claude');
      expect(ok).toBe(true);
      const models = readProbedCliModels('claude');
      expect(models).not.toBeNull();
      // claude aliases: opus / sonnet / sonnet[1m] / haiku
      expect(models!.some((m) => m.id === 'opus' || m.id === 'sonnet')).toBe(true);
      expect(models!.some((m) => m.current)).toBe(true);
      const anthropic = buildCliModelGroups().find((g) => g.engineId === 'claude');
      expect(anthropic!.models.some((m) => /Opus|Sonnet|Haiku/.test(m.name))).toBe(true);
    } finally {
      cleanupTestAgonHome(home);
    }
  }, 60_000);
});
