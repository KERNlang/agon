// ── PersistentSession — KERN-sourced ─────────────────────────────────
// Source: kern/persistent-session.kern → generated/persistent-session.ts
export { createPersistentSession } from './generated/sessions/persistent-session.js';
export {
  createCompanionSession,
} from './generated/sessions/session-companion.js';
export { createAcpSession } from './generated/sessions/session-acp.js';
export {
  createStreamJsonSession,
} from './generated/sessions/session-streamjson.js';
export { createResumeSession } from './generated/sessions/session-resume.js';
export type {
  PersistentSession,
  PersistentSessionConfig,
  SessionChunk,
  SessionSendOptions,
} from './generated/sessions/persistent-session.js';
