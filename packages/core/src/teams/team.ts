import type { TaskClass } from '../models/types.js';
import type { TeamComposeMode, TeamMember, TeamSpec } from '@kernlang/agon-kernel';
import { assignRankedTeamRoles, composeRankedTeams } from '@kernlang/agon-support-panel';
import { loadTeamConfidenceFloor } from '@kernlang/agon-mod-ratings';
export { lineupKey, makeFormat } from '@kernlang/agon-support-panel';
export { computeContributionWeights } from '@kernlang/agon-mod-ratings';
export type { TeamRole, TeamComposeMode, TeamCoopStrategy, TeamMember, TeamSpec, TeamFormat, TeamRoundTrace, TeamSubmission, TeamScoreCard, TeamMatchResult, TeamEventType, TeamEvent } from '@kernlang/agon-kernel';

export function assignTeamRoles(engineIds: string[], taskClass: TaskClass): TeamMember[] {
  return assignRankedTeamRoles(engineIds, loadTeamConfidenceFloor(taskClass));
}

export function composeTeams(engineIds: string[], membersPerSide: number, mode: TeamComposeMode, taskClass: TaskClass, explicitTeams?: [string[],string[]]): [TeamSpec, TeamSpec] {
  return composeRankedTeams(engineIds, membersPerSide, mode, () => loadTeamConfidenceFloor(taskClass), explicitTeams);
}
