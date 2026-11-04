import { beforeEach, describe, expect, it, vi } from 'vitest';
import { embedTexts, embedForWorkflow } from './embedding.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), sidecar: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawn }));
vi.mock('@kernlang/agon-support-dedup', () => ({
  resolveDedupSidecar: mocks.sidecar,
  resolveSidecarPython: () => 'fixture-python',
}));

const response = (value: unknown) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sidecar.mockReturnValue('/fixture/embedder.py');
  mocks.spawn.mockReturnValue(response({ model: 'fixture', dims: 2, vectors: [{ id: '0', vector: [1, 0] }] }));
});

describe('RAG embedding caller contracts', () => {
  it('uses the same JSONL protocol and vectors in both callers', () => {
    const expected = { model: 'fixture', dims: 2, vectors: [[1, 0]] };
    expect(embedTexts(['hello\nworld'])).toEqual(expected);
    expect(embedForWorkflow(['hello\nworld'])).toEqual(expected);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    for (const call of mocks.spawn.mock.calls) {
      expect(call).toEqual(['fixture-python', ['/fixture/embedder.py'], expect.objectContaining({
        input: '{"id":"0","text":"hello\\nworld"}\n',
        maxBuffer: 64 * 1024 * 1024,
      })]);
    }
  });

  it('keeps legacy raw metadata and physical metadata coercion', () => {
    mocks.spawn.mockReturnValue(response({ model: 7, dims: '2', vectors: [{ vector: [1, 0] }] }));
    expect(embedTexts(['a'])).toMatchObject({ model: 7, dims: '2' });
    expect(embedForWorkflow(['a'])).toMatchObject({ model: '7', dims: 2 });
  });

  it('does not launch for empty legacy input or a missing asset', () => {
    expect(embedTexts([])).toBeNull();
    expect(mocks.sidecar).not.toHaveBeenCalled();
    mocks.sidecar.mockReturnValue(null);
    expect(embedTexts(['a'])).toBeNull();
    expect(() => embedForWorkflow(['a'])).toThrow('RAG embedder asset is unavailable');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 2, stdout: '', stderr: 'fixture failure\n' }, 'RAG embedder failed: fixture failure'],
    [{ status: 0, stdout: '', stderr: '' }, 'RAG embedder failed: install fastembed and numpy'],
    [response({ vectors: [] }), 'RAG embedder returned the wrong vector count'],
    [response({ model: 'fixture' }), 'RAG embedder returned the wrong vector count'],
  ])('preserves null versus detailed failure for %j', (result, message) => {
    mocks.spawn.mockReturnValue(result);
    expect(embedTexts(['a'])).toBeNull();
    expect(() => embedForWorkflow(['a'])).toThrow(message);
  });

  it.each(['not json', 'null'])('preserves parser failure for %s', (stdout) => {
    mocks.spawn.mockReturnValue({ status: 0, stdout, stderr: '' });
    expect(embedTexts(['a'])).toBeNull();
    expect(() => embedForWorkflow(['a'])).toThrow();
  });

  it('preserves spawn exceptions and the legacy error-field guard', () => {
    mocks.spawn.mockImplementationOnce(() => { throw new Error('spawn fixture'); });
    expect(embedTexts(['a'])).toBeNull();
    mocks.spawn.mockImplementationOnce(() => { throw new Error('spawn fixture'); });
    expect(() => embedForWorkflow(['a'])).toThrow('spawn fixture');
    mocks.spawn.mockReturnValue({ ...response({ model: 'fixture', dims: 1, vectors: [{ vector: [1] }] }), error: new Error('fixture') });
    expect(embedTexts(['a'])).toBeNull();
    expect(embedForWorkflow(['a'])).toEqual({ model: 'fixture', dims: 1, vectors: [[1]] });
  });
});
