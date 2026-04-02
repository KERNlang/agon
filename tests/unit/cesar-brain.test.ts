import { describe, it, expect } from 'vitest';
import { parseDelegation } from '../../packages/cli/src/handlers/cesar-brain.js';

describe('Cesar Brain', () => {
  describe('parseDelegation', () => {
    it('detects [DELEGATE:build]', () => {
      const { action, rest } = parseDelegation('[DELEGATE:build] This needs agent mode.');
      expect(action).toBe('build');
      expect(rest).toBe('This needs agent mode.');
    });

    it('detects [DELEGATE:forge]', () => {
      const { action, rest } = parseDelegation('[DELEGATE:forge] Multiple engines should compete.');
      expect(action).toBe('forge');
      expect(rest).toBe('Multiple engines should compete.');
    });

    it('detects [DELEGATE:brainstorm]', () => {
      const { action } = parseDelegation('[DELEGATE:brainstorm] Let\'s get multiple perspectives.');
      expect(action).toBe('brainstorm');
    });

    it('detects [DELEGATE:tribunal]', () => {
      const { action } = parseDelegation('[DELEGATE:tribunal] This needs debate.');
      expect(action).toBe('tribunal');
    });

    it('returns null for non-delegation response', () => {
      const { action, rest } = parseDelegation('Here is my direct answer to your question.');
      expect(action).toBeNull();
      expect(rest).toBe('Here is my direct answer to your question.');
    });

    it('returns null for delegation marker not at start', () => {
      const { action } = parseDelegation('I think [DELEGATE:build] might help here.');
      expect(action).toBeNull();
    });

    it('handles empty response', () => {
      const { action, rest } = parseDelegation('');
      expect(action).toBeNull();
      expect(rest).toBe('');
    });

    it('handles delegation with no explanation', () => {
      const { action, rest } = parseDelegation('[DELEGATE:build]');
      expect(action).toBe('build');
      expect(rest).toBe('');
    });
  });
});
