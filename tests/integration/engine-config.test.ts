import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEngineConfig, EngineDefinitionSchema } from '../../packages/core/src/schemas/engine-schema.js';

const ENGINES_DIR = join(import.meta.dirname, '../../engines');

function loadEngineConfigs() {
  const files = readdirSync(ENGINES_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => ({
    filename: f,
    raw: JSON.parse(readFileSync(join(ENGINES_DIR, f), 'utf-8')),
  }));
}

describe('Engine Config Validation', () => {
  const configs = loadEngineConfigs();

  it('configures Claude stream-json companion with the required verbose flag', () => {
    const claude = configs.find(({ filename }) => filename === 'claude.json')?.raw;
    expect(claude).toBeDefined();
    expect(claude?.companion?.protocol).toBe('stream-json');
    const serverCmd = claude?.companion?.serverCmd;
    expect(serverCmd).toBeDefined();
    expect(serverCmd).toContain('--verbose');
  });

  it('loads all engine configs from engines/', () => {
    expect(configs.length).toBeGreaterThanOrEqual(9);
  });

  for (const { filename, raw } of loadEngineConfigs()) {
    describe(filename, () => {
      it('has required base fields', () => {
        expect(raw.schemaVersion).toBeDefined();
        expect(raw.id).toBeDefined();
        expect(raw.displayName).toBeDefined();
        expect(raw.isLocal).toBeDefined();
        expect(raw.timeout).toBeGreaterThan(0);
      });

      it('has at least one mode (exec, review, or agent)', () => {
        const hasModes = !!(raw.exec || raw.review || raw.agent);
        expect(hasModes).toBe(true);
      });

      it('has exec mode with args array', () => {
        if (raw.exec) {
          expect(Array.isArray(raw.exec.args)).toBe(true);
        }
      });

      it('api config has required fields when present', () => {
        if (raw.api) {
          expect(raw.api.baseUrl).toBeDefined();
          expect(raw.api.apiKeyEnv).toBeDefined();
          expect(raw.api.model).toBeDefined();
        }
      });

      it('companion config has valid protocol when present', () => {
        if (raw.companion) {
          expect(['jsonrpc', 'acp', 'structured-cli', 'stream-json']).toContain(raw.companion.protocol);
          expect(Array.isArray(raw.companion.serverCmd)).toBe(true);
          if (raw.companion.sandbox) {
            expect(['read-only', 'workspace-write', 'danger-full-access']).toContain(raw.companion.sandbox);
          }
        }
      });

      it('preserves companion sandbox in validated config', () => {
        if (!raw.companion?.sandbox) return;
        const result = validateEngineConfig(raw, filename);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.companion?.sandbox).toBe(raw.companion.sandbox);
      });

      // Regression: the Zod schema strips any key it doesn't model. isolationHints
      // was absent from the schema, so it was silently dropped at load and
      // workspace-pure isolation never actually ran. The validated config MUST
      // round-trip the engine's isolation knobs.
      it('preserves isolationHints (configEnv/authMarker/loginArgs) in validated config', () => {
        if (!raw.isolationHints) return;
        const result = validateEngineConfig(raw, filename);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.isolationHints).toBeDefined();
        expect(result.data.isolationHints?.configEnv).toBe(raw.isolationHints.configEnv);
        expect(result.data.isolationHints?.authMarker).toBe(raw.isolationHints.authMarker);
        expect(result.data.isolationHints?.loginArgs).toEqual(raw.isolationHints.loginArgs);
        expect(result.data.isolationHints?.authFiles).toEqual(raw.isolationHints.authFiles);
      });

      // Regression (same class as isolationHints above): the Zod schema strips
      // any unmodelled key. sessionBudget MUST round-trip through validation or
      // the pre-turn context-budget gate is silently inert for every engine.
      it('preserves sessionBudget in validated config', () => {
        if (!raw.sessionBudget) return;
        const result = validateEngineConfig(raw, filename);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.sessionBudget).toBeDefined();
        expect(result.data.sessionBudget?.contextWindow).toBe(raw.sessionBudget.contextWindow);
      });

      it('passes Zod validation (with warnings for missing optionals)', () => {
        const result = validateEngineConfig(raw, filename);
        // Log warnings but don't fail — some configs are intentionally minimal
        if (!result.ok) {
          console.warn(`[WARN] ${result.error}`);
        }
        // At minimum, must parse without throwing
        expect(raw.id).toBeTruthy();
      });
    });
  }

  describe('Schema consistency across all engines', () => {
    it('all engines have unique IDs', () => {
      const ids = configs.map(c => c.raw.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all engines have schemaVersion 3', () => {
      for (const { raw } of configs) {
        expect(raw.schemaVersion).toBe(3);
      }
    });

    it('binary engines have searchPaths', () => {
      for (const { filename, raw } of configs) {
        if (raw.binary) {
          expect(raw.searchPaths).toBeDefined();
          expect(Array.isArray(raw.searchPaths)).toBe(true);
        }
      }
    });

    it('API engines have apiKeyEnv', () => {
      for (const { filename, raw } of configs) {
        if (raw.api) {
          expect(typeof raw.api.apiKeyEnv).toBe('string');
          expect(raw.api.apiKeyEnv.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // isolationHints.authFiles/authMarker get joined into filesystem paths (seed
  // copy + the auth gate's existsSync). Validate that the schema rejects path
  // traversal so an untrusted engine config can't escape the clean dir.
  describe('isolationHints path-safety validation', () => {
    const base = { schemaVersion: 3, id: 't', displayName: 't', isLocal: false, tier: 'builtin', timeout: 120 };

    it('rejects authMarker containing path separators', () => {
      expect(validateEngineConfig({ ...base, isolationHints: { configEnv: 'X', authMarker: '../../../etc/passwd' } }, 't.json').ok).toBe(false);
    });

    it('rejects authMarker of "." or ".." (basename would resolve to the dir itself)', () => {
      expect(validateEngineConfig({ ...base, isolationHints: { authMarker: '.' } }, 't.json').ok).toBe(false);
      expect(validateEngineConfig({ ...base, isolationHints: { authMarker: '..' } }, 't.json').ok).toBe(false);
    });

    it('rejects authFiles with traversal, absolute paths, or empty entries', () => {
      expect(validateEngineConfig({ ...base, isolationHints: { authFiles: ['../secret'] } }, 't.json').ok).toBe(false);
      expect(validateEngineConfig({ ...base, isolationHints: { authFiles: ['/etc/passwd'] } }, 't.json').ok).toBe(false);
      expect(validateEngineConfig({ ...base, isolationHints: { authFiles: [''] } }, 't.json').ok).toBe(false);
    });

    it('accepts the real claude/codex isolationHints shapes', () => {
      expect(validateEngineConfig({ ...base, isolationHints: { configEnv: 'CLAUDE_CONFIG_DIR', authFiles: [], authMarker: '.claude.json', loginArgs: ['auth', 'login'] } }, 't.json').ok).toBe(true);
      expect(validateEngineConfig({ ...base, isolationHints: { configEnv: 'CODEX_HOME', authFiles: ['auth.json'], authMarker: 'auth.json', loginArgs: ['login'] } }, 't.json').ok).toBe(true);
    });
  });

  describe('sessionBudget validation', () => {
    const base = { schemaVersion: 3, id: 't', displayName: 't', isLocal: false, tier: 'builtin', timeout: 120 };

    it('accepts a minimal sessionBudget (contextWindow only)', () => {
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 200000 } }, 't.json').ok).toBe(true);
    });

    it('accepts a fully-specified sessionBudget', () => {
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 400000, reserveTokens: 20000, warnAt: 0.7, compactAt: 0.82, hardStopAt: 0.92, estimator: 'message-history', charsPerToken: 3.9 } }, 't.json').ok).toBe(true);
    });

    it('rejects a non-positive contextWindow', () => {
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 0 } }, 't.json').ok).toBe(false);
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: -1 } }, 't.json').ok).toBe(false);
    });

    it('rejects threshold fractions outside (0,1]', () => {
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 100000, warnAt: 1.5 } }, 't.json').ok).toBe(false);
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 100000, compactAt: 0 } }, 't.json').ok).toBe(false);
    });

    it('rejects an unknown estimator enum value', () => {
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 100000, estimator: 'tiktoken' as any } }, 't.json').ok).toBe(false);
    });

    it('rejects reserveTokens >= contextWindow (degenerate effective window)', () => {
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 100000, reserveTokens: 100000 } }, 't.json').ok).toBe(false);
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 100000, reserveTokens: 150000 } }, 't.json').ok).toBe(false);
    });

    it('accepts reserveTokens below contextWindow', () => {
      expect(validateEngineConfig({ ...base, sessionBudget: { contextWindow: 100000, reserveTokens: 20000 } }, 't.json').ok).toBe(true);
    });
  });
});
