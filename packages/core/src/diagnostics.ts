// Facade over the generated diagnostics modules (source: src/kern/diagnostics/*.kern).
// Module D2 — post-edit type/lint checker: checker discovery + the per-session
// DiagnosticRunner (debounce 400ms/packageDir, single in-flight, 4s budget,
// lazy fingerprint baseline with CLEAN_BASELINE sentinel, introduced/ripple
// split, 20-line digest + full output on disk, bounded newest-wins drain).
export {
  discoverChecker, parseCheckerOutput,
  normalizeMessage, fingerprintOf,
  REPO_ROOT_MARKERS, RUFF_CONFIG_FILES,
} from './generated/diagnostics/checker-discovery.js';
export type {
  CheckerPlan, CheckerLine, CheckerLang,
} from './generated/diagnostics/checker-discovery.js';
export {
  DiagnosticRunner,
  normalizeEditedPath, renderDigestText,
  DEBOUNCE_MS, BUDGET_MS, DIGEST_MAX_LINES, QUEUE_CAP, CLEAN_BASELINE,
} from './generated/diagnostics/diagnostic-runner.js';
export type {
  DiagnosticDigest, SpawnLike,
} from './generated/diagnostics/diagnostic-runner.js';
