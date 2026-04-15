// ── Session Store — KERN-sourced ──
export {
  saveSessionState, loadSessionState, clearSessionState,
  saveToolResultToDisk, loadToolResultFromDisk, pruneToolCache,
  sessionCacheDir,
  saveConversation, loadConversation, clearConversation, stripEngineArtifacts,
} from './generated/signals/session-store.js';
export type { SessionStateV2, ConversationState } from './generated/signals/session-store.js';
