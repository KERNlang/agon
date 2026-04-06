// @kern-source: types:1
import type { EngineResult, ForgeEvent, Critique, DispatchMetric } from '@agon/core';

// @kern-source: types:3
export interface StageResult {
  engineResults: Map<string, EngineResult>;
  accepted: boolean;
  winner: string|null;
  metrics?: DispatchMetric[];
}

// @kern-source: types:9
export interface SynthesisResult {
  pass: boolean;
  score: number;
  wins: boolean;
  patchPath: string;
  originalWinnerScore: number;
  critiques: Critique[];
}

// @kern-source: types:20
export interface WorktreeEntry {
  engineId: string;
  path: string;
  repoRoot: string;
}

