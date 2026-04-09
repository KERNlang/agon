// ── Session Store — KERN-sourced ──
export {
  saveSessionState, loadSessionState, clearSessionState,
  saveToolResultToDisk, loadToolResultFromDisk, pruneToolCache,
  sessionCacheDir,
} from './generated/signals/session-store.js';
export type { SessionStateV2 } from './generated/signals/session-store.js';
