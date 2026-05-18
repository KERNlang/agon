// @agon/kern-engines — engine substrates for driving CLI/API agents.
//
// Polyglot package: this barrel exposes TS twins; Python twins live in the
// same .py files side-by-side. Public surfaces match per engine but the
// shapes do NOT pretend to unify across CLI and API tiers (see CLAUDE.md).

export {
  PtyCliSession,
  PtySessionError,
} from './cli/session.js';
export type { SpawnOptions } from './cli/session.js';

export {
  ClaudeCliSession,
  ClaudeSessionError,
  ClaudeSessionTimeout,
  askOnce as askClaudeOnce,
} from './cli/claude.js';
export type { ClaudeSpawnOptions } from './cli/claude.js';
