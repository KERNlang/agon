// Facade over the generated guard-telemetry modules (source: src/kern/telemetry/*.kern).
// Phase 0 guard-fire telemetry: pure derive fns + per-turn tracker (Module A)
// and the JSONL/counters persistence layer (Module A2).
export {
  normalizeForHash, contentHashOf, tokenSetJaccard,
  deriveGroundedWriteResolution, deriveGroundedWriteResolutionMulti, deriveCalibrationBucket,
  createTurnTracker, GuardTurnTracker,
  GUARD_TELEMETRY_THRESHOLDS,
} from './generated/telemetry/guard-telemetry.js';
export type {
  GuardId, GuardResolutionLabel, CalibrationBucket,
  BlockedCallInfo, GuardFireResolution, GuardFireEvent,
  TurnTelemetryRecord, GuardTelemetryThresholds, ReadSpinThresholds,
} from './generated/telemetry/guard-telemetry.js';
export {
  guardTelemetryDir, guardTelemetryEnabled,
  appendGuardTelemetry, applyGuardCounters, updateGuardCounters,
  readGuardCounters, recommendGuardAction,
} from './generated/telemetry/guard-telemetry-store.js';
export type {
  GuardCounterCell, GuardTurnAggregate, GuardCounters,
} from './generated/telemetry/guard-telemetry-store.js';
