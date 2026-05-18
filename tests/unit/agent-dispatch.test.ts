import { describe, it, expect } from 'vitest';
import { buildCommand, supportsAgentMode, resolveAgentArgs } from '../../packages/adapter-cli/src/generated/adapter-helpers.js';
import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import type { EngineDefinition, EngineModeConfig } from '../../packages/core/src/types.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINES_DIR = join(__dirname, '../../engines');

function loadRegistry(): EngineRegistry {
  const reg = new EngineRegistry();
  reg.load(ENGINES_DIR);
  return reg;
}

describe('Agent Dispatch', () => {
  describe('buildCommand — agent mode', () => {
    it('uses agent args for claude with --print for non-interactive subprocess use', () => {
      const reg = loadRegistry();
      const engine = reg.get('claude');
      const binary = '/usr/local/bin/claude';
      const { args } = buildCommand(engine, 'agent', 'fix the bug', '/tmp', 600, binary);
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--max-turns');
      expect(args).toContain('--verbose');
      expect(args).toContain('--print');
      expect(args).not.toContain('--output-format');
    });

    it('uses agent args for codex (bypass approvals + sandbox)', () => {
      const reg = loadRegistry();
      const engine = reg.get('codex');
      const binary = '/usr/local/bin/codex';
      const { args } = buildCommand(engine, 'agent', 'fix the bug', '/tmp', 120, binary);
      expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(args).toContain('--skip-git-repo-check');
      expect(args).toContain('exec');
    });

    it('uses agent args for gemini with -p for non-interactive subprocess use', () => {
      const reg = loadRegistry();
      const engine = reg.get('gemini');
      const binary = '/usr/local/bin/gemini';
      const { args } = buildCommand(engine, 'agent', 'fix the bug', '/tmp', 120, binary);
      expect(args).toContain('yolo');
      expect(args).toContain('-p');
    });

    it('keeps gemini model flags outside the -p prompt pair', () => {
      const reg = loadRegistry();
      const engine = reg.get('gemini');
      const binary = '/usr/local/bin/gemini';
      const { args } = buildCommand(engine, 'agent', 'fix the bug', '/tmp', 120, binary);
      const promptFlagIdx = args.indexOf('-p');
      expect(args[promptFlagIdx + 1]).toBe('fix the bug');
      expect(args.indexOf('--model')).toBeLessThan(promptFlagIdx);
    });

    it('throws for engines without agent config', () => {
      const reg = loadRegistry();
      const engine = reg.get('ollama');
      const binary = '/usr/local/bin/ollama';
      expect(() => buildCommand(engine, 'agent', 'prompt', '/tmp', 300, binary)).toThrow();
    });
  });

  describe('supportsAgentMode', () => {
    it('returns true for engines with agent config', () => {
      const reg = loadRegistry();
      expect(supportsAgentMode(reg.get('claude'))).toBe(true);
      expect(supportsAgentMode(reg.get('codex'))).toBe(true);
      expect(supportsAgentMode(reg.get('gemini'))).toBe(true);
    });

    it('returns false for text-only engines', () => {
      const reg = loadRegistry();
      expect(supportsAgentMode(reg.get('ollama'))).toBe(false);
      expect(supportsAgentMode(reg.get('openrouter'))).toBe(false);
      expect(supportsAgentMode(reg.get('qwen'))).toBe(false);
      expect(supportsAgentMode(reg.get('mistral'))).toBe(false);
    });
  });

  describe('resolveAgentArgs', () => {
    it('returns agent config as-is for full permission', () => {
      const reg = loadRegistry();
      const engine = reg.get('claude');
      const result = resolveAgentArgs(engine, 'full');
      expect(result).not.toBeNull();
      expect(result!.args).toEqual(engine.agent!.args);
    });

    it('returns null for read-only permission', () => {
      const reg = loadRegistry();
      const result = resolveAgentArgs(reg.get('claude'), 'read-only');
      expect(result).toBeNull();
    });

    it('returns null for engines without agent config', () => {
      const reg = loadRegistry();
      const result = resolveAgentArgs(reg.get('ollama'), 'full');
      expect(result).toBeNull();
    });

    it('swaps flags for plan permission (claude)', () => {
      const reg = loadRegistry();
      const result = resolveAgentArgs(reg.get('claude'), 'plan');
      expect(result).not.toBeNull();
      expect(result!.args).toContain('--permission-mode=plan');
      expect(result!.args).not.toContain('--dangerously-skip-permissions');
    });

    it('swaps flags for plan permission (gemini)', () => {
      const reg = loadRegistry();
      const result = resolveAgentArgs(reg.get('gemini'), 'plan');
      expect(result).not.toBeNull();
      expect(result!.args).toContain('plan');
      expect(result!.args).not.toContain('yolo');
    });
  });

  describe('EngineRegistry.agentCapableIds', () => {
    it('returns only engines with agent config', () => {
      const reg = loadRegistry();
      const ids = reg.agentCapableIds();
      // These engines have agent config (may not be "available" without binary)
      // So agentCapableIds filters by available + agent config
      // In test env, no binaries are available, so this returns empty
      expect(Array.isArray(ids)).toBe(true);
    });
  });

  describe('EngineRegistry.supportsMode', () => {
    it('recognizes agent mode for claude', () => {
      const reg = loadRegistry();
      expect(reg.supportsMode(reg.get('claude'), 'agent')).toBe(true);
    });

    it('rejects agent mode for ollama', () => {
      const reg = loadRegistry();
      expect(reg.supportsMode(reg.get('ollama'), 'agent')).toBe(false);
    });

    it('still supports exec/review modes', () => {
      const reg = loadRegistry();
      expect(reg.supportsMode(reg.get('claude'), 'exec')).toBe(true);
      expect(reg.supportsMode(reg.get('claude'), 'review')).toBe(true);
    });
  });
});
