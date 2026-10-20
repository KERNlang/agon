import { randomUUID } from 'node:crypto';
import type { TeamComposeMode, TeamFormat, TeamMember, TeamSpec } from '@kernlang/agon-kernel';

export function lineupKey(engineIds: string[]): string {
  return [...engineIds].sort().join('+');
}

export function makeFormat(membersPerSide: number): TeamFormat {
  return { membersPerSide, label: `${membersPerSide}v${membersPerSide}` };
}

export function assignRankedTeamRoles(engineIds: string[], confidenceFloor: ((engineId: string) => number) | undefined): TeamMember[] {

  // Rank engines by Glicko-2 confidence floor
  const ranked = [...engineIds].sort((a, b) => {
    if (!confidenceFloor) return 0;
    const aFloor = confidenceFloor(a);
    const bFloor = confidenceFloor(b);
    if (aFloor !== bFloor) return bFloor - aFloor;
    return Math.random() - 0.5;
  });

  const n = ranked.length;
  const members: TeamMember[] = [];

  if (n === 1) {
    // Solo — engine does everything (captain)
    members.push({ engineId: ranked[0], role: 'captain', weight: 1.0 });
  } else if (n === 2) {
    // 2v2 — architect+implementer, architect also reviews
    members.push({ engineId: ranked[0], role: 'architect', weight: 0.6 });
    members.push({ engineId: ranked[1], role: 'implementer', weight: 0.4 });
  } else if (n === 3) {
    // 3v3 — architect + implementer + reviewer
    members.push({ engineId: ranked[0], role: 'architect', weight: 0.4 });
    members.push({ engineId: ranked[1], role: 'implementer', weight: 0.35 });
    members.push({ engineId: ranked[2], role: 'reviewer', weight: 0.25 });
  } else {
    // 4+ — architect + N-2 implementers + reviewer
    members.push({ engineId: ranked[0], role: 'architect', weight: 0.35 });
    const implWeight = 0.45 / (n - 2);
    for (let i = 1; i < n - 1; i++) {
      members.push({ engineId: ranked[i], role: 'implementer', weight: implWeight });
    }
    members.push({ engineId: ranked[n - 1], role: 'reviewer', weight: 0.20 });
  }

  return members;
}

export function composeRankedTeams(engineIds: string[], membersPerSide: number, mode: TeamComposeMode, loadConfidenceFloor: () => ((engineId: string) => number) | undefined, explicitTeams?: [string[],string[]]): [TeamSpec, TeamSpec] {
  const confidenceFloor = loadConfidenceFloor();

  function engineElo(id: string): number {
    return confidenceFloor ? Math.round(confidenceFloor(id)) : 100;
  }

  let teamA: string[];
  let teamB: string[];

  if (mode === 'explicit' && explicitTeams) {
    teamA = explicitTeams[0];
    teamB = explicitTeams[1];

    // Validate explicit teams — engines CAN appear on both teams (different roles, independent dispatches)
    if (teamA.length === 0 || teamB.length === 0) {
      throw new Error('Explicit teams must each have at least one member');
    }
    if (teamA.length !== membersPerSide || teamB.length !== membersPerSide) {
      throw new Error(`Explicit teams must each have exactly ${membersPerSide} members for ${membersPerSide}v${membersPerSide} format`);
    }
  } else if (mode === 'auto-balanced') {
    // Engines CAN appear on both teams — they're API calls, not physical resources
    // Fill each team to membersPerSide, reusing engines across teams as needed
    const sorted = [...engineIds].sort((a, b) => engineElo(b) - engineElo(a));
    teamA = [];
    teamB = [];

    // Round-robin: alternate picks, wrapping around the engine pool
    for (let i = 0; i < membersPerSide; i++) {
      teamA.push(sorted[i % sorted.length]);
    }
    for (let i = 0; i < membersPerSide; i++) {
      // Offset by 1 so teams get different role orderings
      teamB.push(sorted[(i + 1) % sorted.length]);
    }
  } else {
    // adaptive — maximize diversity: different engine orderings per team
    const sorted = [...engineIds].sort((a, b) => engineElo(b) - engineElo(a));
    const reversed = [...sorted].reverse();
    teamA = [];
    teamB = [];
    for (let i = 0; i < membersPerSide; i++) {
      teamA.push(sorted[i % sorted.length]);
      teamB.push(reversed[i % reversed.length]);
    }
  }

  const membersA = assignRankedTeamRoles(teamA, loadConfidenceFloor());
  const membersB = assignRankedTeamRoles(teamB, loadConfidenceFloor());

  const aggA = membersA.reduce((sum, m) => sum + engineElo(m.engineId), 0) / membersA.length;
  const aggB = membersB.reduce((sum, m) => sum + engineElo(m.engineId), 0) / membersB.length;

  const specA: TeamSpec = {
    teamId: randomUUID().slice(0, 8),
    name: `Team Alpha`,
    lineupKey: lineupKey(teamA),
    source: mode,
    members: membersA,
    aggregateElo: Math.round(aggA),
  };

  const specB: TeamSpec = {
    teamId: randomUUID().slice(0, 8),
    name: `Team Beta`,
    lineupKey: lineupKey(teamB),
    source: mode,
    members: membersB,
    aggregateElo: Math.round(aggB),
  };

  return [specA, specB];
}
