import type { FalsifierEffects, FalsifierResult, SandboxOps } from '@kernlang/agon-mod-conquer';
import type { ConquerCaps, ConquerTurn, ConquerResult } from '@kernlang/agon-mod-conquer';
export { ESCAPING_OPS, DONE_SENTINEL, ASK_SENTINEL, DEFAULT_PROTECTED_PUSH_BRANCHES, pickEscalationMode, classifyStuck, shouldEscalate, shouldAutoApprove, summarizeConsultForBuilder, isProtectedPushBranch, capBreached, classifyAsk, buildConquerTurnPrompt } from '@kernlang/agon-mod-conquer';
export type { StuckSignals, ConquerCaps, ConquerState, ConquerTurn, ConquerResult } from '@kernlang/agon-mod-conquer';
import type { EngineAdapter, EngineRegistry, RatingRecord } from '@kernlang/agon-core';
import { runDoneFalsifier as runOwnedDoneFalsifier, runDoneOracle as runOwnedDoneOracle, runConquerWorkflow } from '@kernlang/agon-mod-conquer';
export { parseBuilderSignals, buildConquerSystemPrompt } from '@kernlang/agon-mod-conquer';
export { doneOracleDecision } from '@kernlang/agon-mod-conquer';
export type { DoneOracleInput } from '@kernlang/agon-mod-conquer';

import { resolveWorkingDir, getRatings, seedNewEnginesFromRegistry, buildKernContextSpine, repoRoot, createSessionWorktree } from '@kernlang/agon-core';

import { runNero, rankNeroCritics } from './nero.js';

import { runTribunal } from './tribunal.js';

import { runBrainstorm } from './brainstorm.js';

import { runCouncil } from './council.js';


import { createConquerIsolation as createOwnedConquerIsolation } from '@kernlang/agon-mod-conquer';
import type { ConquerIsolation } from '@kernlang/agon-mod-conquer';
export type { ConquerIsolation } from '@kernlang/agon-mod-conquer';

export interface ConquerOptions {
  task: string;
  builderEngine: string;
  advisorEngines: string[];
  registry: EngineRegistry;
  adapter: EngineAdapter;
  timeout: number;
  outputDir: string;
  cwd?: string | undefined;
  gate?: string | undefined;
  caps?: ConquerCaps | undefined;
  evaluateDone: (claim: string) => Promise<{ diff: string; gateOk: boolean; oracleTampered: boolean }>;
  onTurn?: ((t: ConquerTurn) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Create a persistent named worktree for one Conquer run. It branches from HEAD, so uncommitted source-checkout work remains untouched and is intentionally not copied into the build. The worktree is kept after success/failure for the human merge gate and crash recovery.
 */
export function createConquerIsolation(task: string, cwd?: string, runId?: string): ConquerIsolation {
  return createOwnedConquerIsolation(task, cwd ?? resolveWorkingDir(), { repoRoot, createSessionWorktree }, runId);
}

/**
 * Convene the chosen agon mode on a builder fork/stuck (or as the done-oracle's nero falsification round) and normalize its output to { verdict text, confidence, flawed }. Reuses runNero/runTribunal/runBrainstorm/runCouncil. `flawed` is true only for a nero verdict of 'flawed' (a found counterexample). Defensive field access survives result-shape drift.
 */
export async function dispatchConsult(opts: { mode: 'nero' | 'tribunal' | 'brainstorm' | 'council'; question: string; engines: string[]; registry: EngineRegistry; adapter: EngineAdapter; timeout: number; outputDir: string; cwd?: string; signal?: AbortSignal }): Promise<{ mode: string; verdict: string; confidence: number | null; flawed: boolean }> {
  const base: any = { engines: opts.engines, registry: opts.registry, adapter: opts.adapter, timeout: opts.timeout, outputDir: opts.outputDir, cwd: opts.cwd, signal: opts.signal };
  let r: any;
  if (opts.mode === 'nero') {
    r = await runNero({ decision: opts.question, ...base });
    return {
      mode: 'nero',
      verdict: String(r?.challengeText ?? '').trim(),
      confidence: typeof r?.challengeConfidence === 'number' ? r.challengeConfidence : null,
      flawed: r?.verdict === 'flawed',
    };
  }
  if (opts.mode === 'tribunal') r = await runTribunal({ question: opts.question, rounds: 1, ...base });
  else if (opts.mode === 'brainstorm') r = await runBrainstorm({ question: opts.question, ...base });
  else r = await runCouncil({ question: opts.question, ...base });
  return {
    mode: opts.mode,
    verdict: String(r?.verdict ?? r?.summary ?? r?.recommendation ?? '').trim(),
    confidence: typeof r?.confidence === 'number' ? r.confidence : null,
    flawed: false,
  };
}

export { isAgentCapableEngine, buildFalsifierPrompt, parseFalsifierOutput, isSafeCounterexample } from '@kernlang/agon-mod-conquer';
export type { SandboxOps, FalsifierResult } from '@kernlang/agon-mod-conquer';

function legacyFalsifierEffects(opts: { registry: EngineRegistry; adapter: EngineAdapter; ratings?: RatingRecord }): FalsifierEffects {
  return {
    adapter: opts.adapter,
    getEngine: id => opts.registry.get(id),
    rankCritics: ids => {
      if (!opts.ratings) seedNewEnginesFromRegistry(opts.registry);
      return rankNeroCritics(ids, opts.ratings ?? getRatings());
    },
  };
}

export async function runDoneFalsifier(opts: { claim:string; gate?:string; cwd:string; engines:string[]; registry:EngineRegistry; adapter:EngineAdapter; timeout:number; outputDir:string; ratings?:RatingRecord; signal?:AbortSignal; sandbox?:SandboxOps }): Promise<FalsifierResult> {
  return runOwnedDoneFalsifier(opts, legacyFalsifierEffects(opts));
}

export async function runDoneOracle(opts: { claim: string; diff: string; gate?: string; gateOk: boolean; oracleTampered: boolean; engines: string[]; registry: EngineRegistry; adapter: EngineAdapter; timeout: number; outputDir: string; cwd: string; ratings?: RatingRecord; signal?: AbortSignal; sandbox?: SandboxOps }): Promise<{ passed: boolean; reason: string; falsified: boolean; attackText: string; counterexample: string | null; observed: string | null; critic: string; advisoryOnly: boolean }> {
  return runOwnedDoneOracle(opts, legacyFalsifierEffects(opts));
}

/** Bind legacy engine and filesystem effects to the mod-owned controller. */
export async function runConquer(opts: ConquerOptions): Promise<ConquerResult> {
  const cwd = opts.cwd ?? resolveWorkingDir();
  const builder = opts.registry.get(opts.builderEngine);
  return runConquerWorkflow(opts, {
    contextSpine: () => buildKernContextSpine(cwd),
    build: (prompt, systemPrompt) => opts.adapter.dispatch({
      engine: builder, prompt, systemPrompt, cwd,
      mode: 'agent', timeout: opts.timeout, outputDir: opts.outputDir, signal: opts.signal,
    }),
    consult: (mode, question) => dispatchConsult({
      mode, question, engines: opts.advisorEngines, registry: opts.registry,
      adapter: opts.adapter, timeout: opts.timeout, outputDir: opts.outputDir, cwd, signal: opts.signal,
    }),
    evaluateDone: async claim => {
      const ev = await opts.evaluateDone(claim);
      return runDoneOracle({
        claim, diff: ev.diff, gate: opts.gate, gateOk: ev.gateOk, oracleTampered: ev.oracleTampered,
        engines: opts.advisorEngines, registry: opts.registry, adapter: opts.adapter,
        timeout: opts.timeout, outputDir: opts.outputDir, cwd, signal: opts.signal,
      });
    },
  });
}
