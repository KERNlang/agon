import { join } from 'node:path';

import type { EngineAdapter, EngineResult, ForgeOptions, AgonConfig } from '@agon/core';

import { EngineRegistry, worktreeCreate, worktreeRemove, headSha, repoRoot } from '@agon/core';

import { runFitness } from './fitness.js';

import type { StageResult, ForgeEventCallback, WorktreeEntry } from '../types.js';

export async function runBaseline(opts: {cwd:string, fitnessCmd:string, fitnessTimeout:number, forgeDir:string, onEvent?:ForgeEventCallback}): Promise<boolean> {
  opts.onEvent?.({ type: 'baseline:start' });
  
  const root = repoRoot(opts.cwd);
  const sha = headSha(opts.cwd);
  const baselineWt = join(opts.forgeDir, 'baseline-worktree');
  
  worktreeCreate(root, baselineWt, sha);
  try {
    const result = await runFitness({
      engineId: 'baseline',
      worktreePath: baselineWt,
      fitnessCmd: opts.fitnessCmd,
      timeout: opts.fitnessTimeout,
      forgeDir: opts.forgeDir,
    });
  
    opts.onEvent?.({ type: 'baseline:done', data: { passes: result.pass } });
    return result.pass;
  } finally {
    worktreeRemove(root, baselineWt);
  }
}

export async function runStage1(opts: {starter:string, forgePrompt:string, fitnessCmd:string, config:Required<AgonConfig>, registry:EngineRegistry, adapter:EngineAdapter, cwd:string, forgeDir:string, worktrees:WorktreeEntry[], onEvent?:ForgeEventCallback, signal?:AbortSignal}): Promise<StageResult> {
  opts.onEvent?.({ type: 'stage1:start', engineId: opts.starter });
  
  const root = repoRoot(opts.cwd);
  const sha = headSha(opts.cwd);
  const engine = opts.registry.get(opts.starter);
  
  const wtPath = join(opts.forgeDir, `wt-${opts.starter}`);
  worktreeCreate(root, wtPath, sha);
  opts.worktrees.push({ engineId: opts.starter, path: wtPath, repoRoot: root });
  
  opts.onEvent?.({ type: 'stage1:dispatch', engineId: opts.starter });
  const useAgent = !!engine.agent && !!opts.adapter.dispatchAgent;
  if (useAgent) {
    await opts.adapter.dispatchAgent!({
      engine,
      prompt: opts.forgePrompt,
      cwd: wtPath,
      mode: 'agent',
      timeout: engine.timeout,
      outputDir: opts.forgeDir,
      signal: opts.signal,
    });
  } else {
    await opts.adapter.dispatch({
      engine,
      prompt: opts.forgePrompt,
      cwd: wtPath,
      mode: 'review',
      timeout: engine.timeout,
      outputDir: opts.forgeDir,
      signal: opts.signal,
    });
  }
  
  opts.onEvent?.({ type: 'stage1:score', engineId: opts.starter });
  const result = await runFitness({
    engineId: opts.starter,
    worktreePath: wtPath,
    fitnessCmd: opts.fitnessCmd,
    timeout: opts.config.forgeFitnessTimeout,
    forgeDir: opts.forgeDir,
  });
  
  const engineResults = new Map<string, EngineResult>();
  engineResults.set(opts.starter, result);
  
  const accepted =
    result.pass &&
    result.score >= opts.config.forgeAutoAcceptScore &&
    result.lintWarnings <= 2 &&
    result.styleScore >= 90;
  
  if (accepted) {
    opts.onEvent?.({
      type: 'stage1:accepted',
      engineId: opts.starter,
      data: { score: result.score },
    });
  }
  
  return { engineResults, accepted, winner: result.pass ? opts.starter : null };
}

export async function runStage2(opts: {challengers:string[], forgePrompt:string, fitnessCmd:string, config:Required<AgonConfig>, registry:EngineRegistry, adapter:EngineAdapter, cwd:string, forgeDir:string, existingResults:Map<string,EngineResult>, worktrees:WorktreeEntry[], onEvent?:ForgeEventCallback, signal?:AbortSignal}): Promise<StageResult> {
  opts.onEvent?.({ type: 'stage2:start' });
  
  const root = repoRoot(opts.cwd);
  const sha = headSha(opts.cwd);
  
  const challengerPromises = opts.challengers.map(async (engineId: string) => {
    const engine = opts.registry.get(engineId);
    const wtPath = join(opts.forgeDir, `wt-${engineId}`);
  
    worktreeCreate(root, wtPath, sha);
    opts.worktrees.push({ engineId, path: wtPath, repoRoot: root });
  
    opts.onEvent?.({ type: 'stage2:dispatch', engineId });
  
    const useAgent = !!engine.agent && !!opts.adapter.dispatchAgent;
    if (useAgent) {
      await opts.adapter.dispatchAgent!({
        engine,
        prompt: opts.forgePrompt,
        cwd: wtPath,
        mode: 'agent',
        timeout: engine.timeout,
        outputDir: opts.forgeDir,
        signal: opts.signal,
      });
    } else {
      await opts.adapter.dispatch({
        engine,
        prompt: opts.forgePrompt,
        cwd: wtPath,
        mode: 'review',
        timeout: engine.timeout,
        outputDir: opts.forgeDir,
        signal: opts.signal,
      });
    }
  
    opts.onEvent?.({ type: 'stage2:score', engineId });
  
    return runFitness({
      engineId,
      worktreePath: wtPath,
      fitnessCmd: opts.fitnessCmd,
      timeout: opts.config.forgeFitnessTimeout,
      forgeDir: opts.forgeDir,
    });
  });
  
  const results = await Promise.all(challengerPromises);
  
  const allResults = new Map(opts.existingResults);
  for (const result of results) {
    allResults.set(result.engineId, result);
  }
  
  opts.onEvent?.({ type: 'stage2:done', data: { resultCount: allResults.size } });
  
  return { engineResults: allResults, accepted: false, winner: null };
}

export function determineWinner(results: Map<string,EngineResult>, spread: number): {winner:string|null, closeCall:boolean, bestScore:number, secondScore:number} {
  const passing = [...results.entries()]
    .filter(([_, r]) => r.pass && r.score > 0)
    .sort(([_aId, a], [_bId, b]) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.lintWarnings !== b.lintWarnings) return a.lintWarnings - b.lintWarnings;
      if (a.styleScore !== b.styleScore) return b.styleScore - a.styleScore;
      if (a.diffLines !== b.diffLines) return a.diffLines - b.diffLines;
      if (a.filesChanged !== b.filesChanged) return a.filesChanged - b.filesChanged;
      return a.durationSec - b.durationSec;
    });
  
  if (passing.length === 0) {
    return { winner: null, closeCall: false, bestScore: 0, secondScore: 0 };
  }
  
  const bestScore = passing[0][1].score;
  const secondScore = passing.length > 1 ? passing[1][1].score : 0;
  const closeCall = passing.length > 1 && (bestScore - secondScore) < spread;
  
  return { winner: passing[0][0], closeCall, bestScore, secondScore };
}

