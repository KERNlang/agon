import { describe, it, expect } from 'vitest';
import { authFailureHint, authLoginHint } from '../../packages/core/src/engine-health.js';

// A 401 under agon's workspace-pure isolation used to surface as a bare "no answer" / raw stderr,
// with no clue that `agon login <engine>` is the fix. authLoginHint/authFailureHint are the generic,
// metadata-driven checker every dispatch surface now calls so the exact recovery command is always shown.

const claudeLike = {
  id: 'claude',
  isolationHints: { configEnv: 'CLAUDE_CONFIG_DIR', authMarker: '.claude.json', loginArgs: ['auth', 'login'] },
} as any;
const codexLike = {
  id: 'codex',
  isolationHints: { configEnv: 'CODEX_HOME', authMarker: 'auth.json', authFiles: ['auth.json'], loginArgs: ['login'] },
} as any;
const kimiLike = { id: 'kimi', api: { baseUrl: 'x', apiKeyEnv: 'KIMI_API_KEY', model: 'k2p7' } } as any;
const bareLike = { id: 'mystery' } as any;

describe('authLoginHint — metadata-driven recovery instruction (generic across engines)', () => {
  it('a CLI engine with an isolated config dir + loginArgs → `agon login <id> --force`', () => {
    expect(authLoginHint(claudeLike)).toContain('agon login claude --force');
    expect(authLoginHint(codexLike)).toContain('agon login codex --force');
  });

  it('an API-only engine → set its apiKeyEnv (or `agon provider`)', () => {
    const h = authLoginHint(kimiLike);
    expect(h).toContain('KIMI_API_KEY');
    expect(h).toContain('agon provider');
    expect(h).not.toContain('agon login');
  });

  it('no usable metadata → `agon doctor` fallback', () => {
    expect(authLoginHint(bareLike)).toContain('agon doctor');
  });

  it('a configEnv WITHOUT loginArgs is not driveable from login → not the login hint', () => {
    // e.g. an engine declares an isolated dir but no login subcommand: must NOT promise `agon login`.
    const noLogin = { id: 'weird', api: { apiKeyEnv: 'WEIRD_KEY' }, isolationHints: { configEnv: 'WEIRD_HOME' } } as any;
    const h = authLoginHint(noLogin);
    expect(h).not.toContain('agon login');
    expect(h).toContain('WEIRD_KEY');
  });
});

describe('authFailureHint — only fires on an AUTH-classified failure', () => {
  it('a 401 on a CLI engine → the login hint', () => {
    expect(authFailureHint(claudeLike, { stderr: 'API Error: 401', exitCode: 1 })).toContain('agon login claude --force');
  });

  it('an unauthorized / invalid-key error on an API engine → the key hint', () => {
    expect(authFailureHint(kimiLike, { errorMessage: 'unauthorized: invalid api key', exitCode: 1 })).toContain('KIMI_API_KEY');
  });

  it('a NON-auth failure (timeout / network / generic) → null, so the caller keeps its own detail', () => {
    expect(authFailureHint(claudeLike, { timedOut: true })).toBeNull();
    expect(authFailureHint(claudeLike, { stderr: 'getaddrinfo ENOTFOUND api.anthropic.com', exitCode: 1 })).toBeNull();
    expect(authFailureHint(claudeLike, { stderr: 'some random crash', exitCode: 1 })).toBeNull();
    expect(authFailureHint(claudeLike, {})).toBeNull();
  });

  it('an isolated config dir takes precedence over an api block (a CLI engine that ALSO declares api)', () => {
    const hybrid = {
      id: 'claude',
      api: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      isolationHints: { configEnv: 'CLAUDE_CONFIG_DIR', loginArgs: ['auth', 'login'] },
    } as any;
    expect(authFailureHint(hybrid, { stderr: '401', exitCode: 1 })).toContain('agon login claude --force');
  });
});
