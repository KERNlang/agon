import { writeFileSync } from 'node:fs';

import { join } from 'node:path';

import type { FitnessResult, EngineResult } from '@agon/core';

import { spawnWithTimeout, worktreeDiff, diffLineCount, diffFileCount, computeScore } from '@agon/core';

export async function runFitness(opts: {engineId:string, worktreePath: string, fitnessCmd: string, timeout: number, forgeDir: string}): Promise<EngineResult> {
  const startTime = Date.now();
  
  let diff: string;
  let diffLines: number;
  let filesChanged: number;
  try {
    diff = worktreeDiff(opts.worktreePath);
    diffLines = diffLineCount(diff);
    filesChanged = diffFileCount(opts.worktreePath);
  } catch {
    diff = '';
    diffLines = 0;
    filesChanged = 0;
  }
  
  const patchPath = join(opts.forgeDir, `${opts.engineId}-patch.diff`);
  writeFileSync(patchPath, diff);
  
  const fitnessResult = await spawnWithTimeout({
    command: '/bin/sh',
    args: ['-c', opts.fitnessCmd],
    cwd: opts.worktreePath,
    timeout: opts.timeout * 1000,
  });
  
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  const pass = fitnessResult.exitCode === 0 && !fitnessResult.timedOut;
  
  const lintWarnings = 0;
  const styleScore = 100;
  
  const fitness: FitnessResult = {
    pass,
    diffLines,
    filesChanged,
    durationSec,
    lintWarnings,
    styleScore,
    compositeScore: 0,
  };
  
  const components = computeScore(fitness);
  fitness.compositeScore = components.composite;
  
  return {
    engineId: opts.engineId,
    pass,
    score: components.composite,
    diffLines,
    filesChanged,
    durationSec,
    lintWarnings,
    styleScore,
    patchPath,
    worktreePath: opts.worktreePath,
  };
  
}

