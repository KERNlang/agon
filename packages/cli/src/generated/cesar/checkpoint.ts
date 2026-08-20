import { join } from 'node:path';

import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';

import { RUNS_DIR, resolveWorkingDir, currentBranch, gitChangedFiles } from '@kernlang/agon-core';

import { hostNowMs } from '../lib/kern-host.js';

export type CheckpointPhase = 'pre-dispatch' | 'post-dispatch' | 'post-judgment' | 'user-pause';

export interface Checkpoint {
  id: string;
  runId: string;
  phase: CheckpointPhase;
  ts: number;
  cwd: string;
  branch: string;
  changedFiles: string[];
  mode: string;
  engineIds: string[];
  metadata?: Record<string,unknown>;
}

function createCheckpointId(): string {
  return `chk-${hostNowMs().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function buildCheckpoint(runId: string, phase: CheckpointPhase, mode: string, engineIds: string[], metadata?: Record<string,unknown>): Checkpoint {
  const cwd = resolveWorkingDir();
  let branch = '';
  let changedFiles: string[] = [];
  try { branch = currentBranch(cwd); } catch { /* noop */ }
  try { changedFiles = gitChangedFiles(cwd); } catch { /* noop */ }
  return {
    id: createCheckpointId(),
    runId,
    phase,
    ts: Date.now(),
    cwd,
    branch,
    changedFiles,
    mode,
    engineIds,
    metadata,
  };
}

/**
 * Append checkpoint to JSONL.  Best-effort: never throws.
 */
export function recordCheckpoint(cp: Checkpoint, runsDir?: string): void {
  try {
    const dir = runsDir ?? RUNS_DIR;
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'checkpoints.jsonl'), JSON.stringify(cp) + '\n');
  } catch { /* checkpoints are advisory */ }
}

export function listCheckpoints(opts?: {runId?:string,phase?:CheckpointPhase,limit?:number,runsDir?:string}): Checkpoint[] {
  const dir = opts?.runsDir ?? RUNS_DIR;
  const path = join(dir, 'checkpoints.jsonl');
  if (!existsSync(path)) return [];
  let raw = '';
  try {
    raw = readFileSync(path, 'utf-8');
  } catch { return []; }
  const out: Checkpoint[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Checkpoint;
      if (opts?.runId && parsed.runId !== opts.runId) continue;
      if (opts?.phase && parsed.phase !== opts.phase) continue;
      out.push(parsed);
    } catch { /* skip corrupt */ }
  }
  out.sort((a, b) => b.ts - a.ts);
  const limit = opts?.limit ?? 50;
  return out.slice(0, limit);
}


