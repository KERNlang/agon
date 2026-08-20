import { describe, it, expect, afterEach } from 'vitest';
import { rankByTaskClass, assignForgeRoles } from '../../packages/core/src/blocks/role-specialization.js';
import { loadRatings, saveRatings } from '../../packages/core/src/signals/glicko.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

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

  // ── Ranking metric ──────────────────────────────────────────────────
  // Engines are ranked by the Glicko-2 CONFIDENCE FLOOR (mu - 2*phi), so a
  // high-but-uncertain rating cannot outrank a slightly lower, well-measured
  // one. Ranking by the ceiling (mu + 2*phi) inverts exactly that: brand-new
  // engines with huge deviations would lead every roster.
  describe('rankByTaskClass ranking metric', () => {
    let home = '';

    afterEach(() => {
      cleanupTestAgonHome(home);
      home = '';
    });

    it('prefers the well-measured engine over the high-but-uncertain one', () => {
      home = setupTestAgonHome('role-spec-ratings');
      const record = loadRatings();
      const now = new Date().toISOString();
      record.byTaskClass.bugfix = {
        // floor 1600 - 400 = 1200, ceiling 2000
        uncertain: { mu: 1600, phi: 200, sigma: 0.06, wins: 5, losses: 1, lastActive: now },
        // floor 1400 - 20 = 1380, ceiling 1420
        measured: { mu: 1400, phi: 10, sigma: 0.06, wins: 5, losses: 1, lastActive: now },
      };
      saveRatings(record);

      const roles = rankByTaskClass(['uncertain', 'measured'], 'bugfix');
      expect(roles.map((r) => r.engineId)).toEqual(['measured', 'uncertain']);
    });

    it('ranks a higher floor first when the deviations match', () => {
      home = setupTestAgonHome('role-spec-ratings-tie');
      const record = loadRatings();
      const now = new Date().toISOString();
      record.byTaskClass.bugfix = {
        low: { mu: 1400, phi: 50, sigma: 0.06, wins: 3, losses: 3, lastActive: now },
        high: { mu: 1600, phi: 50, sigma: 0.06, wins: 3, losses: 3, lastActive: now },
      };
      saveRatings(record);

      const roles = rankByTaskClass(['low', 'high'], 'bugfix');
      expect(roles.map((r) => r.engineId)).toEqual(['high', 'low']);
    });
  });
});
