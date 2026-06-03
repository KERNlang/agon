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
});
