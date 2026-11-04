export interface ProvenanceContribution {
  engineId: string;
  role: 'winner'|'synthesizer'|'rejected'|'skipped';
  accepted: boolean;
  acceptanceMechanism: 'human-explicit'|'human-implicit-survived-in-head'|'autonomous-oracle'|'autonomous-gate'|'machine-synthesized-blend'|'not-accepted'|'unknown';
  score?: number;
  passedGate?: boolean;
  reason?: string;
  diffLines?: number;
  filesChanged?: number;
  durationSec?: number;
  costUsd?: number;
}

export interface ProvenanceLedger {
  schemaVersion: 1;
  kind: 'forge'|'goal'|'aggregate';
  generatedAt: string;
  runId: string;
  humanPrompt: string;
  gate?: string;
  startedAt: string;
  engines: string[];
  contributions: ProvenanceContribution[];
  winner: string|null;
  autonomyLevel: 'human-gated'|'autonomous-selection'|'autonomous-loop';
  synthesisBlended: boolean;
  sourceHashes: Record<string,string>;
  aiDidNot: string[];
  limitations: string[];
  responsibility: string;
}

// Reports read persisted fields without loading the Forge runtime.
export interface ProvenanceManifest {
  forgeId: string;
  task: string;
  timestamp: string;
  fitnessCmd?: string;
  engines?: string[];
  winner?: string | null;
  results?: Record<string, {
    score?: number;
    fitnessPassed?: boolean;
    pass?: boolean;
    reason?: string;
    status?: string;
    diffLines?: number;
    filesChanged?: number;
    durationSec?: number;
  }>;
  dispatchLog?: Array<{ engineId: string; tokens?: { costUsd?: number } }>;
  skippedEngines?: Array<{ engineId: string; reason?: string; status?: string }>;
  synthesis?: { wins: boolean; score: number; pass: boolean; originalWinnerScore?: number };
}
