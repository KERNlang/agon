import { ENGINE_COLORS } from '../blocks/output-format.js';

import { hostNowMs } from '../lib/kern-host.js';

export type ScoreboardEngineState = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ScoreboardEntry {
  engineId: string;
  state: ScoreboardEngineState;
  startedAt?: number;
  finishedAt?: number;
  progress: number;
  score?: number;
  result?: string;
  error?: string;
}

export interface Scoreboard {
  runId: string;
  mode: string;
  startedAt: number;
  entries: ScoreboardEntry[];
  overallState: 'running'|'done'|'failed'|'cancelled';
}

export function createScoreboard(runId: string, mode: string, engineIds: string[]): Scoreboard {
  const now = hostNowMs();
  return { runId: runId, mode: mode, startedAt: now, entries: engineIds.map((id) => Object.assign({}, { engineId: id, state: 'waiting' as ScoreboardEngineState, progress: 0 })), overallState: 'running' };
}

function scoreboardFind(board: Scoreboard, engineId: string): ScoreboardEntry|undefined {
  return board.entries.find((e) => e.engineId === engineId);
}

export function scoreboardStartEngine(board: Scoreboard, engineId: string): Scoreboard {
  const entry = scoreboardFind(board, engineId);
  if (!entry) {
    return board;
  }
  entry.state = 'running';
  entry.startedAt = hostNowMs();
  return board;
}

export function scoreboardUpdateProgress(board: Scoreboard, engineId: string, progress: number): Scoreboard {
  const entry = scoreboardFind(board, engineId);
  if (!entry) {
    return board;
  }
  entry.progress = Math.max(0, Math.min(100, Math.floor(progress)));
  return board;
}

export function scoreboardFinishEngine(board: Scoreboard, engineId: string, opts?: {score?:number,result?:string}): Scoreboard {
  const entry = scoreboardFind(board, engineId);
  if (!entry) {
    return board;
  }
  entry.state = 'done';
  entry.finishedAt = hostNowMs();
  entry.progress = 100;
  if (opts?.score !== undefined) {
    entry.score = opts.score;
  }
  if (opts?.result !== undefined) {
    entry.result = opts.result;
  }
  scoreboardRecomputeOverall(board);
  return board;
}

export function scoreboardFailEngine(board: Scoreboard, engineId: string, error: string): Scoreboard {
  const entry = scoreboardFind(board, engineId);
  if (!entry) {
    return board;
  }
  entry.state = 'failed';
  entry.finishedAt = hostNowMs();
  entry.error = error;
  scoreboardRecomputeOverall(board);
  return board;
}


function scoreboardRecomputeOverall(board: Scoreboard): void {
  if (board.entries.every((e) => e.state === 'done')) {
    board.overallState = 'done';
  } else if (board.entries.every((e) => e.state === 'failed')) {
    board.overallState = 'failed';
  } else if (board.entries.every((e) => e.state === 'done' || e.state === 'failed' || e.state === 'cancelled')) {
    board.overallState = 'done';
  } else if (board.entries.some((e) => e.state === 'running')) {
    board.overallState = 'running';
  }
}

export function formatScoreboardLine(entry: ScoreboardEntry): string {
  // Inline icon literals to avoid loadConfig() dependency in test envs
  const iconMap: Record<ScoreboardEngineState, string> = {
    waiting: '\u25c7',
    running: '\u25d0',
    done: '\u2714',
    failed: '\u2718',
    cancelled: '\u25c7',
  };
  const color = ENGINE_COLORS[entry.engineId] ?? 245;
  const icon = iconMap[entry.state];
  const bar = entry.state === 'running'
    ? `${entry.progress}%`
    : (entry.state === 'done' && entry.score != null)
      ? `score ${entry.score}`
      : '';
  const result = entry.result ? ` \u2014 ${entry.result}` : '';
  const error = entry.error ? ` [${entry.error}]` : '';
  return `\x1b[38;5;${color}m${icon} ${entry.engineId}${bar ? ` ${bar}` : ''}${result}${error}\x1b[0m`;
}

export function renderScoreboard(board: Scoreboard): string {
  const lines = board.entries.map((e) => formatScoreboardLine(e));
  return lines.join('\n');
}
