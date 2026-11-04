export interface PanelTeamMember { readonly engineId: string; readonly role: 'architect' | 'implementer' | 'reviewer' }
export interface PanelTeam { readonly teamId: 'ALPHA' | 'BETA'; readonly members: readonly PanelTeamMember[] }

/** Deterministic balanced composition. Engines may repeat when a requested format is wider than the roster. */
export function composePanelTeams(engineIds: readonly string[], membersPerTeam: number): readonly [PanelTeam, PanelTeam] {
  if (engineIds.length < 2) throw new TypeError('team modes require at least two engines');
  if (!Number.isFinite(membersPerTeam)) throw new TypeError('Team size must be a finite number');
  const size = Math.max(1, Math.floor(membersPerTeam));
  const member = (engineIndex: number, position: number): PanelTeamMember => ({
    engineId: engineIds[engineIndex % engineIds.length],
    role: position === 0 ? 'architect' : position === size - 1 && size > 2 ? 'reviewer' : 'implementer',
  });
  return [
    { teamId: 'ALPHA', members: Array.from({ length: size }, (_, index) => member(index * 2, index)) },
    { teamId: 'BETA', members: Array.from({ length: size }, (_, index) => member(index * 2 + 1, index)) },
  ];
}
