import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rankByTaskClass, assignForgeRoles } from '../../packages/core/src/blocks/role-specialization.js';
import { loadRatings, saveRatings } from '../../packages/core/src/signals/glicko.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';
import * as ratingsOwner from '@kernlang/agon-mod-ratings';
import { buildSpecializedPrompt } from '../../packages/core/src/blocks/role-specialization.js';
import { readFileSync } from 'node:fs';
import { setEngineStrengths } from '@kernlang/agon-support-engine-runtime';

let home = '';
beforeEach(() => { home = setupTestAgonHome('role-specialization'); });
afterEach(() => { vi.restoreAllMocks(); cleanupTestAgonHome(home); home = ''; });

describe('RoleSpecialization', () => {
  it('uses one Ratings-owned implementation through the Core compatibility exports', () => {
    expect(Reflect.get(ratingsOwner, 'rankByTaskClass')).toBe(rankByTaskClass);
    expect(Reflect.get(ratingsOwner, 'assignForgeRoles')).toBe(assignForgeRoles);
    expect(Reflect.get(ratingsOwner, 'buildSpecializedPrompt')).toBe(buildSpecializedPrompt);
  });
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
    it('keeps experienced roles, newcomer behavior and persisted ratings unchanged', () => {
      const record = loadRatings();
      const lastActive = new Date().toISOString();
      record.byTaskClass.bugfix = Object.fromEntries([
        ['lead-engine', 1600], ['middle-engine', 1500], ['last-engine', 1400],
      ].map(([id, mu]) => [id, { mu, phi: 50, sigma: 0.06, wins: 3, losses: 1, lastActive }]));
      saveRatings(record);
      const before = readFileSync(agonHomePath('ratings.json'));
      const roles = ratingsOwner.rankByTaskClass(['last-engine', 'lead-engine', 'middle-engine'], 'bugfix');
      expect(roles.map(({ engineId, role, confidence }) => ({ engineId, role, confidence }))).toEqual([
        { engineId: 'lead-engine', role: 'lead', confidence: 75 },
        { engineId: 'middle-engine', role: 'specialist', confidence: 75 },
        { engineId: 'last-engine', role: 'challenger', confidence: 75 },
      ]);
      expect(roles.map(role => role.specialization)).toEqual([
        'You are the top-rated engine for bugfix tasks (1500 Glicko, 75% win rate). Lead with your best approach.',
        'You have a 75% win rate on bugfix tasks. Focus on what you do best.',
        'You are the challenger. Focus on what the lead engine might miss: edge cases, error handling, performance pitfalls. Your contrarian perspective is your strength.',
      ]);
      expect(ratingsOwner.rankByTaskClass(['unseen'], 'bugfix')[0]).toMatchObject({ role: 'newcomer', confidence: 50,
        specialization: "You have limited history on bugfix tasks. Bring a fresh perspective — don't follow conventional patterns." });
      expect(ratingsOwner.assignForgeRoles(['last-engine', 'lead-engine', 'middle-engine'], 'bugfix'))
        .toEqual(new Map(roles.map(({ engineId, role, specialization }) => [engineId, { role, specialization }])));
      expect(ratingsOwner.buildSpecializedPrompt('unseen', 'bugfix', 'base prompt')).toBe('base prompt');
      expect(readFileSync(agonHomePath('ratings.json'))).toEqual(before);
    });

    it('reads positive specialization from the existing engine-memory owner', () => {
      setEngineStrengths('known', ['careful tests']);
      const before = readFileSync(agonHomePath('engine-memory.json'));
      const expected = 'base prompt\n\n## YOUR PROFILE (based on past performance)\nYour known strengths: careful tests.';
      expect(ratingsOwner.buildSpecializedPrompt('known', 'bugfix', 'base prompt')).toBe(expected);
      expect(buildSpecializedPrompt('known', 'bugfix', 'base prompt')).toBe(expected);
      expect(readFileSync(agonHomePath('engine-memory.json'))).toEqual(before);
    });

    it.each([2, 3])('uses the combined task/global observation threshold: %s', total => {
      const record = loadRatings();
      const rating = { mu: 1500, phi: 50, sigma: 0.06, wins: 1, losses: 0, lastActive: new Date().toISOString() };
      record.global.known = { ...rating, wins: total - 1 };
      record.byTaskClass.bugfix = { known: rating };
      saveRatings(record);
      expect(ratingsOwner.rankByTaskClass(['known'], 'bugfix')[0]).toMatchObject({
        role: total === 3 ? 'lead' : 'newcomer', confidence: 100,
      });
    });

    it('uses global confidence floor when task ratings tie', () => {
      const record = loadRatings();
      const rating = { mu: 1500, phi: 50, sigma: 0.06, wins: 3, losses: 0, lastActive: new Date().toISOString() };
      record.byTaskClass.bugfix = { low: rating, high: rating };
      record.global = { low: { ...rating, phi: 150 }, high: rating };
      saveRatings(record);
      expect(ratingsOwner.rankByTaskClass(['low', 'high'], 'bugfix').map(role => role.engineId)).toEqual(['high', 'low']);
    });

    it.each([0.25, 0.75])('retains random tie selection without claiming uniform fairness: %s', random => {
      vi.spyOn(Math, 'random').mockReturnValue(random);
      expect(ratingsOwner.rankByTaskClass(['first', 'second'], 'bugfix').map(role => role.engineId))
        .toEqual(random < 0.5 ? ['second', 'first'] : ['first', 'second']);
    });

    it('prefers the well-measured engine over the high-but-uncertain one', () => {
      // loadRatings() JSON.parses the store on every call (or returns a fresh
      // literal when the file is absent), so `record` is this test's own
      // object — there is no module-level ratings singleton to mutate. The
      // store itself is per-test via setupTestAgonHome/AGON_HOME.
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
