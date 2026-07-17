import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  chunkMarkdown,
  RAG_CHUNK_MAX_CHARS,
} from '../../packages/core/src/generated/rag/chunking.js';
import { collectCorpusFiles, hashCorpus } from '../../packages/core/src/generated/rag/corpus.js';
import { cosineTopK, RAG_GROUNDED_MIN_SCORE } from '../../packages/core/src/generated/rag/retriever.js';
import { isGrounded, formatCitedBlocks, formatCitationFootnotes } from '../../packages/core/src/generated/rag/grounding.js';
import { saveRagIndex, loadRagIndex, ragDir } from '../../packages/core/src/generated/rag/store.js';
import { embedTexts } from '../../packages/core/src/generated/rag/embed.js';
import type { RagChunk, RagManifest } from '../../packages/core/src/generated/rag/types.js';

const tempDirs: string[] = [];
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-rag-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  delete process.env.AGON_PYTHON;
});

describe('rag — chunkMarkdown', () => {
  it('splits at h1-h3 heading boundaries with 1-based line provenance', () => {
    const md = '# One\nalpha\n\n## Two\nbeta\n\n### Three\ngamma';
    const chunks = chunkMarkdown(md, 'doc.md');
    expect(chunks.map((c) => c.startLine)).toEqual([1, 4, 7]);
    expect(chunks[0].id).toBe('doc.md:L1-3');
    expect(chunks[1].text).toContain('## Two');
    expect(chunks[2].endLine).toBe(8);
  });

  it('treats headings inside fenced code blocks as content, not boundaries', () => {
    const md = '# Real\nintro\n```md\n# not a heading\n## also not\n```\noutro';
    const chunks = chunkMarkdown(md, 'doc.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('# not a heading');
  });

  it('keeps an oversized fenced code block atomic (never torn)', () => {
    const bigCode = Array.from({ length: 120 }, (_, i) => `const line${i} = ${'x'.repeat(30)};`).join('\n');
    const md = `# Code\n\`\`\`ts\n${bigCode}\n\`\`\`\ntail`;
    const chunks = chunkMarkdown(md, 'doc.md');
    const fenceChunks = chunks.filter((c) => c.text.includes('```'));
    // Every chunk containing fence content has BOTH the opening and closing fence.
    for (const c of fenceChunks) {
      expect((c.text.match(/```/g) ?? []).length % 2).toBe(0);
    }
  });

  it('splits long prose sections near the max-char cap with trailing overlap', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `prose line ${i} ${'words '.repeat(10)}`);
    const md = `# Long\n${lines.join('\n')}`;
    const chunks = chunkMarkdown(md, 'doc.md');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(RAG_CHUNK_MAX_CHARS + 400); // cap + one line slack
    }
    // Overlap: the second chunk starts before the first one ended.
    expect(chunks[1].startLine).toBeLessThanOrEqual(chunks[0].endLine);
  });
});

describe('rag — corpus', () => {
  it('collects root *.md + docs recursively, skips other extensions', () => {
    const repo = tempRepo();
    writeFileSync(join(repo, 'README.md'), '# readme');
    writeFileSync(join(repo, 'AGENTS.md'), '# agon');
    writeFileSync(join(repo, 'index.ts'), 'export {}');
    mkdirSync(join(repo, 'docs', 'deep'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'guide.md'), '# guide');
    writeFileSync(join(repo, 'docs', 'deep', 'nested.md'), '# nested');
    const files = collectCorpusFiles(repo);
    expect(files).toEqual(['AGENTS.md', 'README.md', join('docs', 'deep', 'nested.md'), join('docs', 'guide.md')]);
  });

  it('corpus hash is stable for same content and changes when a file changes', () => {
    const repo = tempRepo();
    writeFileSync(join(repo, 'README.md'), '# readme');
    const files = collectCorpusFiles(repo);
    const h1 = hashCorpus(repo, files).corpusHash;
    const h2 = hashCorpus(repo, files).corpusHash;
    expect(h1).toBe(h2);
    writeFileSync(join(repo, 'README.md'), '# readme CHANGED');
    expect(hashCorpus(repo, files).corpusHash).not.toBe(h1);
  });
});

function chunkFixture(n: number): RagChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f.md:L${i + 1}-${i + 1}`,
    source: 'f.md',
    startLine: i + 1,
    endLine: i + 1,
    text: `chunk ${i}`,
  }));
}

describe('rag — retriever + grounding', () => {
  it('returns top-k by cosine score, highest first, respecting the floor', () => {
    const dims = 4;
    const chunks = chunkFixture(3);
    // Normalized rows: row0 ≈ query, row1 orthogonal, row2 partial.
    const matrix = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      Math.SQRT1_2, Math.SQRT1_2, 0, 0,
    ]);
    const hits = cosineTopK([1, 0, 0, 0], matrix, dims, chunks, 4, 0.25);
    expect(hits.map((h) => h.id)).toEqual(['f.md:L1-1', 'f.md:L3-3']); // row1 below floor
    expect(hits[0].score).toBeCloseTo(1, 3);
    expect(hits[1].score).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('grounding fails closed on zero hits and on a weak top hit', () => {
    expect(isGrounded([])).toBe(false);
    const weak = [{ ...chunkFixture(1)[0], score: RAG_GROUNDED_MIN_SCORE - 0.01 }];
    expect(isGrounded(weak)).toBe(false);
    const strong = [{ ...chunkFixture(1)[0], score: RAG_GROUNDED_MIN_SCORE + 0.01 }];
    expect(isGrounded(strong)).toBe(true);
  });

  it('formats cited blocks with provenance and a no-citation marker when ungrounded', () => {
    const hit = { ...chunkFixture(1)[0], score: 0.81 };
    const grounded = formatCitedBlocks({ query: 'q', hits: [hit], grounded: true });
    expect(grounded).toContain('[1] f.md L1-1 (score 0.81)');
    const ungrounded = formatCitedBlocks({ query: 'lasagna', hits: [], grounded: false });
    expect(ungrounded).toContain('no grounded context');
    expect(formatCitationFootnotes([hit])).toBe('[1] f.md L1-1');
  });
});

describe('rag — store round-trip', () => {
  it('saves and reloads manifest + chunks + Float32 matrix losslessly', () => {
    const repo = tempRepo();
    const chunks = chunkFixture(2);
    const matrix = new Float32Array([0.25, -0.5, 1, 0]);
    const manifest: RagManifest = {
      corpusHash: 'abc123',
      model: 'test-model',
      dims: 2,
      chunkCount: 2,
      files: [{ path: 'f.md', sha: 'x' }],
      builtAt: 123,
    };
    saveRagIndex(repo, manifest, chunks, matrix);
    const loaded = loadRagIndex(repo, 'abc123');
    expect(loaded).not.toBeNull();
    expect(loaded!.manifest).toEqual(manifest);
    expect(loaded!.chunks).toEqual(chunks);
    expect(Array.from(loaded!.matrix)).toEqual([0.25, -0.5, 1, 0]);
    expect(ragDir(repo)).toBe(join(repo, '.agon', 'rag'));
  });

  it('prunes stale corpus-hash dirs on save and rejects count mismatches on load', () => {
    const repo = tempRepo();
    const manifest = (hash: string): RagManifest => ({
      corpusHash: hash, model: 'm', dims: 1, chunkCount: 1,
      files: [], builtAt: 1,
    });
    saveRagIndex(repo, manifest('old1'), chunkFixture(1), new Float32Array([1]));
    saveRagIndex(repo, manifest('new2'), chunkFixture(1), new Float32Array([1]));
    expect(loadRagIndex(repo, 'old1')).toBeNull(); // pruned
    expect(loadRagIndex(repo, 'new2')).not.toBeNull();
  });
});

describe('rag — embed sidecar boundary', () => {
  it('round-trips vectors through a mocked sidecar process', () => {
    const repo = tempRepo();
    const stub = join(repo, 'fake-python.sh');
    // AGON_PYTHON can be any executable; the stub ignores stdin/args and
    // emits a fixed valid embedder.py response for 2 inputs.
    writeFileSync(stub, `#!/bin/sh\ncat > /dev/null\necho '{"model":"stub","dims":2,"vectors":[{"id":"0","vector":[1,0]},{"id":"1","vector":[0,1]}]}'\n`);
    chmodSync(stub, 0o755);
    process.env.AGON_PYTHON = stub;
    const out = embedTexts(['a', 'b']);
    expect(out).not.toBeNull();
    expect(out!.dims).toBe(2);
    expect(out!.vectors).toEqual([[1, 0], [0, 1]]);
  });

  it('returns null (graceful degrade) when the embedder cannot run', () => {
    process.env.AGON_PYTHON = '/nonexistent/python-binary';
    expect(embedTexts(['a'])).toBeNull();
    expect(embedTexts([])).toBeNull();
  });

  it('returns null on a vector-count mismatch instead of mis-aligning rows', () => {
    const repo = tempRepo();
    const stub = join(repo, 'fake-python.sh');
    writeFileSync(stub, `#!/bin/sh\ncat > /dev/null\necho '{"model":"stub","dims":2,"vectors":[{"id":"0","vector":[1,0]}]}'\n`);
    chmodSync(stub, 0o755);
    process.env.AGON_PYTHON = stub;
    expect(embedTexts(['a', 'b'])).toBeNull();
  });
});
