import { describe, it, expect } from 'vitest';
import {
  resolveIsolationMode, planEngineIsolation, isValidIsolationMode,
} from '../../packages/core/src/generated/signals/isolation.js';
import type { EngineDefinition } from '../../packages/core/src/generated/models/types.js';

// Minimal engine fixtures — only the fields the planner reads matter.
const eng = (id: string, isolationHints?: EngineDefinition['isolationHints']): EngineDefinition =>
  ({ schemaVersion: 3, id, displayName: id, isLocal: false, tier: 'builtin', timeout: 120, isolationHints } as unknown as EngineDefinition);

const claude = eng('claude', { configEnv: 'CLAUDE_CONFIG_DIR', strictMcpArgs: ['--strict-mcp-config'], supportsProjectMcp: true });
const codex = eng('codex', { configEnv: 'CODEX_HOME', supportsProjectMcp: true });
const gemini = eng('gemini', { strictMcpArgs: ['--allowed-mcp-server-names'], supportsProjectMcp: true });
const apiEngine = eng('kimi-for-coding-k2p6'); // no isolationHints — API-only, already pure
const DIR = '/tmp/agon-pure/run-123/claude';

describe('isValidIsolationMode', () => {
  it('accepts exactly the three modes', () => {
    expect(isValidIsolationMode('workspace-pure')).toBe(true);
    expect(isValidIsolationMode('bare')).toBe(true);
    expect(isValidIsolationMode('inherit')).toBe(true);
  });
  it('rejects anything else', () => {
    for (const v of ['pure', 'WORKSPACE-PURE', '', 'none', undefined, null, 1, {}]) {
      expect(isValidIsolationMode(v as unknown)).toBe(false);
    }
  });
});

describe('resolveIsolationMode — precedence option > env > per-command > config > default', () => {
  it('honors the explicit per-dispatch option over everything', () => {
    expect(resolveIsolationMode({ option: 'bare', env: 'inherit', config: 'workspace-pure' })).toBe('bare');
  });
  it('uses the env var over per-command and config', () => {
    expect(resolveIsolationMode({ env: 'inherit', command: 'forge', byCommand: { forge: 'bare' }, config: 'workspace-pure' })).toBe('inherit');
  });
  it('uses a per-command override over the global config', () => {
    expect(resolveIsolationMode({ command: 'forge', byCommand: { forge: 'bare' }, config: 'inherit' })).toBe('bare');
  });
  it('falls back to global config when nothing more specific is set', () => {
    expect(resolveIsolationMode({ config: 'inherit' })).toBe('inherit');
  });
  it('defaults to workspace-pure when no source is set', () => {
    expect(resolveIsolationMode({})).toBe('workspace-pure');
  });
  it('skips an invalid value and uses the next valid source (a typo cannot silently disable isolation)', () => {
    expect(resolveIsolationMode({ option: 'garbage', config: 'inherit' })).toBe('inherit');
    expect(resolveIsolationMode({ option: 'x', env: 'y', config: 'z' })).toBe('workspace-pure');
  });
  it('ignores a per-command entry for a different command', () => {
    expect(resolveIsolationMode({ command: 'brainstorm', byCommand: { forge: 'bare' }, config: 'inherit' })).toBe('inherit');
  });
});

describe('planEngineIsolation', () => {
  it('inherit isolates nothing, keeps project context', () => {
    const p = planEngineIsolation(claude, 'inherit', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(false);
    expect(p.setEnv).toEqual({});
    expect(p.argsExtra).toEqual([]);
    expect(p.keepProjectContext).toBe(true);
    expect(p.strippedPersonal).toBe(false);
  });

  it('claude workspace-pure: clean CLAUDE_CONFIG_DIR + --strict-mcp-config, keeps project', () => {
    const p = planEngineIsolation(claude, 'workspace-pure', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(true);
    expect(p.setEnv).toEqual({ CLAUDE_CONFIG_DIR: DIR });
    expect(p.argsExtra).toEqual(['--strict-mcp-config']);
    expect(p.keepProjectContext).toBe(true);
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

  it('gemini workspace-pure: flag-based (no config env), MCP-blocking arg', () => {
    const p = planEngineIsolation(gemini, 'workspace-pure', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(true);
    expect(p.setEnv).toEqual({});
    expect(p.argsExtra).toEqual(['--allowed-mcp-server-names']);
    expect(p.configDir).toBeUndefined();
  });

  it('API-only engine (no isolationHints) is already pure — isolate=false, nothing applied', () => {
    const p = planEngineIsolation(apiEngine, 'workspace-pure', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(false);
    expect(p.setEnv).toEqual({});
    expect(p.argsExtra).toEqual([]);
    expect(p.keepProjectContext).toBe(true);
    expect(p.strippedPersonal).toBe(false);
  });

  it('bare drops project context (isolating engine still strips personal)', () => {
    const p = planEngineIsolation(claude, 'bare', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(true);
    expect(p.setEnv).toEqual({ CLAUDE_CONFIG_DIR: DIR });
    expect(p.keepProjectContext).toBe(false);
  });

  it('bare on an API engine still has nothing to strip, but drops project context', () => {
    const p = planEngineIsolation(apiEngine, 'bare', { cleanConfigDir: DIR });
    expect(p.isolate).toBe(false);
    expect(p.keepProjectContext).toBe(false);
  });
});
