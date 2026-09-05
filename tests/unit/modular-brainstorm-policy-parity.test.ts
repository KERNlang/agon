import { afterEach, expect, it, vi } from 'vitest';
import type { BrainstormDraft } from '../../packages/mod-brainstorm/src/workflow.js';
import type { BrainstormRatingHistory } from '../../packages/mod-brainstorm/src/policy.js';

const state = vi.hoisted(() => ({ history: { byMode: { brainstorm: {} }, global: {} } as BrainstormRatingHistory }));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<object>(), getRatings: () => state.history }));
import * as legacy from '../fixtures/modular-brainstorm-workflow-legacy.js';
import { createBrainstormScoring, structuralScore, scoutScore, assignStances, fallbackParse } from '../../packages/mod-brainstorm/src/policy.js';
afterEach(() => vi.restoreAllMocks());

function draft(length: number): BrainstormDraft {
  return { approach: 'a'.repeat(length), reasoning: 'r'.repeat(length), confidence: 75,
    steps: Array.from({ length: length % 12 }, () => 'step'),
    keyFiles: Array.from({ length: length % 8 }, () => 'file'),
    tradeoffs: Array.from({ length: length % 9 }, () => 'risk') };
}

it('preserves score thresholds, caps and grounded/divergent policies', () => {
  for (const style of [undefined, 'grounded', 'divergent']) {
    for (let length = 0; length < 100; length++) {
      expect(structuralScore(draft(length), style)).toBe(legacy.structuralScore(draft(length), style));
      for (const risk of ['low', 'medium', 'high'] as const) {
        const bid = { ...draft(length), risk, engineId: 'a', needsCompetition: false };
        expect(scoutScore(bid)).toBe(legacy.scoutScore(bid));
      }
    }
  }
});

it('preserves cold-start, mode/global precedence and changing live history', () => {
  const scoring = createBrainstormScoring(() => state.history);
  for (const history of [
    { byMode: { brainstorm: {} }, global: {} },
    { byMode: { brainstorm: {} }, global: { a: { wins: 8, losses: 2 } } },
    { byMode: { brainstorm: { a: { wins: 0, losses: 2 } } }, global: { a: { wins: 8, losses: 2 } } },
    { byMode: { brainstorm: { a: { wins: 1, losses: 9 } } }, global: { a: { wins: 8, losses: 2 } } },
  ]) {
    state.history = history;
    for (const confidence of [-10, 0, 20, 50, 99, 100, 110]) {
      expect(scoring.calibrateConfidence('a', confidence)).toBe(legacy.calibrateConfidence('a', confidence));
      const value = { ...draft(31), confidence };
      expect(scoring.qualityScore('a', value, 'grounded')).toBe(legacy.qualityScore('a', value, 'grounded'));
    }
  }
});

it('retains entry identity, stable ties and the input ordering when ranking', () => {
  state.history = { byMode: { brainstorm: {} }, global: {} };
  const values = ['b', 'a', 'c'].map(engineId => ({ engineId, draft: draft(31), raw: engineId,
    seat: { engineId, ok: true, text: engineId, attempts: 1, failure: null, note: null, detail: null } }));
  const result = createBrainstormScoring(() => state.history).rankDrafts(values);
  expect(result).toEqual(legacy.rankDrafts(values));
  expect(result).not.toBe(values);
  expect(result[0]).toBe(values[0]);
  expect(values.map(value => value.engineId)).toEqual(['b', 'a', 'c']);
});

it.each(['plain prose', 'x'.repeat(250), '{broken}', '{"approach":"hello","confidence":0}',
  '```json\n{"reasoning":"fallback","confidence":80}\n```',
  '{bad} followed by {"approach":"valid"}', '{"nested":{"a":1},"approach":"nested"}'])('preserves fallback parsing: %s', text => {
  expect(fallbackParse(text)).toEqual(legacy.fallbackParse(text));
});

it('preserves stance assignment for empty, full and overflow panels', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.25);
  for (const count of [0, 1, 6, 9]) {
    const engines = Array.from({ length: count }, (_, i) => `engine-${i}`);
    expect(assignStances(engines)).toEqual(legacy.assignStances(engines));
  }
});
