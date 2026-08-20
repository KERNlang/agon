export type PauseMenuAction = 'resume' | 'retry' | 'cancel' | 'checkpoint' | 'noop';

export interface PauseState {
  active: boolean;
  runId?: string;
  mode?: string;
  menuIndex: number;
  actions: PauseMenuAction[];
}

export const PAUSE_MENU_ITEMS: {label:string,action:PauseMenuAction}[] = [{ label: '▶  Resume', action: 'resume' as PauseMenuAction }, { label: '↻ Retry last step', action: 'retry' as PauseMenuAction }, { label: '⚑  Show checkpoint', action: 'checkpoint' as PauseMenuAction }, { label: '✘ Cancel run', action: 'cancel' as PauseMenuAction }];

export function createPauseState(runId?: string, mode?: string): PauseState {
  return { active: true, runId: runId ?? undefined, mode: mode ?? undefined, menuIndex: 0, actions: PAUSE_MENU_ITEMS.map((i) => i.action) };
}

export function dismissPauseState(): PauseState {
  return { active: false, menuIndex: 0, actions: [] };
}

export function movePauseCursor(state: PauseState, direction: 'up'|'down'): PauseState {
  if (!state.active || state.actions.length === 0) {
    return state;
  }
  const delta = (direction === 'up') ? (-1) : 1;
  const next = state.menuIndex + delta;
  state.menuIndex = (next % state.actions.length + state.actions.length) % state.actions.length;
  return state;
}

export function selectPauseAction(state: PauseState): {state:PauseState,action:PauseMenuAction} {
  const action = state.actions[state.menuIndex] ?? 'noop';
  if (action === 'cancel' || action === 'resume') {
    return { state: dismissPauseState(), action: action };
  }
  return { state: state, action: action };
}

