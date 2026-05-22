import { describe, it, expect } from 'vitest';
import {
  resolveIsolationMode, planEngineIsolation, isValidIsolationMode,
} from '../../packages/core/src/generated/signals/isolation.js';
import type { EngineDefinition } from '../../packages/core/src/generated/models/types.js';

// Minimal engine fixtures — only the fields the planner reads matter.
const eng = (id: string, isolationHints?: EngineDefinition['isolationHints']): EngineDefinition =>
  ({ schemaVersion: 3, id, displayName: id, isLocal: false, tier: 'builtin', timeout: 120, isolationHints } as unknown as EngineDefinition);

const claude = eng('claude', { configEnv: 'CLAUDE_CONFIG_DIR', strictMcpArgs: ['--strict-mcp-config'], authFiles: ['.credentials.json'], supportsProjectMcp: true });
const codex = eng('codex', { configEnv: 'CODEX_HOME', authFiles: ['auth.json'], supportsProjectMcp: true });
const flagOnly = eng('flagonly', { strictMcpArgs: ['--no-mcp'] }); // hint without a configEnv
const apiEngine = eng('kimi-for-coding-k2p6'); // no isolationHints — API-only, already pure
const DIR = '/tmp/agon-pure/run-123/claude';

describe('isValidIsolationMode', () => {
  it('accepts exactly the two shipped modes', () => {
    expect(isValidIsolationMode('workspace-pure')).toBe(true);
    expect(isValidIsolationMode('inherit')).toBe(true);
  });
  it('rejects anything else (including the unshipped "bare")', () => {
    for (const v of ['bare', 'pure', 'WORKSPACE-PURE', '', 'none', undefined, null, 1, {}]) {
      expect(isValidIsolationMode(v as unknown)).toBe(false);
    }
  });
});

describe('resolveIsolationMode — precedence option > env > config > default', () => {
  it('honors the explicit per-dispatch option over everything', () => {
    expect(resolveIsolationMode({ option: 'inherit', env: 'workspace-pure', config: 'workspace-pure' })).toBe('inherit');
  });
  it('uses the env var over config', () => {
    expect(resolveIsolationMode({ env: 'inherit', config: 'workspace-pure' })).toBe('inherit');
  });
  it('falls back to config when no option/env is set', () => {
    expect(resolveIsolationMode({ config: 'inherit' })).toBe('inherit');
  });
  it('defaults to workspace-pure when no source is set', () => {
    expect(resolveIsolationMode({})).toBe('workspace-pure');
  });
  it('skips an invalid value and uses the next valid source (a typo cannot silently disable isolation)', () => {
    expect(resolveIsolationMode({ option: 'garbage', config: 'inherit' })).toBe('inherit');
    expect(resolveIsolationMode({ option: 'bare', config: 'inherit' })).toBe('inherit'); // 'bare' no longer valid
    expect(resolveIsolationMode({ option: 'x', env: 'y', config: 'z' })).toBe('workspace-pure');
  });
});

describe('planEngineIsolation', () => {
  it('inherit isolates nothing', () => {
    const p = planEngineIsolation(claude, 'inherit', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(false);
    expect(p.setEnv).toEqual({});
    expect(p.argsExtra).toEqual([]);
    expect(p.strippedPersonal).toBe(false);
  });

  it('claude workspace-pure: clean CLAUDE_CONFIG_DIR + --strict-mcp-config', () => {
    const p = planEngineIsolation(claude, 'workspace-pure', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(true);
    expect(p.setEnv).toEqual({ CLAUDE_CONFIG_DIR: DIR });
    expect(p.argsExtra).toEqual(['--strict-mcp-config']);
    expect(p.configDir).toBe(DIR);
    expect(p.strippedPersonal).toBe(true);
  });

  it('codex workspace-pure: clean CODEX_HOME, no extra args', () => {
    const p = planEngineIsolation(codex, 'workspace-pure', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(true);
    expect(p.setEnv).toEqual({ CODEX_HOME: DIR });
    expect(p.argsExtra).toEqual([]);
    expect(p.configDir).toBe(DIR);
  });

  it('flag-only engine (strictMcpArgs, no configEnv): args but no env, no configDir', () => {
    const p = planEngineIsolation(flagOnly, 'workspace-pure', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(true);
    expect(p.setEnv).toEqual({});
    expect(p.argsExtra).toEqual(['--no-mcp']);
    expect(p.configDir).toBeUndefined();
  });

  it('API-only engine (no isolationHints) is already pure — isolate=false, nothing applied', () => {
    const p = planEngineIsolation(apiEngine, 'workspace-pure', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(false);
    expect(p.setEnv).toEqual({});
    expect(p.argsExtra).toEqual([]);
    expect(p.strippedPersonal).toBe(false);
  });
});
