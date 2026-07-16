// ── Telemetry Ledger: run records, rolling win rates, task classification ──
// Persists ~/.agon/telemetry.json. Each run record captures orchestration
// mode, task type, pass/fail, and timing. Rolling win rates are computed
// over the last N runs per mode.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { tracker } from '@kernlang/agon-core';
import { runsStore } from '../generated/signals/runs-store.js';
import { summarizeIntentForEpisode } from '../generated/cesar/experience.js';

// ── Types ──────────────────────────────────────────────────────────────

export type TaskType =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'spec'
  | 'review'
  | 'question'
  | 'build'
  | 'pipeline'
  | 'agent'
  | 'unknown';

export interface OrchestrationResult {
  mode: string;
  intent?: string;
  winner?: string;
  success: boolean;
  durationMs: number;
  engineIds?: string[];
  fitnessCmd?: string;
  completionState: 'completed' | 'aborted' | 'crashed';
  error?: string;
}

export interface RunRecord {
  id: string;
  timestamp: number;
  mode: string;
  taskType: TaskType;
  winner: string | undefined;
  success: boolean;
  durationMs: number;
  engineIds: string[];
  completionState: string;
  costEstimateUsd?: number;
  intentSummary?: string;
}

export interface TelemetryFile {
  version: 1;
  runs: RunRecord[];
}

export interface WinRateEntry {
  mode: string;
  total: number;
  wins: number;
  rate: number;
}

export const DEFAULT_WINDOW = 50;

// ── Path helpers ───────────────────────────────────────────────────────

function getAgonHome(): string {
  const override = process.env.AGON_HOME?.trim();
  return override ? resolve(override) : join(homedir(), '.agon');
}

function telemetryPath(): string {
  return join(getAgonHome(), 'telemetry.json');
}

// ── classifyTaskType ───────────────────────────────────────────────────

/**
 * Map orchestration mode + intent text to a canonical TaskType.
 * Uses keyword heuristics on intent when available, falls back to mode.
 */
export function classifyTaskType(mode: string, intent?: string): TaskType {
  const m = mode.toLowerCase();
  const text = (intent ?? '').toLowerCase();

  // Review mode is always review
  if (m === 'review') return 'review';

  // Intent-based classification when text is present
  if (text.length > 0) {
    if (/\b(fix|bug|patch|hotfix|debug|regression|crash|error|issue)\b/.test(text)) return 'bugfix';
    if (/\b(add|implement|create|new|feature|support|enable)\b/.test(text)) return 'feature';
    if (/\b(refactor|cleanup|clean.?up|restructure|rename|move|extract|simplify|consolidate)\b/.test(text)) return 'refactor';
    if (/\b(spec|design|plan|proposal|architect)\b/.test(text)) return 'spec';
    if (/\b(question|explain|how|what|why|help|understand|clarify)\b/.test(text)) return 'question';
  }

  // Mode-based fallback
  if (m === 'build' || m === 'agent' || m === 'team-agent' || m === 'agent-solo') return 'build';
  if (m === 'pipeline') return 'pipeline';
  if (m === 'brainstorm' || m === 'team-brainstorm') return 'question';
  if (m === 'tribunal' || m === 'team-tribunal') return 'spec';
  if (m === 'campfire') return 'question';
  if (m === 'forge' || m === 'team-forge' || m === 'speculate') return 'feature';

  return 'unknown';
}

// ── TelemetryLedger ────────────────────────────────────────────────────

export class TelemetryLedger {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? telemetryPath();
  }

  /** Read the entire ledger file, returning an empty structure if missing/malformed. */
  read(): TelemetryFile {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as TelemetryFile;
      if (parsed && Array.isArray(parsed.runs)) return parsed;
    } catch {
      // file missing or malformed — return empty
    }
    return { version: 1, runs: [] };
  }

  /** Persist the ledger to disk atomically. */
  write(data: TelemetryFile): void {
    const dir = join(this.filePath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  /** Append a single run record. */
  append(record: RunRecord): void {
    const data = this.read();
    this.write({ ...data, runs: [...data.runs, record] });
  }

  /** Return the last N runs, optionally filtered by mode. */
  recentRuns(limit: number = DEFAULT_WINDOW, mode?: string): RunRecord[] {
    const data = this.read();
    let runs = data.runs;
    if (mode) runs = runs.filter((r) => r.mode === mode);
    return runs.slice(-limit);
  }

  /**
   * Compute rolling win rate over the last `window` runs.
   * Returns entries per mode found in the window, plus an overall entry.
   */
  winRates(window: number = DEFAULT_WINDOW): WinRateEntry[] {
    const runs = this.recentRuns(window);
    const byMode = new Map<string, { total: number; wins: number }>();

    for (const r of runs) {
      const entry = byMode.get(r.mode) ?? { total: 0, wins: 0 };
      entry.total += 1;
      if (r.success) entry.wins += 1;
      byMode.set(r.mode, entry);
    }

    const entries: WinRateEntry[] = [];
    for (const [mode, { total, wins }] of byMode) {
      entries.push({ mode, total, wins, rate: total > 0 ? wins / total : 0 });
    }

    // Overall entry
    const overallTotal = runs.length;
    const overallWins = runs.filter((r) => r.success).length;
    entries.push({
      mode: '__overall__',
      total: overallTotal,
      wins: overallWins,
      rate: overallTotal > 0 ? overallWins / overallTotal : 0,
    });

    return entries;
  }
}

// ── recordRun (convenience) ────────────────────────────────────────────

const defaultLedger = new TelemetryLedger();

/**
 * Record an orchestration run. Uses a process-wide TelemetryLedger singleton
 * writing to ~/.agon/telemetry.json.
 */
/** Read recent run records (newest last) from the process-wide ledger — the
 *  experience-precedent retrieval feed. */
export function recentRunRecords(limit: number = 200): RunRecord[] {
  return defaultLedger.recentRuns(limit);
}

export function recordRun(result: OrchestrationResult): RunRecord {
  const stats = typeof tracker?.getStats === 'function' ? tracker.getStats() : null;
  const record: RunRecord = {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    mode: result.mode,
    taskType: classifyTaskType(result.mode, result.intent),
    winner: result.winner,
    success: result.success,
    durationMs: result.durationMs,
    engineIds: result.engineIds ?? [],
    completionState: result.completionState,
    costEstimateUsd: stats?.totalCostUsd ?? undefined,
    intentSummary: summarizeIntentForEpisode(result.intent ?? '') || undefined,
  };
  defaultLedger.append(record);
  // A run record was written — forge also writes a ${forgeId}.json into
  // ~/.agon/runs around this point. Refresh the dashboard's cached runs
  // snapshot (debounced; coalesces forge's incremental writes) so the count
  // stays fresh without a render-path readdirSync. Best-effort: never let a
  // refresh failure affect recording.
  try { runsStore.scheduleRefresh(); } catch { /* non-critical */ }
  return record;
}

// ── formatRunSummary (CLI one-liner) ───────────────────────────────────

/** Format a human-readable post-run summary line. */
export function formatRunSummary(record: Pick<RunRecord, 'mode' | 'winner' | 'durationMs' | 'costEstimateUsd'>): string {
  const mode = record.mode;
  const winner = record.winner ?? '—';
  const cost = record.costEstimateUsd && record.costEstimateUsd > 0
    ? `~${record.costEstimateUsd.toFixed(2)}`
    : '';
  const mins = Math.floor(record.durationMs / 60000);
  const secs = Math.floor((record.durationMs % 60000) / 1000);
  const time = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const costText = cost ? ` · ${cost}` : '';
  return `${mode} complete → ${winner} won${costText} · ${time}`;
}
