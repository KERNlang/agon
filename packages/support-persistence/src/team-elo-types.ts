export interface TeamCompositionRating {
  lineupKey: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
}

export interface TeamRoleRating {
  engineId: string;
  role: 'architect' | 'implementer' | 'reviewer' | 'captain';
  rating: number;
  wins: number;
  losses: number;
  matches: number;
}

export interface TeamEloRecord {
  byFormat: Record<string, {
    compositions: Record<string, TeamCompositionRating>;
    roles: Record<string, TeamRoleRating>;
  }>;
  lastUpdated: string;
}
