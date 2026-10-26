import { scoreAgentTeamResult as scoreTeam } from '@kernlang/agon-mod-agent';
import type { EngineResult } from '../models/types.js';

import type { AgentTeamResult } from './agent-team.js';

import { worktreeChangedShortstat } from '../blocks/git.js';

import { determineWinner as rankCandidates } from '@kernlang/agon-support-judge';

/** Keep the legacy parameter type while sharing the comparison function. */
export const determineWinner: (
  results: Map<string, EngineResult>, spread: number,
) => ReturnType<typeof rankCandidates> = rankCandidates;


/** Preserve the public Core signature and supply the host Git reader. */
export function scoreAgentTeamResult(teamResult: AgentTeamResult, repoRoot: string, taskKind: 'edit'|'investigate', fitnessPassed?: Map<string,boolean>): Map<string,EngineResult> {
  return scoreTeam(teamResult, taskKind, fitnessPassed, worktreeChangedShortstat);
}
