import type { GuardId } from '../telemetry/guard-telemetry.js';

/**
 * Guard pipeline mode. 'strict' (default) = the existing inline guards run exactly as today; the new pipeline must not run. 'invariants' = the new pipeline runs and blocks/nudges/escalates for real. 'shadow' = the pipeline EVALUATES and emits telemetry but every block/nudge/escalate is downgraded to allow (the original verdict is preserved in shadowed).
 */
export type GuardMode = 'strict' | 'invariants' | 'shadow';

/**
 * Per-turn evidence accumulator the evidence guard reads. The session loop mutates it as tool results land; the guard only READS it.
 */
export interface TurnEvidence {
  successfulNonReadTool: boolean;
  diagnosticGreen: boolean;
  exhausted: boolean;
}

/**
 * Per-turn stall bookkeeping the information-gain guard reads + writes-through the registry. The pipeline returns updated counters; the caller persists them across steps.
 */
export interface SpinState {
  consecutiveStallSteps: number;
  globalStallSteps: number;
}

/**
 * Per-turn confidence reporting state the confidence-gate reads.
 */
export interface ConfidenceState {
  lastValue: number|null;
  reportedThisTurn: boolean;
}

/**
 * Immutable inputs to consultGuard / consultBatch / consultFinalText. The caller builds ONE per step (or per final-text check) from the session's registry + evidence + spin + confidence state. The decision fns NEVER mutate it. All paths in readPaths/everReadPaths are already canonicalized by the registry; fileExists is injected so core stays pure (the registry owns realpath canonicalization).
 */
export interface GuardSnapshot {
  engineId: string;
  step: number;
  mode: GuardMode;
  readPaths: Set<string>;
  everReadPaths: Set<string>;
  fileExists: (p:string)=>boolean;
  evidence: TurnEvidence;
  spin: SpinState;
  confidence: ConfidenceState;
}

/**
 * The minimal tool-call shape a per-call guard consult inspects: the tool name + its args (already-canonicalized target path where applicable).
 */
export interface GuardCall {
  name: string;
  args: Record<string,unknown>;
}

/**
 * A guard decision. 'allow' = let the call/break proceed. 'block' = reject the call with actionable feedback (grounded-write). 'nudge' = let it proceed but inject feedback (evidence, info-gain ladder). 'escalate' = route to the permission layer's 'ask' path (confidence-gate); the pipeline itself never prompts.
 */
export type GuardVerdict =
  | { action: 'allow' }
  | { action: 'block'; guardId: GuardId; reason: string; feedback: string }
  | { action: 'nudge'; guardId: GuardId; feedback: string }
  | { action: 'escalate'; guardId: GuardId; reason: string };
