import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runRagVectorStoreConformance, validateRagVectorStoreAdapterManifest } from '@kernlang/core';
import { analyzeKernSourceCapabilities, executeKernSource } from '@kernlang/core/runner';
import { adapterNamespaceDir, createAgonRagVectorStoreContract } from '../../packages/core/src/generated/rag/adapter.js';
import { classifyRuntimePilotChange } from '../../packages/core/src/generated/workflows/runtime-pilot.js';
import { loadRagIndexAt, saveRagIndexAt } from '../../packages/core/src/rag.js';

const tempDirs: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agon-rag-adapter-'));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('Agon persistent RAG adapter', () => {
  it('confines explicit-directory persistence keys to one path segment', () => {
    const root = tempRoot();
    const manifest = { corpusHash: '../escape', model: 'test', dims: 2, chunkCount: 0, files: [], builtAt: 0 };
    expect(() => saveRagIndexAt(root, manifest, [], new Float32Array())).toThrow(/confined path segment/);
    expect(() => loadRagIndexAt(root, '../escape')).toThrow(/confined path segment/);
  });

  it('does not prune unrelated explicit-directory siblings by default', () => {
    const root = tempRoot();
    const unrelated = join(root, 'keep.txt');
    writeFileSync(unrelated, 'keep');
    const manifest = { corpusHash: 'index', model: 'test', dims: 2, chunkCount: 0, files: [], builtAt: 0 };
    saveRagIndexAt(root, manifest, [], new Float32Array());
    expect(readFileSync(unrelated, 'utf8')).toBe('keep');
  });

  it('passes the complete published KERN 4.5 vector-store conformance profile', () => {
    const contract = createAgonRagVectorStoreContract(tempRoot());
    expect(validateRagVectorStoreAdapterManifest(contract.manifest)).toEqual({ valid: true, errors: [] });

    const report = runRagVectorStoreConformance({
      manifest: contract.manifest,
      createStore: contract.createStore,
      runId: 'agon-persistent-adapter',
    });

    expect(report.passed).toBe(true);
    expect(report.summary).toEqual({ passed: 14, failed: 0, skipped: 0 });
  });

  it('preserves citation, metadata, vectors, and namespace data across reopen', () => {
    const contract = createAgonRagVectorStoreContract(tempRoot());
    const context = { fingerprint: 'test-fingerprint', dims: 2, namespace: '../citation namespace' };
    const first = contract.createStore(context);
    first.upsert({
      id: 'guide', text: 'agent guide', source: 'docs/guide.md',
      citation: { uri: 'docs/guide.md', locator: 'L8-12' },
      metadata: { audience: 'agents' },
    }, new Float64Array([1, 0]));
    first.close();

    const reopened = contract.createStore(context);
    expect(reopened.snapshot().entries).toEqual([{
      chunk: {
        id: 'guide', text: 'agent guide', source: 'docs/guide.md',
        citation: { uri: 'docs/guide.md', locator: 'L8-12' },
        metadata: { audience: 'agents' },
      },
      vector: [1, 0],
      fingerprint: 'test-fingerprint',
    }]);
    expect(reopened.search('guide', new Float64Array([1, 0])).chunks[0]).toEqual(expect.objectContaining({
      id: 'guide', citation: { uri: 'docs/guide.md', locator: 'L8-12' }, metadata: { audience: 'agents' },
    }));
    reopened.close();
  });

  it('durably persists single upserts before close and merges stale handles safely', () => {
    const contract = createAgonRagVectorStoreContract(tempRoot());
    const context = { fingerprint: 'test-fingerprint', dims: 2, namespace: 'shared' };
    const first = contract.createStore(context);
    const stale = contract.createStore(context);

    first.upsert({ id: 'first', text: 'first', source: 'first.md' }, new Float64Array([1, 0]));
    stale.upsert({ id: 'second', text: 'second', source: 'second.md' }, new Float64Array([0, 1]));

    const observer = contract.createStore(context);
    expect(observer.snapshot().entries.map((entry: { chunk: { id: string } }) => entry.chunk.id)).toEqual(['first', 'second']);
    first.close();
    stale.close();
    observer.close();

    const reopened = contract.createStore(context);
    expect(reopened.snapshot().entries.map((entry: { chunk: { id: string } }) => entry.chunk.id)).toEqual(['first', 'second']);
    reopened.close();
  });

  it('validates an entire batch before mutating durable state', () => {
    const contract = createAgonRagVectorStoreContract(tempRoot());
    const context = { fingerprint: 'test-fingerprint', dims: 2, namespace: 'batch' };
    const store = contract.createStore(context);

    expect(() => store.upsertMany([
      { chunk: { id: 'valid', text: 'valid', source: 'valid.md' }, vector: new Float64Array([1, 0]) },
      { chunk: { id: 'invalid', text: 'invalid', source: 'invalid.md' }, vector: new Float64Array([1]) },
    ])).toThrow(/expected 2 dimensions/);
    expect(store.snapshot().entries).toEqual([]);
    expect(() => store.upsertMany([
      { chunk: { id: 'valid', text: 'valid', source: 'valid.md' }, vector: new Float64Array([1, 0]) },
      { chunk: { id: 'bad-metadata', text: 'bad', source: 'bad.md', metadata: [] }, vector: new Float64Array([0, 1]) },
    ])).toThrow(/metadata must be a plain object/);
    expect(store.snapshot().entries).toEqual([]);
    expect(() => store.upsert(
      { id: 'nan', text: 'nan', source: 'nan.md' },
      new Float64Array([Number.NaN, 0]),
    )).toThrow(/non-finite value/);
    expect(store.snapshot().entries).toEqual([]);
    store.close();
  });

  it('fails closed instead of overwriting a corrupt persisted namespace', () => {
    const root = tempRoot();
    const contract = createAgonRagVectorStoreContract(root);
    const context = { fingerprint: 'test-fingerprint', dims: 2, namespace: 'corrupt' };
    const store = contract.createStore(context);
    store.upsert({ id: 'saved', text: 'saved', source: 'saved.md' }, new Float64Array([1, 0]));
    store.close();
    writeFileSync(join(adapterNamespaceDir(root, context.namespace), 'index', 'chunks.jsonl'), 'not-json\n');

    expect(() => contract.createStore(context)).toThrow(/corrupt or structurally invalid/);
  });

  it('uses true cosine ranking for non-normalized external vectors', () => {
    const contract = createAgonRagVectorStoreContract(tempRoot());
    const store = contract.createStore({ fingerprint: 'test-fingerprint', dims: 2, namespace: 'cosine' });
    store.upsertMany([
      { chunk: { id: 'magnitude', text: 'magnitude', source: 'magnitude.md' }, vector: new Float64Array([100, 1]) },
      { chunk: { id: 'direction', text: 'direction', source: 'direction.md' }, vector: new Float64Array([1, 1]) },
    ]);

    const result = store.search('direction', new Float64Array([0, 2]), { topK: 2 });
    expect(result.chunks.map((chunk: { id: string }) => chunk.id)).toEqual(['direction', 'magnitude']);
    expect(result.chunks.every((chunk: { score: number }) => chunk.score > 0 && chunk.score <= 1)).toBe(true);
    store.close();
  });
});

describe('KERN 4.5 direct source-runner pilot', () => {
  it.each([
    ['docs', 'live'],
    ['bounded-code', 'review'],
    ['cross-contract', 'plan'],
  ])('matches compiled policy for %s without host capabilities', (changeKind, expected) => {
    const sourcePath = join(process.cwd(), 'packages/core/src/kern/workflows/runtime-pilot.kern');
    const source = readFileSync(sourcePath, 'utf8')
      .concat(`\nfn name=main returns=void\n  handler lang="kern"\n    print value="classifyRuntimePilotChange('${changeKind}')"\n`);
    const analysis = analyzeKernSourceCapabilities(source, { entryHandlerName: 'main' });

    expect(analysis.hasParseErrors).toBe(false);
    expect(analysis.requirements).toEqual([]);
    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.plannedCapabilities).toEqual([]);
    expect(executeKernSource(source).trim()).toBe(expected);
    expect(classifyRuntimePilotChange(changeKind)).toBe(expected);
  });
});
