import type { EngineResult, ForgeEvent, Critique } from '@agon/core';

export interface StageResult {
  engineResults: Map<string, EngineResult>;
  accepted: boolean;
  winner: string|null;
}

export interface SynthesisResult {
  pass: boolean;
  score: number;
  wins: boolean;
  patchPath: string;
  originalWinnerScore: number;
  critiques: Critique[];
}

export interface WorktreeEntry {
  engineId: string;
  path: string;
  repoRoot: string;
}

