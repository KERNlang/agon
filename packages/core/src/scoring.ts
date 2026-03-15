import type { FitnessResult, ScoreWeights, ScoreComponents } from './types.js';

/**
 * Revised scoring weights (correctness-dominant).
 *
 * | Component          | Weight | Rationale                        |
 * |--------------------|--------|----------------------------------|
 * | Pass (correctness) |   50%  | Tests passing is the #1 signal   |
 * | Quality (lint+style)|  20%  | Single quality metric             |
 * | Diff size          |   15%  | Tiebreaker, not dominant          |
 * | Files changed      |   10%  | Prefer focused changes            |
 * | Duration           |    5%  | Minor signal                      |
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  pass: 50,
  quality: 20,
  diff: 15,
  files: 10,
  duration: 5,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Compute individual component scores (all 0–100).
 */
function computeComponents(result: FitnessResult): Omit<ScoreComponents, 'composite'> {
  // Hard filter: fail → 0, no-op → 0
  if (!result.pass || result.diffLines === 0) {
    return { passScore: 0, qualityScore: 0, diffScore: 0, filesScore: 0, durationScore: 0 };
  }

  // Pass: always 100 when passing (gate, not gradient)
  const passScore = 100;

  // Quality: merged lint + style
  // lint component: 100 - (warnings * 5), floor 0
  const lintScore = clamp(100 - result.lintWarnings * 5, 0, 100);
  // style passed through directly (0-100)
  const styleNorm = clamp(result.styleScore, 0, 100);
  // Average of lint and style
  const qualityScore = Math.round((lintScore + styleNorm) / 2);

  // Diff: fewer lines = better. 0 lines → 100, 500+ → 0
  const diffScore = clamp(Math.round(100 - (result.diffLines * 100) / 500), 0, 100);

  // Files: fewer = better. 1 file → 100, 10+ → 0
  const filesScore = clamp(Math.round(100 - (result.filesChanged - 1) * 11), 0, 100);

  // Duration: 0-10s → 100, 600s+ → 0
  const durationScore = result.durationSec <= 10
    ? 100
    : clamp(Math.round(100 - ((result.durationSec - 10) * 100) / 590), 0, 100);

  return { passScore, qualityScore, diffScore, filesScore, durationScore };
}

/**
 * Compute the composite forge score.
 *
 * Hard filters:
 * - `pass === false` → composite = 0
 * - `diffLines === 0` → composite = 0 (no-op guard)
 */
export function computeScore(
  result: FitnessResult,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): ScoreComponents {
  const components = computeComponents(result);

  if (!result.pass || result.diffLines === 0) {
    return { ...components, composite: 0 };
  }

  const composite = clamp(
    Math.round(
      (components.passScore * weights.pass +
        components.qualityScore * weights.quality +
        components.diffScore * weights.diff +
        components.filesScore * weights.files +
        components.durationScore * weights.duration) /
        100,
    ),
    0,
    100,
  );

  return { ...components, composite };
}

/**
 * Deterministic tiebreaker comparison.
 * Returns negative if a wins, positive if b wins, 0 if truly tied.
 * Order: score → lintWarnings(fewer) → styleScore(higher) → diffLines(fewer) → filesChanged(fewer) → duration(faster)
 */
export function tiebreak(a: FitnessResult, b: FitnessResult): number {
  const aScore = computeScore(a).composite;
  const bScore = computeScore(b).composite;
  if (aScore !== bScore) return bScore - aScore;

  // Fewer lint warnings is better
  if (a.lintWarnings !== b.lintWarnings) return a.lintWarnings - b.lintWarnings;

  // Higher style score is better
  if (a.styleScore !== b.styleScore) return b.styleScore - a.styleScore;

  // Fewer diff lines is better
  if (a.diffLines !== b.diffLines) return a.diffLines - b.diffLines;

  // Fewer files changed is better
  if (a.filesChanged !== b.filesChanged) return a.filesChanged - b.filesChanged;

  // Faster is better
  return a.durationSec - b.durationSec;
}
