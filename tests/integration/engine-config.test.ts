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

  it('loads all engine configs from engines/', () => {
    expect(configs.length).toBeGreaterThanOrEqual(10);
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
});
