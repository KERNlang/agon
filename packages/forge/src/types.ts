import type { EngineResult, ForgeManifest, ForgeEvent, Critique } from '@agon/core';

export interface StageResult {
  engineResults: Map<string, EngineResult>;
  accepted: boolean;
  winner: string | null;
}

export interface SynthesisResult {
  pass: boolean;
  score: number;
  wins: boolean;
  patchPath: string;
  originalWinnerScore: number;
  critiques: Critique[];
}

export type ForgeEventCallback = (event: ForgeEvent) => void;

export interface WorktreeEntry {
  engineId: string;
  path: string;
  repoRoot: string;
}
