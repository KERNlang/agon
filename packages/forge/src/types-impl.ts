import type { Critique } from '@kernlang/agon-core';
export type { StageResult, WorktreeEntry } from '@kernlang/agon-mod-forge';

export interface SynthesisResult {
  pass: boolean;
  score: number;
  wins: boolean;
  patchPath: string;
  originalWinnerScore: number;
  critiques: Critique[];
  reason?: string;
}
