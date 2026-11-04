import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runResearch } from '../../packages/forge/src/research.js';
import type { ResearchOptions } from '../../packages/forge/src/research.js';

const io = vi.hoisted(() => ({
  fetch: vi.fn(), read: vi.fn(), dispatch: vi.fn(), verify: vi.fn(),
  seed: vi.fn(), identities: vi.fn(), rank: vi.fn(), status: vi.fn(), extract: vi.fn(),
}));
vi.mock('@kernlang/agon-core', () => ({
  resolveWorkingDir: () => '/fixture/workspace',
  getRatings: () => ({ global: {} }),
  loadConfig: () => ({ ratingStaleHorizonDays: 30 }),
  pickTopRatedEngine: io.rank,
  resolveCurrentIdentities: io.identities,
  seedNewEnginesFromRegistry: io.seed,
  classifyQuery: () => 'package',
  buildAuthoritativeRequest: () => ({ url: 'https://registry.npmjs.org/-/v1/search?text=fixture', method: 'GET', headers: { Accept: 'application/json' } }),
  parseAuthoritativeResults: () => [{ title: 'Fixture', url: 'https://example.org/source', snippet: 'Discovery snippet' }],
  createWebFetchTool: () => ({ execute: io.read }),
  extractCitations: io.extract,
  verifyCitations: io.verify,
}));

function options(overrides: Partial<ResearchOptions> = {}): ResearchOptions {
  return {
    question: 'npm package fixture', engines: ['selected'], engine: 'selected',
    registry: { get: (id: string) => ({ id }) } as unknown as ResearchOptions['registry'],
    adapter: { dispatch: io.dispatch } as unknown as ResearchOptions['adapter'],
    timeout: 17, outputDir: '/fixture/run', cwd: '/fixture/workspace',
    onStatus: io.status, ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', io.fetch);
  io.fetch.mockResolvedValue({ ok: true, text: async () => '{}' });
  io.read.mockResolvedValue({ ok: true, content: 'Fetched source content' });
  io.dispatch.mockResolvedValue({ stdout: '<think>hidden</think>Answer [1].', timedOut: false });
  io.verify.mockResolvedValue({ total: 2, verified: 2, blocked: 0, rejected: 0, results: [] });
  io.extract.mockReturnValue(['https://example.org/extra']);
  io.identities.mockResolvedValue(new Map());
  io.rank.mockReturnValue({ engineId: 'selected' });
});
afterEach(() => vi.unstubAllGlobals());

describe('legacy Research workflow characterization before owner retirement', () => {
  it('runs discovery, reading, drafting and verification with the historical result shape', async () => {
    const controller = new AbortController();
    const result = await runResearch(options({ signal: controller.signal }));
    expect(io.fetch).toHaveBeenCalledWith('https://registry.npmjs.org/-/v1/search?text=fixture', expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) }));
    expect(io.read).toHaveBeenCalledWith({ url: 'https://example.org/source', maxChars: 3500 }, expect.objectContaining({ cwd: '/fixture/workspace', abortSignal: controller.signal }));
    expect(io.dispatch).toHaveBeenCalledWith(expect.objectContaining({ engine: { id: 'selected' }, cwd: '/fixture/workspace', outputDir: '/fixture/run', timeout: 17, signal: controller.signal }));
    expect(io.dispatch.mock.calls[0][0].prompt).toContain('Fetched source content');
    expect(io.verify).toHaveBeenCalledWith(['https://example.org/source', 'https://example.org/extra'], undefined, 4, controller.signal);
    expect(io.extract).toHaveBeenCalledWith('Answer [1].');
    expect(result).toEqual({
      ok: true, question: 'npm package fixture', intent: 'package', engineId: 'selected',
      answer: 'Answer [1].', outputDir: '/fixture/run',
      sources: [{ title: 'Fixture', url: 'https://example.org/source', snippet: 'Discovery snippet', fetched: true }],
      citations: { total: 2, verified: 2, blocked: 0, rejected: 0, results: [] },
    });
    expect(io.status.mock.calls.flat()).toEqual(['discovering sources (package)…', 'reading 1 sources…', 'selected drafting a grounded answer…', 'verifying citations…']);
    expect(io.identities).not.toHaveBeenCalled();
    expect(io.rank).not.toHaveBeenCalled();
  });

  it('uses discovery snippets when source reading fails and ranks when no engine is forced', async () => {
    io.read.mockRejectedValue(new Error('fixture read failure'));
    io.rank.mockReturnValue({ engineId: 'ranked-second' });
    const result = await runResearch(options({ engine: undefined, engines: ['first', 'ranked-second'] }));
    expect(result.ok).toBe(true);
    expect(result.engineId).toBe('ranked-second');
    expect(result.sources[0].fetched).toBe(false);
    expect(io.dispatch.mock.calls[0][0].engine.id).toBe('ranked-second');
    expect(io.dispatch.mock.calls[0][0].prompt).toContain('Discovery snippet');
    expect(io.identities).toHaveBeenCalledOnce();
    expect(io.rank).toHaveBeenCalledWith(['first', 'ranked-second'], { global: {} }, expect.objectContaining({ staleHorizonDays: 30 }));
  });

  it('verifies duplicate source and answer URLs only once', async () => {
    io.extract.mockReturnValue(['https://example.org/source', 'https://example.org/extra', 'https://example.org/extra']);
    await runResearch(options());
    expect(io.verify.mock.calls[0][0]).toEqual(['https://example.org/source', 'https://example.org/extra']);
  });

  it('records rejected citations without redefining legacy ok as physical grounding', async () => {
    io.verify.mockResolvedValue({ total: 2, verified: 0, blocked: 0, rejected: 2, results: [] });
    const result = await runResearch(options());
    expect(result.ok).toBe(true);
    expect(result.citations.rejected).toBe(2);
  });

  it('returns timeout guidance without trying citation verification for an empty draft', async () => {
    io.dispatch.mockResolvedValue({ stdout: '', timedOut: true });
    const result = await runResearch(options());
    expect(result).toMatchObject({ ok: false, engineId: 'selected', note: "engine 'selected' timed out", outputDir: '/fixture/run', sources: [] });
    expect(io.verify).not.toHaveBeenCalled();
  });

  it('stops after discovery cancellation before reading or drafting', async () => {
    const controller = new AbortController();
    let discoverySignal: AbortSignal | undefined;
    io.fetch.mockImplementation(async (_url, request) => {
      discoverySignal = request.signal;
      controller.abort();
      throw new DOMException('fixture cancellation', 'AbortError');
    });
    expect(await runResearch(options({ signal: controller.signal }))).toMatchObject({ ok: false, note: 'aborted' });
    expect(discoverySignal?.aborted).toBe(true);
    expect(io.read).not.toHaveBeenCalled();
    expect(io.dispatch).not.toHaveBeenCalled();
    expect(io.verify).not.toHaveBeenCalled();
  });
});
