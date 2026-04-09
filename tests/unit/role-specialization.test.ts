import { describe, it, expect } from 'vitest';
import { rankByTaskClass, assignForgeRoles } from '../../packages/core/src/generated/blocks/role-specialization.js';

describe('RoleSpecialization', () => {
  describe('rankByTaskClass', () => {
    it('returns roles for all engines', () => {
      const roles = rankByTaskClass(['claude', 'codex', 'gemini'], 'bugfix');
      expect(roles).toHaveLength(3);
      expect(roles.every(r => r.engineId && r.role && r.specialization)).toBe(true);
    });

    it('assigns newcomer role when no history', () => {
      const roles = rankByTaskClass(['brand-new-engine'], 'feature');
      expect(roles[0].role).toBe('newcomer');
    });
  });

  describe('assignForgeRoles', () => {
    it('returns Map with all engines', () => {
      const roles = assignForgeRoles(['claude', 'codex'], 'refactor');
      expect(roles.size).toBe(2);
      expect(roles.has('claude')).toBe(true);
      expect(roles.has('codex')).toBe(true);
    });

    it('each role has role and specialization fields', () => {
      const roles = assignForgeRoles(['claude', 'codex', 'gemini'], 'test');
      for (const [, value] of roles) {
        expect(value.role).toBeTruthy();
        expect(value.specialization).toBeTruthy();
      }
    });
  });
});
