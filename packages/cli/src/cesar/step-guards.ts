import type { AgonConfig } from '@kernlang/agon-core';

export type ReadSpiralIntent = 'edit' | 'investigate';

/**
 * Default for config.cesarSearchNudgeThreshold: read-class steps in one turn before the CODEBASE-BRIEF advisory fires.
 */
export const CESAR_SEARCH_NUDGE_DEFAULT: number = 40;

/**
 * Default for config.cesarReadSpiralThreshold: read-class steps with zero mutate/verify before the edit-intent checkpoint fires.
 */
export const CESAR_READ_SPIRAL_DEFAULT: number = 25;

/**
 * Default for config.cesarReadRepeatThreshold: read-REPEAT steps before the investigate-intent checkpoint fires.
 */
export const CESAR_READ_REPEAT_DEFAULT: number = 12;

/**
 * Router intake kinds whose turns are expected to end in a change. Everything else (chat, review, decision, exploration, unknown) is treated as investigate — the conservative side, because the investigate note never tells Cesar to implement.
 */
export const EDIT_INTAKE_KINDS: Set<string> = new Set(['quick-fix', 'bug', 'feature', 'big-feature', 'spec']);

/**
 * Read one numeric guard threshold from config. A finite value >= 1 wins (floored); anything else — unset, 0, negative, NaN, a string — falls back to the compiled default. Non-positive MUST mean 'unset': KERN codegen emits an optional number field as 0 into DEFAULT_AGON_CONFIG (the same quirk experience.kern documents for its retrieval gates), and loadConfig merges those defaults, so a never-configured threshold arrives as 0. It also stops a malformed config value from silently disabling a guard.
 */
export function resolveGuardThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Read-class steps per turn before the one-shot CODEBASE-BRIEF advisory. config.cesarSearchNudgeThreshold, default 40.
 */
export function cesarSearchNudgeThreshold(config?: AgonConfig): number {
  return resolveGuardThreshold(config?.cesarSearchNudgeThreshold, CESAR_SEARCH_NUDGE_DEFAULT);
}

/**
 * Read-class steps with zero mutate/verify before the edit-intent read-spiral checkpoint. config.cesarReadSpiralThreshold, default 25.
 */
export function cesarReadSpiralThreshold(config?: AgonConfig): number {
  return resolveGuardThreshold(config?.cesarReadSpiralThreshold, CESAR_READ_SPIRAL_DEFAULT);
}

/**
 * Read-REPEAT steps before the investigate-intent read-spiral checkpoint. config.cesarReadRepeatThreshold, default 12.
 */
export function cesarReadRepeatThreshold(config?: AgonConfig): number {
  return resolveGuardThreshold(config?.cesarReadRepeatThreshold, CESAR_READ_REPEAT_DEFAULT);
}

/**
 * Give back the continuation slot a steering-yield round consumed. The harness ENDED that round itself to hand the turn to the user, so it is neither the model failing to progress (the caller skips the no-progress strike by continuing the loop) nor a harness retry against MAX_CONTINUATIONS. Never goes below zero.
 */
export function refundContinuationForSteeringYield(continuations: number): number {
  return Math.max(0, (Number(continuations ?? 0) - 1));
}

/**
 * Map the router's intake kind onto the guard's two intents. Only change-shaped intakes (quick-fix/bug/feature/big-feature/spec) are edit-intent; every other or missing value is investigate, so an unclassified turn can never be pushed toward implementing.
 */
export function readSpiralIntentFor(intakeKind?: string): ReadSpiralIntent {
  return EDIT_INTAKE_KINDS.has(String(intakeKind ?? '').trim().toLowerCase()) ? 'edit' : 'investigate';
}

/**
 * One-shot read-spiral checkpoint predicate. Edit intent: at least spiralThreshold read-class steps AND zero effectful (mutate/verify) steps AND zero shell-work steps — a mapping pass that never turned into work. Investigate intent: read VOLUME is legitimate, so it fires only on at least repeatThreshold read-REPEATS. Never fires twice (alreadyNoted). shellWorkSteps is the honesty guard on the edit branch: a turn that did its work through the shell (`sed -i …`, `git commit`, `mkdir`, a build script) classifies as `other`, never mutate/verify, so on effectfulSteps alone the note would tell an engine that just edited files 'no edit or verification yet'. `other`-class Bash is precisely the shell we could NOT prove read-only, so it must count as work happening here — the classifier stays untouched (other remains budget-neutral) and only this note is suppressed. The cost is a false NEGATIVE on an unclassifiable read wrapper (`python -c "…read()"`) — the accepted-leak side of the spec, caught one layer up by the novelty-based no-progress checkpoint.
 */
export function shouldNoteReadSpiral(opts: {intent:string, readSteps:number, readRepeats:number, effectfulSteps:number, shellWorkSteps?:number, spiralThreshold:number, repeatThreshold:number, alreadyNoted:boolean}): boolean {
  if (opts.alreadyNoted) {
    return false;
  }
  if (readSpiralIntentFor(opts.intent) === 'investigate') {
    return Number(opts.readRepeats ?? 0) >= Number(opts.repeatThreshold ?? CESAR_READ_REPEAT_DEFAULT);
  }
  if (Number(opts.effectfulSteps ?? 0) > 0 || Number(opts.shellWorkSteps ?? 0) > 0) {
    return false;
  }
  return Number(opts.readSteps ?? 0) >= Number(opts.spiralThreshold ?? CESAR_READ_SPIRAL_DEFAULT);
}

/**
 * The machine-authored guard note appended to the next tool result. Edit intent asks for a summary then implementation-or-one-question; investigate intent asks for a summary and the ANSWER and deliberately never says 'implement'. Wording is bounded and states the observation before the ask, so the model can see why it arrived.
 */
export function readSpiralNote(intent: string, readSteps: number, readRepeats: number): string {
  if (readSpiralIntentFor(intent) === 'investigate') {
    return `[NOTE] ${Number(readRepeats ?? 0)} of your ${Number(readSteps ?? 0)} read/search calls this turn re-read something you already read. You have the material — summarize what you found and answer the question now. If a specific detail is genuinely missing, read exactly that one thing.`;
  }
  return `[NOTE] ${Number(readSteps ?? 0)} read/search calls this turn and no edit or verification yet. Mapping looks complete — summarize what you found, then either make the change or ask me ONE question if you are blocked on a decision. Do not keep reading.`;
}
