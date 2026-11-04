export type TeamRole = 'architect' | 'implementer' | 'reviewer' | 'captain';

export type TeamComposeMode = 'explicit' | 'auto-balanced' | 'adaptive';

export type TeamCoopStrategy = 'sequential' | 'parallel-merge' | 'role-based';

export interface TeamMember {
  engineId: string;
  role: TeamRole;
  weight: number;
}

export interface TeamSpec {
  teamId: string;
  name: string;
  lineupKey: string;
  source: TeamComposeMode;
  members: TeamMember[];
  aggregateElo: number;
}

export interface TeamFormat {
  membersPerSide: number;
  label: string;
}

export interface TeamRoundTrace {
  round: number;
  actor: string;
  role: TeamRole;
  action: 'planned'|'implemented'|'reviewed-accept'|'reviewed-reject'|'finalized';
  artifactSummary: string;
  durationMs: number;
}

export interface TeamSubmission {
  teamId: string;
  finalOutput: any;
  trace: TeamRoundTrace[];
  totalTokens: number;
  wallClockMs: number;
  collaborationLift: number;
}

export interface TeamScoreCard {
  teamId: string;
  score: number;
  breakdown: Record<string,number>;
}

export interface TeamMatchResult {
  matchId: string;
  mode: 'forge'|'tribunal'|'brainstorm';
  task: string;
  format: TeamFormat;
  teams: [TeamSpec, TeamSpec];
  submissions: Record<string,TeamSubmission>;
  scorecards: Record<string,TeamScoreCard>;
  winnerTeamId: string|null;
  timestamp: string;
  error?: string;
}

export type TeamEventType = 'team:compose' | 'team:round-start' | 'team:member-dispatch' | 'team:member-done' | 'team:round-done' | 'team:submit' | 'team:score' | 'team:winner' | 'team:match-done';

export interface TeamEvent {
  type: TeamEventType;
  engineId?: string;
  data?: Record<string, unknown>;
}
