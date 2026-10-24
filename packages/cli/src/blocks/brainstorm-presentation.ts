import { createBrainstormPresentation as createOwnedPresentation } from '@kernlang/agon-mod-brainstorm';
import type { Dispatch } from '../handlers/types.js';
import { ENGINE_COLORS } from './output-format.js';
import { icons } from '../signals/icons.js';
import { createScoreboard, scoreboardStartEngine, scoreboardFinishEngine, scoreboardFailEngine, renderScoreboard } from '../cesar/scoreboard.js';

/** Terminal capability binding; the physical mod owns presentation decisions. */
export function createBrainstormPresentation(dispatch: Dispatch) {
  return createOwnedPresentation({
    now: Date.now,
    scheduleEvery: (callback, milliseconds) => {
      const timer = setInterval(callback, milliseconds);
      return () => clearInterval(timer);
    },
    dispatch,
    icons,
    engineColor: engineId => ENGINE_COLORS[engineId] ?? 124,
    createScoreboard: runId => {
      const board = createScoreboard(runId, 'brainstorm', []);
      return {
        entries: () => board.entries,
        add: engineId => { board.entries.push({ engineId, state: 'waiting', progress: 0 }); },
        start: engineId => { scoreboardStartEngine(board, engineId); },
        finish: (engineId, result) => { scoreboardFinishEngine(board, engineId, result); },
        fail: (engineId, reason) => { scoreboardFailEngine(board, engineId, reason); },
        render: () => renderScoreboard(board),
      };
    },
  });
}
