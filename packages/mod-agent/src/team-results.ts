import type { AgentStepResult } from '@kernlang/agon-support-agent-runtime';

/** One member's outcome from a team step. */
export interface AgentTeamMemberResult {
  engineId: string;
  worktreePath: string|null;
  stepResult: AgentStepResult|null;
  error: Error|null;
}

/** Team step outcome. Members retain their input order. */
export interface AgentTeamResult {
  members: AgentTeamMemberResult[];
  runId: string;
  baseSha: string;
  durationMs: number;
  succeeded: number;
  failed: number;
}
