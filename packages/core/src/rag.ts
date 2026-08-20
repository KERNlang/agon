// Facade over the generated RAG v0 modules (source: src/kern/rag/*.kern).
export { buildRagIndex, queryRag } from './rag/rag.js';
export { collectCorpusFiles, hashCorpus } from './rag/corpus.js';
export { chunkMarkdown, RAG_CHUNK_MAX_CHARS, RAG_CHUNK_OVERLAP_CHARS } from './rag/chunking.js';
export { embedTexts, embedSidecarHint } from './rag/embed.js';
export { ragDir, saveRagIndex, saveRagIndexAt, loadRagIndex, loadRagIndexAt } from './rag/store.js';
export { AgonPersistentRagVectorStore, adapterNamespaceDir, createAgonRagVectorStoreContract } from './rag/adapter.js';
export { cosineTopK, RAG_DEFAULT_TOP_K, RAG_MIN_SCORE, RAG_GROUNDED_MIN_SCORE } from './rag/retriever.js';
export { isGrounded, formatCitedBlocks, formatCitationFootnotes } from './rag/grounding.js';
export type { RagChunk, RagHit, RagCorpusFile, RagManifest, RagIndexResult, RagQueryResult } from './rag/types.js';
