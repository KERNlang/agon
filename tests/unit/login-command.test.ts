import { describe, expect, it } from 'vitest';
import { planEngineLogin } from '../../packages/cli/src/generated/commands/login.js';
import type { EngineDefinition } from '../../packages/core/src/generated/models/types.js';

const eng = (id: string, isolationHints?: EngineDefinition['isolationHints']): EngineDefinition =>
  ({ schemaVersion: 3, id, displayName: id, isLocal: false, tier: 'builtin', timeout: 120, isolationHints } as unknown as EngineDefinition);

const DIR = '/home/u/.agon/pure/claude';

describe('planEngineLogin', () => {
  it('claude: configEnv + loginArgs → ok, carries the clean dir + login subcommand', () => {
    const claude = eng('claude', { configEnv: 'CLAUDE_CONFIG_DIR', authFiles: [], authMarker: '.claude.json', loginArgs: ['auth', 'login'] });
    const p = planEngineLogin(claude, DIR);
    expect(p.ok).toBe(true);
    expect(p.configEnv).toBe('CLAUDE_CONFIG_DIR');
    expect(p.cleanConfigDir).toBe(DIR);
    expect(p.loginArgs).toEqual(['auth', 'login']);
    expect(p.authMarker).toBe('.claude.json');
  });

  it('API-only engine (no isolationHints) → not ok, reason no-config-dir', () => {
    const kimi = eng('kimi-for-coding-k2p6');
    const p = planEngineLogin(kimi, DIR);
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('no-config-dir');
  });

  it('configEnv but no loginArgs → not ok, reason no-login-command', () => {
    const weird = eng('weird', { configEnv: 'WEIRD_HOME', authMarker: 'auth.json' });
    const p = planEngineLogin(weird, DIR);
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('no-login-command');
    expect(p.configEnv).toBe('WEIRD_HOME');
  });

  it('loginArgs is copied (not aliased) so the engine def stays immutable', () => {
    const args = ['login'];
    const codex = eng('codex', { configEnv: 'CODEX_HOME', authFiles: ['auth.json'], authMarker: 'auth.json', loginArgs: args });
    const p = planEngineLogin(codex, DIR);
    expect(p.loginArgs).toEqual(['login']);
    expect(p.loginArgs).not.toBe(args);
  });
});
