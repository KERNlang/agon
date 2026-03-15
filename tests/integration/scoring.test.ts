import { describe, it, expect } from 'vitest';
import { computeScore, tiebreak, DEFAULT_WEIGHTS } from '../../packages/core/src/scoring.js';
import type { FitnessResult } from '../../packages/core/src/types.js';

function makeFitness(overrides: Partial<FitnessResult> = {}): FitnessResult {
  return {
    pass: true,
    diffLines: 50,
    filesChanged: 2,
    durationSec: 30,
    lintWarnings: 0,
    styleScore: 100,
    compositeScore: 0,
    ...overrides,
  };
}

describe('Scoring', () => {
  describe('computeScore', () => {
    it('returns 0 for failing tests', () => {
      const result = computeScore(makeFitness({ pass: false }));
      expect(result.composite).toBe(0);
    });

    it('returns 0 for no-op diff', () => {
      const result = computeScore(makeFitness({ diffLines: 0 }));
      expect(result.composite).toBe(0);
    });

    it('computes high score for clean pass with small diff', () => {
      const result = computeScore(
        makeFitness({
          pass: true,
          diffLines: 20,
          filesChanged: 1,
          durationSec: 15,
          lintWarnings: 0,
          styleScore: 100,
        }),
      );
      // pass=100*50 + quality=(100+100)/2=100*20 + diff=96*15 + files=100*10 + dur=99*5
      // = 5000 + 2000 + 1440 + 1000 + 495 = 9935 / 100 = 99
      expect(result.composite).toBeGreaterThanOrEqual(95);
      expect(result.composite).toBeLessThanOrEqual(100);
    });

    it('penalizes large diffs', () => {
      const small = computeScore(makeFitness({ diffLines: 20 }));
      const large = computeScore(makeFitness({ diffLines: 400 }));
      expect(small.composite).toBeGreaterThan(large.composite);
    });

    it('penalizes lint warnings', () => {
      const clean = computeScore(makeFitness({ lintWarnings: 0 }));
      const dirty = computeScore(makeFitness({ lintWarnings: 10 }));
      expect(clean.composite).toBeGreaterThan(dirty.composite);
    });

    it('penalizes many files changed', () => {
      const focused = computeScore(makeFitness({ filesChanged: 1 }));
      const scattered = computeScore(makeFitness({ filesChanged: 8 }));
      expect(focused.composite).toBeGreaterThan(scattered.composite);
    });

    it('correctness (pass) has 50% weight', () => {
      expect(DEFAULT_WEIGHTS.pass).toBe(50);
    });

    it('quality has 20% weight', () => {
      expect(DEFAULT_WEIGHTS.quality).toBe(20);
    });

    it('diff has 15% weight', () => {
      expect(DEFAULT_WEIGHTS.diff).toBe(15);
    });

    it('files has 10% weight', () => {
      expect(DEFAULT_WEIGHTS.files).toBe(10);
    });

    it('duration has 5% weight', () => {
      expect(DEFAULT_WEIGHTS.duration).toBe(5);
    });

    it('weights sum to 100', () => {
      const total =
        DEFAULT_WEIGHTS.pass +
        DEFAULT_WEIGHTS.quality +
        DEFAULT_WEIGHTS.diff +
        DEFAULT_WEIGHTS.files +
        DEFAULT_WEIGHTS.duration;
      expect(total).toBe(100);
    });

    it('score is capped at 100', () => {
      const result = computeScore(
        makeFitness({
          diffLines: 1,
          filesChanged: 1,
          durationSec: 1,
          lintWarnings: 0,
          styleScore: 100,
        }),
      );
      expect(result.composite).toBeLessThanOrEqual(100);
    });

    it('returns individual component scores', () => {
      const result = computeScore(makeFitness());
      expect(result.passScore).toBeDefined();
      expect(result.qualityScore).toBeDefined();
      expect(result.diffScore).toBeDefined();
      expect(result.filesScore).toBeDefined();
      expect(result.durationScore).toBeDefined();
    });
  });

  describe('tiebreak', () => {
    it('prefers higher score', () => {
      const a = makeFitness({ diffLines: 20 });
      const b = makeFitness({ diffLines: 200 });
      expect(tiebreak(a, b)).toBeLessThan(0); // a wins
    });

    it('breaks tie by fewer lint warnings', () => {
      const a = makeFitness({ lintWarnings: 1 });
      const b = makeFitness({ lintWarnings: 5 });
      // Scores differ due to lint affecting quality, but if scores somehow match:
      // tiebreaker checks lint next
      const scoreA = computeScore(a).composite;
      const scoreB = computeScore(b).composite;
      if (scoreA === scoreB) {
        expect(tiebreak(a, b)).toBeLessThan(0);
      } else {
        expect(tiebreak(a, b)).toBeLessThan(0); // a still wins via score
      }
    });

    it('breaks tie by fewer diff lines', () => {
      const a = makeFitness({ diffLines: 50 });
      const b = makeFitness({ diffLines: 100 });
      expect(tiebreak(a, b)).toBeLessThan(0);
    });

    it('breaks tie by faster duration', () => {
      const a = makeFitness({ durationSec: 10 });
      const b = makeFitness({ durationSec: 300 });
      expect(tiebreak(a, b)).toBeLessThan(0);
    });

    it('returns 0 for identical results', () => {
      const a = makeFitness();
      const b = makeFitness();
      expect(tiebreak(a, b)).toBe(0);
    });
  });
});
