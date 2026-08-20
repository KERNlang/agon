// Barrel for the persistent-session modules in ./sessions/ (the session
// itself plus its companion / ACP / stream-json / resume transports).
// Source: kern/persistent-session.kern → generated/persistent-session.ts
export { createPersistentSession } from './sessions/persistent-session.js';
export {
  createCompanionSession,
} from './sessions/session-companion.js';
export { createAcpSession } from './sessions/session-acp.js';
export {
  createStreamJsonSession,
} from './sessions/session-streamjson.js';
export { createResumeSession } from './sessions/session-resume.js';
export type {
  PersistentSession,
  PersistentSessionConfig,
  SessionChunk,
  SessionSendOptions,
} from './sessions/persistent-session.js';
