import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tapDispatchIdentities, updateGlickoRanked } from '@kernlang/agon-core';
import { runBrainstorm } from '@kernlang/agon-forge';
import type { GlickoRating, RatingRecord } from '@kernlang/agon-core';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const ACTIVE = '2026-09-01T00:00:00.000Z';

const rating = (mu: number, phi: number, wins = 4, losses = 2): GlickoRating => ({
  mu, phi, sigma: 0.06, wins, losses, lastActive: ACTIVE,
});

const meta = (extra: Record<string, unknown> = {}) => ({
  firstSeen: '2026-01-01T00:00:00.000Z', lastActive: ACTIVE, matchCount: 6, derivedFrom: null, versions: [] as string[], ...extra,
});

const legacyRecord = (): RatingRecord => ({
  global: { a: rating(1700, 80), b: rating(1500, 90) },
  byMode: { forge: {}, brainstorm: {}, tribunal: { a: rating(1750, 70) }, critique: { a: rating(1800, 60) } },
  byTaskClass: { bugfix: { a: rating(1650, 100) } },
  engineMeta: { a: meta(), b: meta() } as RatingRecord['engineMeta'],
  lastUpdated: ACTIVE,
});

const tied = (ids: string[]) => ids.map((engineId) => ({ engineId, score: 1 }));

describe('updateGlickoRanked — model identity', () => {
  let home: string;
  const file = () => join(home, 'ratings.json');
  const seed = (record: RatingRecord) => writeFileSync(file(), JSON.stringify(record, null, 2));
  const read = (): RatingRecord => JSON.parse(readFileSync(file(), 'utf-8'));
  const withoutStamp = (record: RatingRecord) => ({ ...record, lastUpdated: '' });
  const observe = (identity: string | null) => updateGlickoRanked(tied(['a', 'b']), 'bugfix', 'tribunal', { a: identity });
  const seededWithIdentity = (identity: string) => {
    const record = legacyRecord();
    (record.engineMeta.a as Record<string, unknown>).identity = identity;
    seed(record);
    return record;
  };

  beforeEach(() => { home = setupTestAgonHome('rating-identity'); });
  afterEach(() => cleanupTestAgonHome(home));

  it('AC-7 legacy file with no identity keys: the first sighting records the identity and changes nothing else', () => {
    seed(legacyRecord());
    updateGlickoRanked(tied(['a', 'b']), 'bugfix', 'tribunal', { a: 'model-A', b: null });

    const expected = legacyRecord();
    (expected.engineMeta.a as Record<string, unknown>).identity = 'model-A';
    expect(withoutStamp(read())).toEqual(withoutStamp(expected));
  });

  it('AC-7 a legacy file with no engineMeta at all: the first sighting creates the meta entry instead of throwing', () => {
    const { engineMeta: _dropped, ...legacy } = legacyRecord();
    writeFileSync(file(), JSON.stringify(legacy, null, 2));
    expect(() => updateGlickoRanked(tied(['a', 'b']), 'bugfix', 'tribunal', { a: 'model-A' })).not.toThrow();
    expect(read().engineMeta.a).toMatchObject({ identity: 'model-A' });
  });

  it('AC-7 a null current identity never triggers a reset or a pending state', () => {
    const before = seededWithIdentity('A');
    for (let i = 0; i < 3; i++) observe(null);
    expect(withoutStamp(read())).toEqual(withoutStamp(before));
  });

  it('AC-7 A,B,A: a one-off identity is debounced and the pending state clears', () => {
    const before = seededWithIdentity('A');
    observe('B');
    expect(read().engineMeta.a).toMatchObject({ identity: 'A', pendingIdentity: 'B', pendingCount: 1 });
    expect(read().global.a).toEqual(before.global.a);

    observe('A');
    expect(withoutStamp(read())).toEqual(withoutStamp(before));
  });

  it('AC-7 A,B,B resets on the second B; A,B,B,A,A resets again back to A', () => {
    seededWithIdentity('A');
    observe('B');
    expect(read().global.a.phi).toBe(80);
    observe('B');
    const afterFirst = read();
    expect(afterFirst.engineMeta.a).toMatchObject({ identity: 'B', versions: ['A'] });
    expect(afterFirst.engineMeta.a).not.toHaveProperty('pendingIdentity');
    expect(afterFirst.global.a).toMatchObject({ mu: 1700, phi: 350, wins: 0, losses: 0 });

    updateGlickoRanked([{ engineId: 'a', score: 2 }, { engineId: 'b', score: 1 }], 'bugfix', 'tribunal', { a: 'B' });
    expect(read().global.a.phi).toBeLessThan(350);
    expect(read().global.a.wins).toBe(1);

    observe('A');
    expect(read().engineMeta.a).toMatchObject({ identity: 'B', pendingIdentity: 'A', pendingCount: 1 });
    observe('A');
    const afterSecond = read();
    expect(afterSecond.engineMeta.a).toMatchObject({ identity: 'A', versions: ['A', 'B'] });
    expect(afterSecond.global.a).toMatchObject({ phi: 350, wins: 0, losses: 0 });
  });

  it('AC-7 a confirmed change resets phi, wins and losses in every scope of that engine only, keeping mu', () => {
    const before: RatingRecord = {
      global: { a: rating(1700, 80, 9, 3), b: rating(1500, 90) },
      byMode: {
        forge: { a: rating(1600, 110, 2, 5), b: rating(1550, 95) },
        brainstorm: {},
        tribunal: { a: rating(1750, 70, 12, 1), b: rating(1450, 85) },
        critique: { a: rating(1800, 60, 30, 0), b: rating(1400, 75) },
      },
      byTaskClass: { bugfix: { a: rating(1650, 100), b: rating(1500, 100) }, feature: { a: rating(1620, 120, 1, 1) } },
      engineMeta: { a: meta({ identity: 'A', pendingIdentity: 'B', pendingCount: 1 }), b: meta({ identity: 'X' }) } as RatingRecord['engineMeta'],
      lastUpdated: ACTIVE,
    };
    seed(before);
    updateGlickoRanked(tied(['a', 'b']), 'bugfix', 'tribunal', { a: 'B', b: 'X' });

    const reset = (g: GlickoRating): GlickoRating => ({ ...g, phi: 350, wins: 0, losses: 0 });
    const expected: RatingRecord = JSON.parse(JSON.stringify(before));
    expected.global.a = reset(before.global.a);
    expected.byMode.forge.a = reset(before.byMode.forge.a);
    expected.byMode.tribunal.a = reset(before.byMode.tribunal.a);
    expected.byMode.critique.a = reset(before.byMode.critique.a);
    expected.byTaskClass.bugfix.a = reset(before.byTaskClass.bugfix.a);
    expected.byTaskClass.feature.a = reset(before.byTaskClass.feature.a);
    expected.engineMeta.a = meta({ identity: 'B', versions: ['A'] }) as RatingRecord['engineMeta'][string];
    expect(withoutStamp(read())).toEqual(withoutStamp(expected));
  });

  it('AC-7 reads the confirmation count from ratingIdentityConfirmRuns', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ ratingIdentityConfirmRuns: 1 }));
    seededWithIdentity('A');
    observe('B');
    expect(read().engineMeta.a).toMatchObject({ identity: 'B', versions: ['A'] });
    expect(read().global.a.phi).toBe(350);
  });
});

describe('dispatch identities reach the rating write', () => {
  let home: string;
  beforeEach(() => { home = setupTestAgonHome('rating-identity-callers'); });
  afterEach(() => cleanupTestAgonHome(home));

  it('tapDispatchIdentities keeps the last known identity per engine and passes other methods through', async () => {
    const results: Record<string, unknown[]> = {
      a: [{ exitCode: 0, stdout: 'x', identity: 'model-A' }, { exitCode: 0, stdout: 'x', identity: null }],
      b: [{ exitCode: 0, stdout: 'x' }],
    };
    const adapter = {
      dispatch: async (o: { engine: { id: string } }) => results[o.engine.id].shift(),
      dispatchAgent: async () => ({ exitCode: 0, stdout: 'x', identity: 'agent-B' }),
      getVersion: async () => 'v1',
    } as any;
    const tap = tapDispatchIdentities(adapter);
    await tap.adapter.dispatch({ engine: { id: 'a' } } as any);
    await tap.adapter.dispatch({ engine: { id: 'a' } } as any);
    await tap.adapter.dispatch({ engine: { id: 'b' } } as any);
    await tap.adapter.dispatchAgent!({ engine: { id: 'b' } } as any);
    expect(tap.identities()).toEqual({ a: 'model-A', b: 'agent-B' });
    expect(await tap.adapter.getVersion({} as any)).toBe('v1');
  });

  it('brainstorm passes the identities its dispatches reported', async () => {
    const draft = 'draft {\n  approach: "queue"\n  reasoning: "decouple"\n  confidence: 70\n  steps {\n    1: "one"\n  }\n}';
    const adapter = {
      dispatch: async (o: { engine: { id: string } }) => ({ exitCode: 0, stdout: draft, stderr: '', timedOut: false, identity: `model-${o.engine.id}` }),
    } as any;
    const registry = { get: (id: string) => ({ id, binary: id }), list: () => [], findBinary: () => null } as any;
    await runBrainstorm({ question: 'how should we cache?', engines: ['e1', 'e2'], registry, adapter, timeout: 5, outputDir: join(home, 'out') });
    const stored = JSON.parse(readFileSync(join(home, 'ratings.json'), 'utf-8')) as RatingRecord;
    expect((stored.engineMeta.e1 as Record<string, unknown>).identity).toBe('model-e1');
    expect((stored.engineMeta.e2 as Record<string, unknown>).identity).toBe('model-e2');
  });
});
