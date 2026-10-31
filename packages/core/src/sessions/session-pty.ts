/** @deprecated S4 compatibility adapter. Import from @kernlang/agon-support-persistence. */
import { createPtySession as createSupportPtySession } from '@kernlang/agon-support-persistence';

import type { PersistentSessionConfig } from './persistent-session.js';
import type { PersistentSession } from '@kernlang/agon-support-persistence';

export * from '@kernlang/agon-support-persistence';

export function createPtySession(config: PersistentSessionConfig): PersistentSession {
  return createSupportPtySession(config) as unknown as PersistentSession;
}
