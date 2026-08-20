import type { EngineResult, ForgeEvent, Critique, DispatchMetric } from '@kernlang/agon-core';

export interface StageResult {
  engineResults: Map<string, EngineResult>;
  accepted: boolean;
  winner: string|null;
  metrics?: DispatchMetric[];
}

export interface SynthesisResult {
  pass: boolean;
  score: number;
  wins: boolean;
  patchPath: string;
  originalWinnerScore: number;
  critiques: Critique[];
  reason?: string;
}

export interface WorktreeEntry {
  engineId: string;
  path: string;
  repoRoot: string;
}
