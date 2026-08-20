// Barrel for the guard-pipeline modules in ./guards/.
// P1 GuardPipeline (Module D1): pure mode resolution + per-call/per-turn guard
// decisions (grounded-write, evidence, information-gain, confidence-gate) +
// the per-session read-path registry. Mirrors src/telemetry.ts's re-export of
// the generated/ tree. All decision fns are PURE (fileExists injected via the
// snapshot; the registry owns realpath canonicalization).

// ── Shared types ──────────────────────────────────────────────────────
export type {
  GuardMode, GuardSnapshot, GuardVerdict, GuardCall,
  TurnEvidence, SpinState, ConfidenceState,
} from './guards/guard-types.js';

// ── Mode resolution + config reader ───────────────────────────────────
export {
  resolveGuardMode, readGuardModesFromConfig, asGuardMode,
  DEFAULT_GUARD_MODE, GUARD_MODES,
} from './guards/config.js';
export type { UserGuardConfig } from './guards/config.js';

// ── Read-path registry (per-session service) ──────────────────────────
export {
  ReadPathRegistry, canonicalizePath, extractResultPaths,
} from './guards/read-path-registry.js';

// ── Grounded-write guard ──────────────────────────────────────────────
export {
  consultGroundedWrite, isWriteTool, writeTargetPath, groundedWriteFeedback,
} from './guards/grounded-write.js';

// ── Evidence guard ────────────────────────────────────────────────────
export {
  consultFinalText, isCompletionClaim, hasUnresolvedFailure, hasEvidence,
  stripNonAssertionSpans,
} from './guards/evidence.js';

// ── Information-gain guard ────────────────────────────────────────────
export {
  computeInfoGain, isStallStep, advanceStall, createInfoGainState, hashBashStdout,
  STALL_NUDGE_STEP, STALL_STRONG_NUDGE_STEP, STALL_HARD_STOP_STEP, GLOBAL_STALL_HARD_STOP,
} from './guards/information-gain.js';
export type { StepObservation, InfoGainState, StallResult } from './guards/information-gain.js';

// ── Confidence gate ───────────────────────────────────────────────────
export {
  consultConfidenceGate, isRiskyBash, isGatedCall, gatedCategory,
  BROAD_WRITE_THRESHOLD, DISPATCH_TOOLS, RISKY_BASH_RE,
} from './guards/confidence-gate.js';

// ── Pipeline orchestrator ─────────────────────────────────────────────
export {
  consultGuard, consultBatch, applyShadow, countDistinctWriteFiles,
} from './guards/guard-pipeline.js';
export type { ShadowableVerdict, BatchVerdict } from './guards/guard-pipeline.js';
