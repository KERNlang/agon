import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { effectivePhi, pickTopRatedEngine, rankEnginesByRating } from '@kernlang/agon-core';
import type { GlickoRating, RatingRecord } from '@kernlang/agon-core';
import { rankNeroCritics, runNero } from '@kernlang/agon-forge';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-09-30T12:00:00.000Z');

const rating = (mu: number, phi: number, lastActive: string): GlickoRating => ({
  mu, phi, sigma: 0.06, wins: 5, losses: 1, lastActive,
});

const daysBefore = (nowMs: number, days: number) => new Date(nowMs - days * DAY_MS).toISOString();

const staleCriticRecord = (nowMs: number): RatingRecord => ({
  global: {},
  byMode: {
    forge: {}, brainstorm: {}, tribunal: {},
    critique: { a: rating(1907, 133, daysBefore(nowMs, 200)), b: rating(1625, 60, daysBefore(nowMs, 0)) },
  },
  byTaskClass: {},
  engineMeta: {},
  lastUpdated: daysBefore(nowMs, 0),
});

describe('effectivePhi', () => {
  it('returns the stored phi for a rating active right now', () => {
    expect(effectivePhi(rating(1600, 100, daysBefore(NOW, 0)), NOW, 90)).toBe(100);
  });

  it('is the midpoint between stored phi and the 350 maximum at half the horizon', () => {
    expect(effectivePhi(rating(1600, 100, daysBefore(NOW, 45)), NOW, 90)).toBeCloseTo(225, 9);
  });

  it('reaches the 350 maximum at the horizon and stays there beyond it', () => {
    expect(effectivePhi(rating(1600, 100, daysBefore(NOW, 90)), NOW, 90)).toBe(350);
    expect(effectivePhi(rating(1600, 100, daysBefore(NOW, 400)), NOW, 90)).toBe(350);
  });

  it('keeps the stored phi when the horizon is 0 or negative', () => {
    expect(effectivePhi(rating(1600, 100, daysBefore(NOW, 200)), NOW, 0)).toBe(100);
    expect(effectivePhi(rating(1600, 100, daysBefore(NOW, 200)), NOW, -5)).toBe(100);
  });

  it('keeps the stored phi when lastActive is missing or unparseable', () => {
    expect(effectivePhi(rating(1600, 100, 'not-a-date'), NOW, 90)).toBe(100);
    expect(effectivePhi({ ...rating(1600, 100, ''), lastActive: undefined as unknown as string }, NOW, 90)).toBe(100);
  });

  it('treats a lastActive in the future as zero elapsed days', () => {
    expect(effectivePhi(rating(1600, 100, daysBefore(NOW, -30)), NOW, 90)).toBe(100);
  });
});

describe('rankEnginesByRating — stale ratings lose their confidence', () => {
  it('ranks a fresh critic above a long-inactive one whose stored floor is higher', () => {
    expect(rankEnginesByRating(['a', 'b'], staleCriticRecord(NOW), 'critique', { now: NOW })).toEqual(['b', 'a']);
  });

  it('defaults to the real clock and the 90-day horizon', () => {
    expect(rankEnginesByRating(['a', 'b'], staleCriticRecord(Date.now()), 'critique')).toEqual(['b', 'a']);
  });

  it('ranks on the stored phi when the horizon is 0', () => {
    expect(rankEnginesByRating(['a', 'b'], staleCriticRecord(NOW), 'critique', { now: NOW, staleHorizonDays: 0 })).toEqual(['a', 'b']);
  });

  it('pickTopRatedEngine applies the same staleness', () => {
    const r = staleCriticRecord(NOW);
    expect(pickTopRatedEngine(['a', 'b'], r, { modes: ['critique', 'tribunal'], now: NOW }).engineId).toBe('b');
    expect(pickTopRatedEngine(['a', 'b'], r, { modes: ['critique', 'tribunal'], now: NOW, staleHorizonDays: 0 }).engineId).toBe('a');
  });

  it('rankNeroCritics threads now and the horizon into the cascade', () => {
    const r = staleCriticRecord(NOW);
    expect(rankNeroCritics(['a', 'b'], r, { now: NOW }).map((p) => p.engineId)).toEqual(['b', 'a']);
    expect(rankNeroCritics(['a', 'b'], r, { now: NOW, staleHorizonDays: 0 }).map((p) => p.engineId)).toEqual(['a', 'b']);
  });
});

describe('runNero — ratingStaleHorizonDays config', () => {
  const registry = { get: (id: string) => ({ id }), list: () => [] } as any;
  const VALID = 'Confidence: 50%\n## Challenge 1\n…\nVERDICT: SOUND';
  const adapter = { dispatch: async () => ({ exitCode: 0, stdout: VALID, stderr: '', durationMs: 1, timedOut: false }) } as any;
  let home: string | undefined;

  afterEach(() => {
    cleanupTestAgonHome(home);
    home = undefined;
  });

  const challenge = () => runNero({
    decision: 'x', engines: ['a', 'b'], ratings: staleCriticRecord(Date.now()), explorationRate: 0,
    registry, adapter, timeout: 30, outputDir: join(home!, 'out'), cwd: home, retryBackoffMs: 0,
  });

  it('demotes the stale critic under the default horizon', async () => {
    home = setupTestAgonHome('nero-stale-default');
    const res = await challenge();
    expect(res.ok).toBe(true);
    expect(res.engineId).toBe('b');
  });

  it('ranks on stored phi when config sets ratingStaleHorizonDays to 0', async () => {
    home = setupTestAgonHome('nero-stale-off');
    writeFileSync(join(home, 'config.json'), JSON.stringify({ ratingStaleHorizonDays: 0 }));
    const res = await challenge();
    expect(res.ok).toBe(true);
    expect(res.engineId).toBe('a');
  });
});
