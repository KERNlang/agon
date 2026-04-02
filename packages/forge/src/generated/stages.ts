import { join } from 'node:path';

import type { EngineAdapter, EngineResult, ForgeOptions, AgonConfig } from '@agon/core';

import { EngineRegistry, worktreeCreate, worktreeRemove, headSha, repoRoot, worktreeDiff } from '@agon/core';

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
  
  // lintWarnings and styleScore are currently hardcoded (0 and 100) in fitness.kern,
  // so those checks are no-ops. Gate on what matters: pass + score threshold.
  const accepted =
    result.pass &&
    result.score >= opts.config.forgeAutoAcceptScore;
  
  if (accepted) {
    opts.onEvent?.({
      type: 'stage1:accepted',
      engineId: opts.starter,
      data: { score: result.score },
    });
  }
  
  return { engineResults, accepted, winner: result.pass ? opts.starter : null };
}

export async function runStage2(opts: {challengers:string[], forgePrompt:string, enginePrompts?:Map<string,string>, fitnessCmd:string, config:Required<AgonConfig>, registry:EngineRegistry, adapter:EngineAdapter, cwd:string, forgeDir:string, existingResults:Map<string,EngineResult>, worktrees:WorktreeEntry[], onEvent?:ForgeEventCallback, signal?:AbortSignal}): Promise<StageResult> {
  opts.onEvent?.({ type: 'stage2:start' });
  
  const root = repoRoot(opts.cwd);
  const sha = headSha(opts.cwd);
  
  const challengerPromises = opts.challengers.map(async (engineId: string) => {
    const engine = opts.registry.get(engineId);
    const wtPath = join(opts.forgeDir, `wt-${engineId}`);
  
    worktreeCreate(root, wtPath, sha);
    opts.worktrees.push({ engineId, path: wtPath, repoRoot: root });
  
    opts.onEvent?.({ type: 'stage2:dispatch', engineId });
  
    // Use per-engine specialized prompt if available (role specialization)
    const prompt = opts.enginePrompts?.get(engineId) ?? opts.forgePrompt;
  
    const useAgent = !!engine.agent && !!opts.adapter.dispatchAgent;
    if (useAgent) {
      await opts.adapter.dispatchAgent!({
        engine,
        prompt,
        cwd: wtPath,
        mode: 'agent',
        timeout: engine.timeout,
        outputDir: opts.forgeDir,
        signal: opts.signal,
      });
    } else {
      await opts.adapter.dispatch({
        engine,
        prompt,
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

export async function runStage2WithPeek(opts: {challengers:string[], forgePrompt:string, enginePrompts?:Map<string,string>, fitnessCmd:string, config:Required<AgonConfig>, registry:EngineRegistry, adapter:EngineAdapter, cwd:string, forgeDir:string, existingResults:Map<string,EngineResult>, worktrees:WorktreeEntry[], onEvent?:ForgeEventCallback, signal?:AbortSignal}): Promise<StageResult> {
  if (opts.challengers.length <= 1) {
    // Only one challenger — no peek possible, use normal stage2
    return runStage2(opts);
  }
  
  opts.onEvent?.({ type: 'stage2:start', data: { strategy: 'peek' } });
  
  const root = repoRoot(opts.cwd);
  const sha = headSha(opts.cwd);
  
  // Phase 1: dispatch the scout (first challenger) alone
  const scoutId = opts.challengers[0];
  const followers = opts.challengers.slice(1);
  
  const scoutEngine = opts.registry.get(scoutId);
  const scoutWt = join(opts.forgeDir, `wt-${scoutId}`);
  worktreeCreate(root, scoutWt, sha);
  opts.worktrees.push({ engineId: scoutId, path: scoutWt, repoRoot: root });
  
  opts.onEvent?.({ type: 'stage2:dispatch', engineId: scoutId, data: { phase: 'scout' } });
  
  const scoutPrompt = opts.enginePrompts?.get(scoutId) ?? opts.forgePrompt;
  const useScoutAgent = !!scoutEngine.agent && !!opts.adapter.dispatchAgent;
  if (useScoutAgent) {
    await opts.adapter.dispatchAgent!({
      engine: scoutEngine, prompt: scoutPrompt, cwd: scoutWt,
      mode: 'agent', timeout: scoutEngine.timeout, outputDir: opts.forgeDir, signal: opts.signal,
    });
  } else {
    await opts.adapter.dispatch({
      engine: scoutEngine, prompt: scoutPrompt, cwd: scoutWt,
      mode: 'review', timeout: scoutEngine.timeout, outputDir: opts.forgeDir, signal: opts.signal,
    });
  }
  
  // Get scout's diff as peek context
  const scoutDiff = worktreeDiff(scoutWt);
  const peekContext = scoutDiff
    ? `\n\n## PEEK — Another engine's approach (for reference, not to copy)\nAnother engine already attempted this task. Here is a summary of their approach:\n\`\`\`diff\n${scoutDiff.slice(0, 3000)}\n\`\`\`\nUse this as inspiration but find your own solution. You may improve on their approach or take a completely different path.`
    : '';
  
  opts.onEvent?.({ type: 'stage2:score', engineId: scoutId });
  const scoutResult = await runFitness({
    engineId: scoutId, worktreePath: scoutWt,
    fitnessCmd: opts.fitnessCmd, timeout: opts.config.forgeFitnessTimeout, forgeDir: opts.forgeDir,
  });
  
  // Phase 2: dispatch followers with peek context
  const followerPromises = followers.map(async (engineId: string) => {
    const engine = opts.registry.get(engineId);
    const wtPath = join(opts.forgeDir, `wt-${engineId}`);
    worktreeCreate(root, wtPath, sha);
    opts.worktrees.push({ engineId, path: wtPath, repoRoot: root });
  
    opts.onEvent?.({ type: 'stage2:dispatch', engineId, data: { phase: 'follower', hasPeek: !!peekContext } });
  
    const basePrompt = opts.enginePrompts?.get(engineId) ?? opts.forgePrompt;
    const prompt = basePrompt + peekContext;
  
    const useAgent = !!engine.agent && !!opts.adapter.dispatchAgent;
    if (useAgent) {
      await opts.adapter.dispatchAgent!({
        engine, prompt, cwd: wtPath, mode: 'agent',
        timeout: engine.timeout, outputDir: opts.forgeDir, signal: opts.signal,
      });
    } else {
      await opts.adapter.dispatch({
        engine, prompt, cwd: wtPath, mode: 'review',
        timeout: engine.timeout, outputDir: opts.forgeDir, signal: opts.signal,
      });
    }
  
    opts.onEvent?.({ type: 'stage2:score', engineId });
    return runFitness({
      engineId, worktreePath: wtPath, fitnessCmd: opts.fitnessCmd,
      timeout: opts.config.forgeFitnessTimeout, forgeDir: opts.forgeDir,
    });
  });
  
  const followerResults = await Promise.all(followerPromises);
  
  const allResults = new Map(opts.existingResults);
  allResults.set(scoutId, scoutResult);
  for (const result of followerResults) {
    allResults.set(result.engineId, result);
  }
  
  opts.onEvent?.({ type: 'stage2:done', data: { resultCount: allResults.size, strategy: 'peek' } });
  
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

