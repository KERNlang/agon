import type { TeamMatchResult, TeamSpec } from '@kernlang/agon-kernel';
import type { TeamBrainstormEvent } from './runtime.js';

export type TeamBrainstormDisplayEvent =
  | { type: 'info' | 'warning' | 'spinner-update'; message: string }
  | { type: 'header'; title: string }
  | { type: 'verdict'; summary: string };

export function presentTeamBrainstormEvent(
  event: TeamBrainstormEvent,
  dispatch: (event: TeamBrainstormDisplayEvent) => void,
): void {
  if (event.type === 'team:compose' && event.data?.teams) {
    const [teamA, teamB] = event.data.teams as [TeamSpec, TeamSpec];
    dispatch({ type: 'info', message: `Team Alpha: ${teamA.members.map(member => `${member.engineId}(${member.role})`).join(' + ')}` });
    dispatch({ type: 'info', message: `Team Beta: ${teamB.members.map(member => `${member.engineId}(${member.role})`).join(' + ')}` });
  }
  if (event.type === 'team:member-dispatch' && event.data) {
    dispatch({ type: 'spinner-update', message: `${String(event.data.engineId)} (${String(event.data.role)}) working...` });
  }
  if (event.type === 'engine:failed' && event.data) {
    dispatch({ type: 'warning', message: `${String(event.data.engineId ?? event.engineId)} failed during ${String(event.data.phase ?? 'team brainstorm')}` });
  }
}

export function presentTeamBrainstormResult(
  result: TeamMatchResult,
  outputDir: string,
  dispatch: (event: TeamBrainstormDisplayEvent) => void,
): void {
  const [teamA, teamB] = result.teams;
  const subA = result.submissions[teamA.teamId];
  const subB = result.submissions[teamB.teamId];
  const cardA = result.scorecards[teamA.teamId];
  const cardB = result.scorecards[teamB.teamId];
  dispatch({ type: 'header', title: `Team Alpha — ${teamA.name}` });
  dispatch({ type: 'info', message: `${teamA.members.map(member => `${member.engineId}(${member.role})`).join(' + ')} | Score: ${cardA?.score ?? '?'}` });
  dispatch({ type: 'verdict', summary: String(subA?.finalOutput ?? '(no submission)') });
  dispatch({ type: 'header', title: `Team Beta — ${teamB.name}` });
  dispatch({ type: 'info', message: `${teamB.members.map(member => `${member.engineId}(${member.role})`).join(' + ')} | Score: ${cardB?.score ?? '?'}` });
  dispatch({ type: 'verdict', summary: String(subB?.finalOutput ?? '(no submission)') });
  if (result.winnerTeamId) {
    const winner = result.winnerTeamId === teamA.teamId ? teamA : teamB;
    dispatch({ type: 'header', title: `Winner: ${winner.name}` });
  } else {
    dispatch({ type: 'header', title: 'Draw — no clear winner' });
  }
  dispatch({ type: 'info', message: `Full results saved: ${outputDir}` });
}
