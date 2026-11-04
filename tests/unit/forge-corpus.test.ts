import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ path: '' }));
vi.mock('@kernlang/agon-core', () => ({ get CORPUS_PATH() { return state.path; } }));
let root: string;
let corpus: typeof import('../../packages/forge/src/corpus.js');
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agon-corpus-'));
  state.path = join(root, 'corpus.json');
  vi.resetModules();
  corpus = await import('../../packages/forge/src/corpus.js');
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

const artifact = (engineId = 'fixture', validated = true) => ({
  engineId, testScript: 'assert boundary', testPath: 'test.js',
  failureMessage: 'boundary condition', deterministic: true, validated,
});

it('reads a missing corpus without creating a file', () => {
  expect(corpus.loadCorpus()).toMatchObject({ entries: [], patterns: [] });
  expect(existsSync(state.path)).toBe(false);
  expect(corpus.addToCorpus('empty', 'feature', [])).toBe(0);
  expect(existsSync(state.path)).toBe(false);
});

it('warns on malformed stored JSON and keeps the original bytes while reading', () => {
  writeFileSync(state.path, '{broken');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(corpus.loadCorpus()).toMatchObject({ entries: [], patterns: [] });
  expect(warn).toHaveBeenCalledOnce();
  expect(readFileSync(state.path, 'utf8')).toBe('{broken');
});

it('persists only validated artifacts and aggregates their patterns', () => {
  expect(corpus.addToCorpus('run', 'feature', [artifact('a'), artifact('b'), artifact('c'), artifact('rejected', false)])).toBe(3);
  const record = corpus.loadCorpus();
  expect(record.entries.map(entry => entry.artifact.engineId)).toEqual(['a', 'b', 'c']);
  expect(record.patterns).toHaveLength(1);
  expect(corpus.getGapPatterns('feature')).toMatchObject([{ pattern: 'boundary-condition', frequency: 3, skillProposed: false }]);
  expect(corpus.getGapPatterns('docs')).toEqual([]);
  expect(corpus.getCorpusStats()).toMatchObject({ totalEntries: 3, totalPatterns: 1 });
  expect(readFileSync(state.path, 'utf8')).toBe(JSON.stringify(record, null, 2) + '\n');
  expect(existsSync(state.path + '.tmp')).toBe(false);
});

it('retains the most recent 200 entries without discarding pattern history', () => {
  expect(corpus.addToCorpus('run', 'feature', Array.from({ length: 201 }, (_, index) => artifact(String(index))))).toBe(201);
  const record = corpus.loadCorpus();
  expect(record.entries).toHaveLength(200);
  expect(record.entries[0].artifact.engineId).toBe('1');
  expect(record.entries[199].artifact.engineId).toBe('200');
  expect(record.patterns[0].frequency).toBe(201);
});

it('replays by task class and recency and persists only selected replay counts', () => {
  corpus.addToCorpus('run', 'feature', [artifact('old'), artifact('new')]);
  const record = corpus.loadCorpus();
  record.entries[0].timestamp = '2026-01-01T00:00:00.000Z';
  record.entries[1].timestamp = '2026-01-02T00:00:00.000Z';
  corpus.saveCorpus(record);
  expect(corpus.getCorpusForReplay('docs', 10)).toEqual([]);
  expect(corpus.getCorpusForReplay('feature', 1).map(entry => entry.artifact.engineId)).toEqual(['new']);
  expect(corpus.loadCorpus().entries.map(entry => entry.replayCount)).toEqual([0, 1]);
});

it('keeps pattern precedence and excludes already proposed skills', () => {
  expect(corpus.extractPattern('null boundary', '')).toBe('null-handling');
  expect(corpus.extractPattern('ordinary failure', '')).toBeUndefined();
  corpus.addToCorpus('run', 'feature', [artifact(), artifact(), artifact()]);
  const record = corpus.loadCorpus();
  record.patterns[0].skillProposed = true;
  corpus.saveCorpus(record);
  expect(corpus.getGapPatterns()).toEqual([]);
});

it.each([1, 2])('counts each selected replay once when run and engine IDs repeat (limit %s)', (limit) => {
  corpus.addToCorpus('shared-run', 'docs', [artifact()]);
  corpus.addToCorpus('shared-run', 'feature', [artifact(), artifact()]);
  const record = corpus.loadCorpus();
  record.entries.forEach((entry, index) => {
    entry.timestamp = `2026-01-0${index + 1}T00:00:00.000Z`;
  });
  corpus.saveCorpus(record);

  const replayed = corpus.getCorpusForReplay('feature', limit);
  expect(replayed.map(entry => entry.timestamp)).toEqual(
    ['2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z'].slice(0, limit),
  );
  expect(replayed.map(entry => entry.replayCount)).toEqual(Array(limit).fill(1));
  expect(corpus.loadCorpus().entries.map(entry => entry.replayCount)).toEqual(
    limit === 1 ? [0, 0, 1] : [0, 1, 1],
  );
});

it('uses the injected storage location without sharing state between owner instances', async () => {
  const { createForgeCorpus } = await import('@kernlang/agon-mod-forge');
  const first = createForgeCorpus(join(root, 'first', 'corpus.json'));
  const second = createForgeCorpus(join(root, 'second', 'corpus.json'));
  expect(first.addToCorpus('first', 'feature', [artifact()])).toBe(1);
  expect(first.loadCorpus().entries).toHaveLength(1);
  expect(second.loadCorpus().entries).toEqual([]);
  expect(second.addToCorpus('second', 'docs', [artifact()])).toBe(1);
  expect(first.getCorpusForReplay('docs', 10)).toEqual([]);
  expect(second.getCorpusForReplay('docs', 10)).toHaveLength(1);
  expect(existsSync(state.path)).toBe(false);
});

it('does not inspect or replace existing content when constructing the owner', async () => {
  const { createForgeCorpus } = await import('@kernlang/agon-mod-forge');
  writeFileSync(state.path, '{broken');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  createForgeCorpus(state.path);
  expect(warn).not.toHaveBeenCalled();
  expect(readFileSync(state.path, 'utf8')).toBe('{broken');
  expect(existsSync(state.path + '.tmp')).toBe(false);
});

it('preserves synchronous save errors and caller timestamp updates', () => {
  const record = { entries: [], patterns: [], lastUpdated: 'old' };
  mkdirSync(state.path);
  expect(() => corpus.saveCorpus(record)).toThrow();
  expect(record.lastUpdated).not.toBe('old');
});

it('preserves an empty stored record for all-invalid nonempty input', () => {
  expect(corpus.addToCorpus('run', 'feature', [artifact('invalid', false)])).toBe(0);
  expect(existsSync(state.path)).toBe(true);
  expect(corpus.loadCorpus()).toMatchObject({ entries: [], patterns: [] });
});

it('does not rewrite stored bytes when historical entries cannot be replayed', () => {
  corpus.addToCorpus('run', 'feature', [artifact()]);
  const record = corpus.loadCorpus();
  record.entries[0].artifact.validated = false;
  corpus.saveCorpus(record);
  const bytes = readFileSync(state.path, 'utf8');
  expect(corpus.getCorpusForReplay('feature', 10)).toEqual([]);
  expect(readFileSync(state.path, 'utf8')).toBe(bytes);
});
