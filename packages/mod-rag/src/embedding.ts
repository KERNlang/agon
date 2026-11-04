import { spawnSync } from 'node:child_process';
import { resolveDedupSidecar, resolveSidecarPython } from '@kernlang/agon-support-dedup';

// The first run can download the embedding model.
export const RAG_EMBED_TIMEOUT_MS: number = 180000;
export const RAG_EMBED_MAX_BUFFER: number = 64 * 1024 * 1024;

export interface RagEmbedResult {
  model: string;
  dims: number;
  vectors: number[][];
}

function invokeSidecar(texts: string[]) {
  const sidecar = resolveDedupSidecar('embedder.py');
  if (!sidecar) throw new Error('RAG embedder asset is unavailable');
  return spawnSync(resolveSidecarPython(), [sidecar], {
    input: texts.map((text, id) => JSON.stringify({ id: String(id), text })).join('\n') + '\n',
    encoding: 'utf8',
    timeout: Number(process.env.AGON_RAG_EMBED_TIMEOUT_MS) || RAG_EMBED_TIMEOUT_MS,
    maxBuffer: RAG_EMBED_MAX_BUFFER,
  });
}

function parseEmbeddings(stdout: string, count: number): RagEmbedResult {
  const parsed = JSON.parse(stdout) as {
    model: string;
    dims: number;
    vectors: { vector: number[] }[];
  };
  if (!Array.isArray(parsed.vectors) || parsed.vectors.length !== count)
    throw new Error('RAG embedder returned the wrong vector count');
  return { model: parsed.model, dims: parsed.dims, vectors: parsed.vectors.map(v => v.vector) };
}

// Legacy callers use null to select their own fallback message.
export function embedTexts(texts: string[]): RagEmbedResult | null {
  if (texts.length === 0) return null;
  try {
    const result = invokeSidecar(texts);
    if (result.error || result.status !== 0 || !result.stdout) return null;
    return parseEmbeddings(result.stdout, texts.length);
  } catch {
    return null;
  }
}

// Physical commands retain the sidecar diagnostic and metadata coercion.
export function embedForWorkflow(texts: string[]): RagEmbedResult {
  const result = invokeSidecar(texts);
  if (result.status !== 0 || !result.stdout)
    throw new Error(`RAG embedder failed: ${String(result.stderr ?? '').trim() || 'install fastembed and numpy'}`);
  const parsed = parseEmbeddings(result.stdout, texts.length);
  return { ...parsed, model: String(parsed.model), dims: Number(parsed.dims) };
}

export function embedSidecarHint(): string {
  return 'RAG embeddings need the python sidecar: pip install fastembed numpy (model downloads once into ~/.agon/cache/fastembed)';
}
