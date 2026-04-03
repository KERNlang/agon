import { describe, it, expect } from 'vitest';
import { scoutScore } from '../../packages/forge/src/generated/brainstorm.js';
import type { ScoutBid } from '../../packages/core/src/types.js';

function makeBid(overrides: Partial<ScoutBid> = {}): ScoutBid {
  return {
    engineId: 'claude',
    confidence: 80,
    approach: 'Fix the auth middleware',
    steps: ['Read auth.ts', 'Fix token validation', 'Run tests'],
    keyFiles: ['src/auth.ts', 'src/middleware.ts'],
    risk: 'low',
    needsCompetition: false,
    ...overrides,
  };
}

describe('Scout Infrastructure', () => {
  describe('scoutScore', () => {
    it('weights confidence at 40%', () => {
      const high = scoutScore(makeBid({ confidence: 100 }));
      const low = scoutScore(makeBid({ confidence: 0 }));
      // Confidence contributes 40 points max
      expect(high - low).toBeCloseTo(40, 0);
    });

    it('weights keyFiles at 20%', () => {
      const withFiles = scoutScore(makeBid({ keyFiles: ['a', 'b', 'c', 'd', 'e'] }));
      const noFiles = scoutScore(makeBid({ keyFiles: [] }));
      expect(withFiles - noFiles).toBe(20);
    });

    it('weights steps at 20%', () => {
      const withSteps = scoutScore(makeBid({ steps: ['a', 'b', 'c', 'd', 'e'] }));
      const noSteps = scoutScore(makeBid({ steps: [] }));
      expect(withSteps - noSteps).toBe(20);
    });

    it('rewards low risk over high risk', () => {
      const lowRisk = scoutScore(makeBid({ risk: 'low' }));
      const highRisk = scoutScore(makeBid({ risk: 'high' }));
      expect(lowRisk).toBeGreaterThan(highRisk);
      expect(lowRisk - highRisk).toBe(20);
    });

    it('caps keyFiles and steps contributions', () => {
      const capped = scoutScore(makeBid({ keyFiles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], steps: ['1', '2', '3', '4', '5', '6', '7'] }));
      const exact = scoutScore(makeBid({ keyFiles: ['a', 'b', 'c', 'd', 'e'], steps: ['1', '2', '3', '4', '5'] }));
      expect(capped).toBe(exact);
    });

    it('handles empty bid gracefully', () => {
      const score = scoutScore(makeBid({ confidence: 0, keyFiles: [], steps: [], risk: 'high' }));
      expect(score).toBe(0);
    });
  });
});
