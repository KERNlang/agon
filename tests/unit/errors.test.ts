import { describe, it, expect } from 'vitest';
import { EngineNotFoundError } from '../../packages/core/src/generated/models/errors.js';

describe('EngineNotFoundError (mode vs engine, #2)', () => {
  it('hints that a known mode name is a command, not an engine', () => {
    const e = new EngineNotFoundError('conquer');
    expect(e.message).toContain('"conquer" not found');
    expect(e.message).toContain('is an Agon mode');
    expect(e.message).toContain('/conquer');
    expect(e.engineId).toBe('conquer');
  });

  it('recognizes mode names case-insensitively (title-case / upper-case)', () => {
    for (const id of ['Conquer', 'GOAL', 'Forge']) {
      const e = new EngineNotFoundError(id);
      expect(e.message).toContain('is an Agon mode');
      expect(e.message).toContain('/' + id.toLowerCase()); // hint uses the normalized command
      expect(e.message).toContain(`"${id}" not found`); // original casing preserved in the main text
    }
  });

  it('does not add a mode hint for a genuine unknown engine', () => {
    const e = new EngineNotFoundError('totally-unknown-engine');
    expect(e.message).toContain('"totally-unknown-engine" not found');
    expect(e.message).not.toContain('is an Agon mode');
  });

  it('still appends an install hint (not a mode hint) for a non-mode id', () => {
    const e = new EngineNotFoundError('aider', 'pip install aider');
    expect(e.message).toContain('Install: pip install aider');
    expect(e.message).not.toContain('is an Agon mode');
  });

  it('reports a missing binary by name with an install hint (the codex incident)', () => {
    const e = new EngineNotFoundError('codex', 'npm install -g @openai/codex', 'codex');
    expect(e.message).toContain('"codex" not found');
    expect(e.message).toContain('binary "codex" not found on PATH');
    expect(e.message).toContain('Install: npm install -g @openai/codex');
    // It must NOT look like an API-key / env problem.
    expect(e.message).not.toContain('API key');
    expect(e.message).not.toContain('environment variable');
    expect(e.missingBinary).toBe('codex');
  });

  it('names the missing binary even with no install hint', () => {
    const e = new EngineNotFoundError('mycli', undefined, 'mycli-bin');
    expect(e.message).toContain('binary "mycli-bin" not found on PATH');
    expect(e.message).not.toContain('Install:');
  });

  it('a mode-name id still takes priority over a binary hint', () => {
    const e = new EngineNotFoundError('forge', 'irrelevant', 'forge-bin');
    expect(e.message).toContain('is an Agon mode');
    expect(e.message).not.toContain('binary "forge-bin"');
  });
});
