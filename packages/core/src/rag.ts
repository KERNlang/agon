// Facade over the generated RAG v0 modules (source: src/kern/rag/*.kern).
export { buildRagIndex, queryRag } from './generated/rag/rag.js';
export { collectCorpusFiles, hashCorpus } from './generated/rag/corpus.js';
export { chunkMarkdown, RAG_CHUNK_MAX_CHARS, RAG_CHUNK_OVERLAP_CHARS } from './generated/rag/chunking.js';
export { embedTexts, embedSidecarHint } from './generated/rag/embed.js';
export { ragDir, saveRagIndex, saveRagIndexAt, loadRagIndex, loadRagIndexAt } from './generated/rag/store.js';
export { AgonPersistentRagVectorStore, adapterNamespaceDir, createAgonRagVectorStoreContract } from './generated/rag/adapter.js';
export { cosineTopK, RAG_DEFAULT_TOP_K, RAG_MIN_SCORE, RAG_GROUNDED_MIN_SCORE } from './generated/rag/retriever.js';
export { isGrounded, formatCitedBlocks, formatCitationFootnotes } from './generated/rag/grounding.js';
export type { RagChunk, RagHit, RagCorpusFile, RagManifest, RagIndexResult, RagQueryResult } from './generated/rag/types.js';
