import { describe, expect, it } from 'vitest';

import {
  PAUSE_MENU_ITEMS,
  createPauseState,
  dismissPauseState,
  movePauseCursor,
  selectPauseAction,
} from '../../packages/cli/src/cesar/pause-state.js';

// `active` is what the REPL keys off to show the pause menu at all. A freshly
// created pause state that is born inactive means Ctrl-P/pause silently does
// nothing — and every cursor move below becomes a no-op too (movePauseCursor
// returns the state untouched when !active).
describe('createPauseState', () => {
  it('is born active so the pause menu actually opens', () => {
    const state = createPauseState('run-1', 'forge');

    expect(state.active).toBe(true);
    expect(state.runId).toBe('run-1');
    expect(state.mode).toBe('forge');
    expect(state.menuIndex).toBe(0);
    expect(state.actions).toEqual(PAUSE_MENU_ITEMS.map((i) => i.action));
  });

  it('is active even without a run id or mode', () => {
    const state = createPauseState();

    expect(state.active).toBe(true);
    expect(state.runId).toBeUndefined();
    expect(state.mode).toBeUndefined();
  });

  it('accepts cursor movement, which only a live state does', () => {
    const state = createPauseState('run-1', 'forge');
    const total = state.actions.length;

    expect(movePauseCursor(state, 'down').menuIndex).toBe(1);
    expect(movePauseCursor(createPauseState('run-1'), 'up').menuIndex).toBe(total - 1);
  });

  it('dismisses to an inactive, empty-menu state', () => {
    const dismissed = dismissPauseState();

    expect(dismissed.active).toBe(false);
    expect(dismissed.actions).toEqual([]);
    expect(movePauseCursor(dismissed, 'down')).toBe(dismissed);
  });

  it('selects the action under the cursor and closes on resume/cancel', () => {
    const state = createPauseState('run-1');

    const picked = selectPauseAction(state);

    expect(picked.action).toBe(PAUSE_MENU_ITEMS[0].action);
    expect(picked.state.active).toBe(false);
  });
});
