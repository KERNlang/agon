import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { glicko, loadRatings as loadModRatings } from '@kernlang/agon-mod-ratings';
import * as core from '../../packages/core/src/signals/glicko.js';
import { readRatingsFile } from '../../packages/mod-ratings/src/storage.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

let home: string;
beforeEach(() => { home = setupTestAgonHome('ratings-runtime'); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); cleanupTestAgonHome(home); });

it('keeps every Core export bound to the physical owner', () => {
  expect(Object.keys(core).sort()).toEqual(Object.keys(glicko).sort());
  for (const key of Object.keys(core) as Array<keyof typeof core>) expect(core[key]).toBe(glicko[key]);
  const source = readFileSync(new URL('../../packages/core/src/signals/glicko.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/node:fs|Math\.|withFileLock|function /);
});

it.each(['{}', '{"byMode":{"custom":{}}}', 'null', '{broken'])('preserves both readers for legacy input %s', text => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeFileSync(join(home, 'ratings.json'), text);
  const quiet = loadModRatings();
  expect(warn).not.toHaveBeenCalled();
  const legacy = core.loadRatings();
  expect(legacy).toEqual(quiet);
  expect(Object.keys(legacy.byMode)).toEqual(expect.arrayContaining(['forge', 'brainstorm', 'tribunal', 'critique']));
  expect(warn).toHaveBeenCalledTimes(text === 'null' || text === '{broken' ? 1 : 0);
});

it('treats a missing store as empty without warnings or writes', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(core.loadRatings().global).toEqual({});
  expect(loadModRatings().global).toEqual({});
  expect(warn).not.toHaveBeenCalled();
  expect(existsSync(join(home, 'ratings.json'))).toBe(false);
});

it('keeps path-resolution failures inside the reader recovery boundary', () => {
  const failure = new Error('home lookup failed');
  const warn = vi.fn();
  expect(readRatingsFile(() => { throw failure; }, warn)).toMatchObject({ global: {}, engineMeta: {} });
  expect(warn).toHaveBeenCalledExactlyOnceWith(failure);
});

it('preserves pairwise updates in every scope and publishes one complete record', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
  expect(core.updateGlicko('winner', 'loser', 'test', 'brainstorm')).toEqual({ winnerMu: 1662, loserMu: 1338 });
  const record = glicko.getRatings();
  for (const scope of [record.global, record.byMode.brainstorm, record.byTaskClass.test]) {
    expect(scope.winner).toMatchObject({ mu: 1662, wins: 1, losses: 0 });
    expect(scope.loser).toMatchObject({ mu: 1338, wins: 0, losses: 1 });
  }
  expect(record.engineMeta.winner.matchCount).toBe(1);
  expect(readFileSync(join(home, 'ratings.json'), 'utf8')).toBe(JSON.stringify(record, null, 2) + '\n');
  expect(existsSync(join(home, 'ratings.json.tmp'))).toBe(false);
  expect(existsSync(join(home, 'ratings.json.lock'))).toBe(false);
});

it('keeps tied ranked entries from competing and retains lineage provenance', () => {
  core.updateGlickoRanked([{ engineId: 'a', score: 90 }, { engineId: 'b', score: 90 }, { engineId: 'c', score: 10 }], 'test', 'forge');
  expect(core.getRatings().global.a.wins).toBe(1);
  expect(core.getRatings().global.b.wins).toBe(1);
  expect(core.getRatings().global.c.losses).toBe(2);
  for (let index = 0; index < 4; index++) core.updateGlicko('a', 'c', 'test', 'forge');
  const registry = { list: () => [{ id: 'successor', derivedFrom: 'a' }] } as Parameters<typeof core.seedNewEnginesFromRegistry>[0];
  expect(core.seedNewEnginesFromRegistry(registry)).toEqual(['successor']);
  expect(core.seedNewEnginesFromRegistry(registry)).toEqual([]);
  expect(core.getRatings().engineMeta.successor.derivedFrom).toBe('a');
  expect(core.getRatings().engineMeta.a.versions).toEqual(['successor']);
});

it('does not mutate the supplied record if directory creation fails', () => {
  const record = core.loadRatings();
  record.lastUpdated = 'unchanged';
  const blocked = join(home, 'not-a-directory');
  writeFileSync(blocked, 'file');
  vi.stubEnv('AGON_HOME', join(blocked, 'child'));
  try {
    expect(() => core.saveRatings(record)).toThrow();
    expect(record.lastUpdated).toBe('unchanged');
  } finally { vi.unstubAllEnvs(); }
});

it.each(['serialize', 'write', 'rename'])('preserves the previous store on a %s failure', failure => {
  const path = join(home, 'ratings.json');
  const temporary = path + '.tmp';
  if (failure === 'rename') mkdirSync(path);
  else writeFileSync(path, 'previous bytes');
  if (failure === 'write') mkdirSync(temporary);
  const record = { global: {}, byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} },
    byTaskClass: {}, engineMeta: {}, lastUpdated: 'previous' };
  if (failure === 'serialize') Object.assign(record, { circular: record });
  expect(() => core.saveRatings(record)).toThrow();
  if (failure !== 'rename') expect(readFileSync(path, 'utf8')).toBe('previous bytes');
  else expect(JSON.parse(readFileSync(temporary, 'utf8'))).toMatchObject({ global: {} });
});
