export interface WorkingSet {
  filesInPlay: string[];
  pendingVerifier: string | null;
  openHypotheses: string[];
}

export interface CompactionSummaryPart {
  kind: 'compaction';
  goal: string;
  discoveries: string[];
  filesModified: string[];
  filesRead: string[];
  toolsSummary: string[];
  decisions: string[];
  progress: string;
  compactedAt: number;
  messagesCompacted: number;
  workingSet?: WorkingSet | null;
}

export interface ToolCacheEntry {
  toolCallId: string;
  toolName: string;
  filePath: string;
  savedAt: number;
  byteSize: number;
}
