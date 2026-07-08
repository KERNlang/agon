// Unit tests for the ratings/history hygiene module behind
// `agon ratings purge-unknown` — the maintenance path that removes rating +
// forge-run-history records for engine ids that are not real engines
// (test doubles like fast/slow/e1 that leaked into the store before the
// suite was AGON_HOME-isolated). No engine dispatch involved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeUnknownEngineIds,
  computeRunManifestPurge,
  purgeUnknownEngineData,
} from '@kernlang/agon-core';
import type { GlickoRating, RatingRecord } from '@kernlang/agon-core';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

const rating = (mu: number): GlickoRating => ({
  mu,
  phi: 60,
  sigma: 0.06,
  wins: 3,
  losses: 2,
  lastActive: new Date().toISOString(),
});

const record = (over: Partial<RatingRecord> = {}): RatingRecord => ({
  global: {},
  byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} },
  byTaskClass: {},
  engineMeta: {},
  lastUpdated: new Date().toISOString(),
  ...over,
});

describe('computeUnknownEngineIds', () => {
  it('flags ids from EVERY scope that are not in the keep set', () => {
    const r = record({
      global: { claude: rating(1700), fast: rating(2100) },
      byMode: { forge: { slow: rating(900) }, brainstorm: {}, tribunal: {}, critique: {} } as RatingRecord['byMode'],
      byTaskClass: { bugfix: { e1: rating(1500) } },
      engineMeta: { staller: { firstSeen: '', lastActive: '', matchCount: 1, derivedFrom: null, versions: [] } } as unknown as RatingRecord['engineMeta'],
    });
    expect(computeUnknownEngineIds(r, ['claude'])).toEqual(['e1', 'fast', 'slow', 'staller']);
  });

  it('returns empty when everything is kept', () => {
    const r = record({ global: { claude: rating(1700), codex: rating(1600) } });
    expect(computeUnknownEngineIds(r, ['claude', 'codex'])).toEqual([]);
  });

  it('matches ids exactly — a keep id never protects a different id by prefix', () => {
    const r = record({ global: { fast: rating(2100), fast2: rating(2100) } });
    expect(computeUnknownEngineIds(r, ['fast'])).toEqual(['fast2']);
  });
});

describe('computeRunManifestPurge', () => {
  const manifests = [
    { file: 'a.json', engines: ['fast', 'slow'], hasEnginesField: true },
    { file: 'b.json', engines: ['claude', 'fast'], hasEnginesField: true },
    { file: 'c.json', engines: [], hasEnginesField: true },
    { file: 'd.json', engines: ['claude', 'codex'], hasEnginesField: true },
  ];

  it('purges only manifests with ZERO kept engines (all-fixture or empty rosters)', () => {
    expect(computeRunManifestPurge(manifests, ['claude', 'codex'])).toEqual(['a.json', 'c.json']);
  });

  it('a manifest with even one real engine is real match history and stays', () => {
    expect(computeRunManifestPurge(manifests, ['claude', 'codex'])).not.toContain('b.json');
  });

  it('malformed or non-forge records (no engines array) are NEVER purged', () => {
    const mixed = [
      ...manifests,
      { file: 'legacy-cesar-plan.json', engines: [], hasEnginesField: false },
      { file: 'corrupt.json', engines: [], hasEnginesField: false },
    ];
    const purged = computeRunManifestPurge(mixed, ['claude', 'codex']);
    expect(purged).toEqual(['a.json', 'c.json']);
  });

  it('legacy callers without the validity flag keep the old behavior', () => {
    expect(computeRunManifestPurge([{ file: 'x.json', engines: ['fast'] }], ['claude'])).toEqual(['x.json']);
  });
});

describe('purgeUnknownEngineData (fs)', () => {
  let home: string;

  const seedStore = (): void => {
    const ratings = record({
      global: { claude: rating(1700), codex: rating(1600), fast: rating(2100), slow: rating(900) },
      byMode: {
        forge: { claude: rating(1700), fast: rating(2100) },
        brainstorm: {},
        tribunal: {},
        critique: { fast0: rating(1800) },
      } as RatingRecord['byMode'],
      byTaskClass: { bugfix: { slow1: rating(950), codex: rating(1600) } },
      engineMeta: {
        claude: { firstSeen: '', lastActive: '', matchCount: 5, derivedFrom: null, versions: [] },
        fast: { firstSeen: '', lastActive: '', matchCount: 5, derivedFrom: null, versions: [] },
      } as unknown as RatingRecord['engineMeta'],
    });
    writeFileSync(agonHomePath('ratings.json'), JSON.stringify(ratings, null, 2));
    mkdirSync(agonHomePath('runs'), { recursive: true });
    writeFileSync(agonHomePath('runs', 'fixture-run.json'), JSON.stringify({ forgeId: 'f1', task: 'x', engines: ['fast', 'slow'] }));
    writeFileSync(agonHomePath('runs', 'real-run.json'), JSON.stringify({ forgeId: 'r1', task: 'y', engines: ['claude', 'codex'] }));
    writeFileSync(agonHomePath('runs', 'mixed-run.json'), JSON.stringify({ forgeId: 'm1', task: 'z', engines: ['claude', 'fast'] }));
  };

  beforeEach(() => {
    home = setupTestAgonHome('ratings-purge');
    seedStore();
  });
  afterEach(() => cleanupTestAgonHome(home));

  it('--dry-run reports candidates and writes NOTHING', () => {
    const before = readFileSync(agonHomePath('ratings.json'), 'utf-8');
    const report = purgeUnknownEngineData({ registryIds: ['claude', 'codex'], dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.ratingsUnknown).toEqual(['fast', 'fast0', 'slow', 'slow1']);
    expect(report.ratingsRemoved).toEqual([]);
    expect(report.runsPurged.map((r) => r.file)).toEqual(['fixture-run.json']);
    expect(report.backupDir).toBeNull();
    expect(readFileSync(agonHomePath('ratings.json'), 'utf-8')).toBe(before);
    expect(readdirSync(agonHomePath('runs')).sort()).toEqual(['fixture-run.json', 'mixed-run.json', 'real-run.json']);
  });

  it('apply removes unknown ids from every ratings scope and keeps real engines byte-identical', () => {
    const report = purgeUnknownEngineData({ registryIds: ['claude', 'codex'], dryRun: false });
    expect(report.ratingsRemoved).toEqual(['fast', 'fast0', 'slow', 'slow1']);
    const after = JSON.parse(readFileSync(agonHomePath('ratings.json'), 'utf-8')) as RatingRecord;
    expect(Object.keys(after.global).sort()).toEqual(['claude', 'codex']);
    expect(Object.keys(after.byMode.forge)).toEqual(['claude']);
    expect(Object.keys(after.byMode.critique)).toEqual([]);
    expect(Object.keys(after.byTaskClass.bugfix)).toEqual(['codex']);
    expect(Object.keys(after.engineMeta)).toEqual(['claude']);
    expect(after.global.claude.mu).toBe(1700);
    expect(after.global.claude.wins).toBe(3);
  });

  it('apply moves all-fixture run manifests to the backup dir and keeps runs that mention a real engine', () => {
    const report = purgeUnknownEngineData({ registryIds: ['claude', 'codex'], dryRun: false });
    expect(report.backupDir).toBeTruthy();
    // backup holds the pre-purge ratings.json and the moved manifest
    expect(existsSync(join(report.backupDir!, 'ratings.json'))).toBe(true);
    expect(existsSync(join(report.backupDir!, 'runs', 'fixture-run.json'))).toBe(true);
    const backedUp = JSON.parse(readFileSync(join(report.backupDir!, 'ratings.json'), 'utf-8')) as RatingRecord;
    expect(Object.keys(backedUp.global)).toContain('fast'); // pre-purge copy
    // live runs dir keeps only real match history
    expect(readdirSync(agonHomePath('runs')).sort()).toEqual(['mixed-run.json', 'real-run.json']);
  });

  it('extraKeepIds protect legacy real engines that are no longer registered', () => {
    const report = purgeUnknownEngineData({ registryIds: ['claude', 'codex'], extraKeepIds: ['fast'], dryRun: false });
    expect(report.ratingsRemoved).toEqual(['fast0', 'slow', 'slow1']);
    const after = JSON.parse(readFileSync(agonHomePath('ratings.json'), 'utf-8')) as RatingRecord;
    expect(Object.keys(after.global).sort()).toEqual(['claude', 'codex', 'fast']);
    // a manifest containing the kept engine is no longer all-unknown → stays
    expect(readdirSync(agonHomePath('runs')).sort()).toEqual(['fixture-run.json', 'mixed-run.json', 'real-run.json']);
  });

  it('a second apply run is a clean no-op', () => {
    purgeUnknownEngineData({ registryIds: ['claude', 'codex'], dryRun: false });
    const report = purgeUnknownEngineData({ registryIds: ['claude', 'codex'], dryRun: false });
    expect(report.ratingsUnknown).toEqual([]);
    expect(report.ratingsRemoved).toEqual([]);
    expect(report.runsPurged).toEqual([]);
  });
});
