export interface PanelTeamMember { readonly engineId: string; readonly role: 'architect' | 'implementer' | 'reviewer' }
export interface PanelTeam { readonly teamId: 'ALPHA' | 'BETA'; readonly members: readonly PanelTeamMember[] }

/** Deterministic balanced composition. Engines may repeat when a requested format is wider than the roster. */
export function composePanelTeams(engineIds: readonly string[], membersPerTeam: number): readonly [PanelTeam, PanelTeam] {
  if (engineIds.length < 2) throw new TypeError('team modes require at least two engines');
  const size = Math.max(1, Math.floor(membersPerTeam));
  const member = (index: number): PanelTeamMember => ({
    engineId: engineIds[index % engineIds.length],
    role: index % size === 0 ? 'architect' : index % size === size - 1 && size > 2 ? 'reviewer' : 'implementer',
  });
  return [
    { teamId: 'ALPHA', members: Array.from({ length: size }, (_, index) => member(index * 2)) },
    { teamId: 'BETA', members: Array.from({ length: size }, (_, index) => member(index * 2 + 1)) },
  ];
}
