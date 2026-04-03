// ── Flow tracking — KERN-sourced ─────────────────────────────────────
// Source of truth: kern/flow.kern → generated/flow.ts
export {
  logFlow,
  readFlows,
  analyzeFlows,
  FLOWS_DIR,
  FRICTION_TAGS,
} from './generated/flow.js';
export type {
  FlowRecord,
  FlowTelemetry,
  FlowFeedback,
  FlowModeMeta,
  FlowAnalysis,
  ModeStats,
} from './generated/flow.js';
