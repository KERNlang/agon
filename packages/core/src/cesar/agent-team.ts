import { AgentTeamRuntime } from '@kernlang/agon-mod-agent';
import type { AgentTeamConfig as ModularAgentTeamConfig } from '@kernlang/agon-mod-agent';
import { repoRoot, worktreeCreate, worktreeRemoveBestEffort, worktreePruneAll, stashSnapshot } from '../blocks/git.js';
import { AgentSession } from './agent-session.js';
import type { ContextThread } from './context-thread.js';

export { makeAgentTeamError, makeAgentTeamDisposedError } from '@kernlang/agon-mod-agent';
export type { AgentTeamMemberConfig, AgentTeamBudget, AgentTeamMemberResult, AgentTeamResult } from '@kernlang/agon-mod-agent';

export interface AgentTeamConfig extends Omit<ModularAgentTeamConfig, 'thread'> {
  thread?: ContextThread;
}

/** Compatibility composition until host callers construct the Agent-owned runtime. */
export class AgentTeam extends AgentTeamRuntime {
  constructor(config: AgentTeamConfig) {
    super(config, {
      repoRoot,
      worktreeCreate,
      worktreeRemoveBestEffort,
      worktreePruneAll,
      stashSnapshot,
      createSession: sessionConfig => new AgentSession(sessionConfig),
    });
  }
}
