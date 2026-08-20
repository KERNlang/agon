import { describe, expect, it } from 'vitest';

import {
  createScoreboard,
  scoreboardStartEngine,
  scoreboardUpdateProgress,
} from '../../packages/cli/src/cesar/scoreboard.js';

const entryFor = (board: ReturnType<typeof createScoreboard>, id: string) =>
  board.entries.find((e) => e.engineId === id)!;

// Every scoreboard mutation resolves its target through one private lookup.
// If that lookup matched anything OTHER than the requested engine, a run would
// paint progress onto the wrong row — and with a single-engine board the bug is
// invisible, so these assertions use two engines on purpose.
describe('scoreboard entry lookup', () => {
  it('starts exactly the requested engine and leaves the others waiting', () => {
    const board = createScoreboard('run-1', 'forge', ['codex', 'claude']);

    scoreboardStartEngine(board, 'claude');

    expect(entryFor(board, 'claude').state).toBe('running');
    expect(entryFor(board, 'claude').startedAt).toBeTypeOf('number');
    expect(entryFor(board, 'codex').state).toBe('waiting');
    expect(entryFor(board, 'codex').startedAt).toBeUndefined();
  });

  it('routes progress to the named engine only', () => {
    const board = createScoreboard('run-1', 'forge', ['codex', 'claude']);

    scoreboardUpdateProgress(board, 'codex', 42);

    expect(entryFor(board, 'codex').progress).toBe(42);
    expect(entryFor(board, 'claude').progress).toBe(0);
  });

  it('is a no-op for an engine that is not on the board', () => {
    const board = createScoreboard('run-1', 'forge', ['codex', 'claude']);

    scoreboardUpdateProgress(board, 'gemini', 99);

    expect(board.entries.map((e) => e.progress)).toEqual([0, 0]);
    expect(board.entries.map((e) => e.state)).toEqual(['waiting', 'waiting']);
  });
});
