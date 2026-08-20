export interface RagChunk {
  id: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  citation?: {uri?:string,locator?:string};
  metadata?: Record<string,unknown>;
}

export interface RagHit {
  id: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
  citation?: {uri?:string,locator?:string};
  metadata?: Record<string,unknown>;
}

export interface RagCorpusFile {
  path: string;
  sha: string;
}

export interface RagManifest {
  corpusHash: string;
  model: string;
  dims: number;
  chunkCount: number;
  files: RagCorpusFile[];
  builtAt: number;
}

export interface RagIndexResult {
  corpusHash: string;
  fileCount: number;
  chunkCount: number;
  durationMs: number;
  reused: boolean;
}

export interface RagQueryResult {
  query: string;
  hits: RagHit[];
  grounded: boolean;
}
