import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  synthesisRoutingAdvice,
  buildSynthesisJudgePrompt,
  parseSynthesisJudgeOutput,
} from '../../packages/forge/src/generated/synthesis-modus.js';

// Regex-only classification (no Python sidecar) keeps these deterministic.
const PRIOR_DISABLE = process.env.AGON_DISABLE_CLASSIFIER_SIDECAR;
beforeAll(() => { process.env.AGON_DISABLE_CLASSIFIER_SIDECAR = '1'; });
afterAll(() => {
  if (PRIOR_DISABLE === undefined) delete process.env.AGON_DISABLE_CLASSIFIER_SIDECAR;
  else process.env.AGON_DISABLE_CLASSIFIER_SIDECAR = PRIOR_DISABLE;
});

// ── Cheap win #1: forge-routing guard ────────────────────────────────────
// synthesis picks a winner by LLM judgment with no fitness test. For code
// that can be tested, forge selects by proven correctness. The guard nudges
// the user there for code-shaped tasks, and stays quiet for prose/ambiguous.
describe('synthesisRoutingAdvice', () => {
  it('advises forge for testable code tasks', () => {
    for (const prompt of [
      'Fix the bug in the auth token refresh handler',
      'Implement a new rate-limiter feature for the API',
      'Refactor the scoring module to remove duplication',
    ]) {
      const advice = synthesisRoutingAdvice(prompt);
      expect(advice, prompt).toBeTruthy();
      expect(advice!.toLowerCase()).toContain('forge');
    }
  });

  it('stays quiet for prose / non-code tasks (synthesis is the right tool)', () => {
    expect(synthesisRoutingAdvice('Write a README explaining the architecture')).toBeNull();
    expect(synthesisRoutingAdvice('Draft a product positioning statement for launch')).toBeNull();
  });
});

// ── Cheap win #2: judge calibration ──────────────────────────────────────
// The judge must emit a per-entry confidence and name the edge case each
// entry fails to handle — cheap metacognition that surfaces "does this handle
// realpath canonicalization?" before a confident-but-wrong artifact is crowned.
describe('buildSynthesisJudgePrompt — calibration', () => {
  it('asks the judge for per-entry confidence and the unhandled edge case', () => {
    const prompt = buildSynthesisJudgePrompt('do a thing', [
      { engineId: 'claude', content: 'draft a' },
      { engineId: 'codex', content: 'draft b' },
    ]);
    expect(prompt).toContain('CONFIDENCE_');
    expect(prompt).toContain('UNHANDLED_');
    expect(prompt.toLowerCase()).toMatch(/edge case|does not handle|fails? to handle/);
  });
});

describe('parseSynthesisJudgeOutput — calibration', () => {
  it('parses per-entry confidence and unhandled edge case alongside score', () => {
    const text = [
      '## ENTRY 1 - claude',
      'solid but narrow.',
      '## ENTRY 2 - codex',
      'broad, looks complete.',
      '',
      'SCORE_1: 80',
      'CONFIDENCE_1: 0.75',
      'UNHANDLED_1: empty input',
      'SCORE_2: 91',
      'CONFIDENCE_2: 0.4',
      'UNHANDLED_2: macOS /private symlink canonicalization',
      'WINNER: "codex"',
      'REASONING: "codex is most complete"',
    ].join('\n');

    const { scores, winner, reasoning } = parseSynthesisJudgeOutput(text, ['claude', 'codex']);

    expect(winner).toBe('codex');
    expect(reasoning).toBe('codex is most complete');
    expect(scores[0]).toMatchObject({ engineId: 'claude', score: 80, confidence: 0.75, unhandled: 'empty input' });
    expect(scores[1]).toMatchObject({ engineId: 'codex', score: 91, confidence: 0.4, unhandled: 'macOS /private symlink canonicalization' });
  });

  it('leaves calibration fields undefined when the judge omits them (back-compat)', () => {
    const text = ['SCORE_1: 50', 'WINNER: "claude"', 'REASONING: "ok"'].join('\n');
    const { scores } = parseSynthesisJudgeOutput(text, ['claude']);
    expect(scores[0].score).toBe(50);
    expect(scores[0].confidence).toBeUndefined();
    expect(scores[0].unhandled).toBeUndefined();
  });

  it('normalizes 0-100 / percentage confidence into 0..1 and suppresses punctuated "none"', () => {
    const text = [
      'SCORE_1: 60', 'CONFIDENCE_1: 75', 'UNHANDLED_1: None.',
      'SCORE_2: 70', 'CONFIDENCE_2: 40%', 'UNHANDLED_2: race condition',
      'WINNER: "b"', 'REASONING: "x"',
    ].join('\n');
    const { scores } = parseSynthesisJudgeOutput(text, ['a', 'b']);
    expect(scores[0].confidence).toBeCloseTo(0.75);   // "75" → 0.75, not clamped to 1
    expect(scores[0].unhandled).toBeUndefined();        // "None." suppressed
    expect(scores[1].confidence).toBeCloseTo(0.40);   // "40%" → 0.40
    expect(scores[1].unhandled).toBe('race condition');
  });

  it('tolerates markdown-wrapped score, confidence, unhandled, winner, and reasoning labels', () => {
    const text = [
      '**SCORE_1:** 82',
      '**CONFIDENCE_1:** 74%',
      '**UNHANDLED_1:** none',
      '*SCORE-2:* 91',
      '_CONFIDENCE-2:_ 0.88',
      '**UNHANDLED-2:** empty state',
      '**WINNER:** **ENTRY_2**',
      '**REASONING:** second is stronger',
    ].join('\n');

    const { scores, winner, reasoning } = parseSynthesisJudgeOutput(text, ['kimi', 'minimax-api']);

    expect(winner).toBe('minimax-api');
    expect(reasoning).toBe('second is stronger');
    expect(scores[0]).toMatchObject({ engineId: 'kimi', score: 82, confidence: 0.74 });
    expect(scores[0].unhandled).toBeUndefined();
    expect(scores[1]).toMatchObject({ engineId: 'minimax-api', score: 91, confidence: 0.88, unhandled: 'empty state' });
  });

  it('does not confuse lower entry labels with entry 10', () => {
    const engineIds = Array.from({ length: 10 }, (_, i) => `engine-${i + 1}`);
    const text = [
      'SCORE_1: 10',
      'SCORE_10: 99',
      'WINNER: ENTRY_10',
      'REASONING: tenth wins',
    ].join('\n');

    const { scores, winner } = parseSynthesisJudgeOutput(text, engineIds);

    expect(winner).toBe('engine-10');
    expect(scores.find((s) => s.engineId === 'engine-1')?.score).toBe(10);
    expect(scores.find((s) => s.engineId === 'engine-10')?.score).toBe(99);
  });
});
