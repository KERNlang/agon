import type { PersistentSession } from '@kernlang/agon-core';

// Cleanup can fail after irreversible provider effects. Neither a new effect
// nor a new turn makes that same session safe to reuse. Weak identity keeps
// discarded sessions collectible; a genuinely new session starts healthy.
const failedCleanupSessions = new WeakSet<PersistentSession>();

export const SESSION_CLEANUP_FAILURE_MESSAGE = 'Session cleanup previously failed. Restart Agon before retrying; the previous provider session may not have stopped.';

export function markSessionCleanupFailed(session: PersistentSession): void {
  failedCleanupSessions.add(session);
}

export function sessionCleanupFailed(session: PersistentSession | null | undefined): boolean {
  return !!session && failedCleanupSessions.has(session);
}
