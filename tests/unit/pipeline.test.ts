import { describe, it, expect } from 'vitest';
import { detectIntent, SLASH_COMMANDS } from '../../packages/cli/src/intent.js';

describe('Pipeline', () => {
  describe('Intent Detection — /pipeline', () => {
    it('/pipeline parses task', () => {
      const r = detectIntent('/pipeline fix the auth bug');
      expect(r.type).toBe('pipeline');
      if (r.type === 'pipeline') {
        expect(r.task).toBe('fix the auth bug');
        expect(r.fitnessCmd).toBeNull();
      }
    });

    it('/pipeline with fitness command', () => {
      const r = detectIntent('/pipeline fix login test with npm test');
      expect(r.type).toBe('pipeline');
      if (r.type === 'pipeline') {
        expect(r.fitnessCmd).toBe('npm test');
        expect(r.task).toBe('fix login');
      }
    });

    it('/pipeline with fitness: prefix', () => {
      const r = detectIntent('/pipeline add validation fitness: vitest run');
      expect(r.type).toBe('pipeline');
      if (r.type === 'pipeline') {
        expect(r.fitnessCmd).toBe('vitest run');
      }
    });

    it('/pipe is an alias for /pipeline', () => {
      const r = detectIntent('/pipe fix the bug');
      expect(r.type).toBe('pipeline');
      if (r.type === 'pipeline') {
        expect(r.task).toBe('fix the bug');
      }
    });

    it('/pipeline with no task', () => {
      const r = detectIntent('/pipeline');
      expect(r.type).toBe('pipeline');
      if (r.type === 'pipeline') {
        expect(r.task).toBe('');
      }
    });

    it('natural review-and-fix requests avoid read-only review dispatch', () => {
      const r = detectIntent('review with codex and claude and fix what they find');
      expect(r.type).toBe('auto');
    });
  });

  describe('SLASH_COMMANDS', () => {
    it('/pipeline is in the command list', () => {
      const cmds = SLASH_COMMANDS.map((c: any) => c.cmd);
      expect(cmds).toContain('/pipeline');
    });
  });
});
