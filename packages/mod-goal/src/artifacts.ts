import type { JournalState } from './journal-types.js';
import { isDone, remainingCount } from './journal.js';

/**
 * Compact human digest of a finished (or stopped) run — gaps closed/parked/failed, commits, spend, wall-clock. The detached-delegation callback ships this, never a transcript dump.
 */
export function summarizeGoal(state: JournalState): string {
  const by = (s: string) => state.tasks.filter((t) => t.status === s);
  const done = by('done'), parked = by('parked'), failed = by('failed');
  const inflight = by('inflight');
  const queued = by('queued');
  const mins = state.startedAt ? Math.round((Date.now() - state.startedAt) / 60_000) : 0;
  const hbAgeMin = state.heartbeatAt ? Math.round((Date.now() - state.heartbeatAt) / 60_000) : null;
  // A task mid-flight means the run is live (or crashed mid-task — the
  // heartbeat age below tells which). Previously this always read "stopped".
  const phase = isDone(state) ? 'complete' : inflight.length > 0 ? 'running' : 'stopped';
  const lines: string[] = [];
  lines.push(`# Goal ${state.spec.goalId} — ${phase}`);
  lines.push('');
  lines.push(`Intent: ${state.spec.intent}`);
  lines.push(`Branch: ${state.spec.branch}`);
  lines.push(`Tasks: ${done.length} done · ${inflight.length} in progress · ${parked.length} parked · ${failed.length} failed · ${queued.length} remaining`);
  lines.push(`Spend: $${state.spentUsd.toFixed(2)} / $${state.spec.budgetUsd || 0} · ${mins}m elapsed`);
  if (inflight.length) {
    lines.push('');
    lines.push('## In progress');
    for (const t of inflight) lines.push(`- ▶ implementing ${t.id} — ${t.source}${hbAgeMin != null ? ` (updated ${hbAgeMin}m ago)` : ''}`);
  }
  if (done.length) {
    lines.push('');
    lines.push('## Closed');
    for (const t of done) lines.push(`- ${t.id} — ${t.source}${t.commitSha ? ` (${t.commitSha.slice(0, 8)})` : ''}`);
  }
  if (parked.length) {
    lines.push('');
    lines.push('## Parked (needs a human)');
    for (const t of parked) lines.push(`- ${t.id} — ${t.notes ?? t.lastError ?? 'parked'}`);
  }
  return lines.join('\n');
}

/** Preserve the result shape used by historical Goal readers. */
export function createGoalResult(state: JournalState) {
  return {
    goalId: state.spec.goalId,
    intent: state.spec.intent,
    branch: state.spec.branch,
    done: isDone(state),
    remaining: remainingCount(state),
    spentUsd: state.spentUsd,
    oracleHash: state.oracleHash ?? null,
    startedAt: state.startedAt ?? null,
    endedAt: Date.now(),
    tasks: state.tasks.map((t) => ({ id: t.id, status: t.status, attempts: t.attempts, commitSha: t.commitSha ?? null })),
  };
}
