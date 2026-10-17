import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { spawnWithTimeout } from '@kernlang/agon-support-engine-runtime';
import { applyPatchToTree } from '@kernlang/agon-support-worktree';
import { assertSafeGoalId } from './paths.js';
import type { GoalJournalEffects } from './journal.js';

/**
 * Out-of-tree snapshot of the success oracle for a goal run.
 */
export interface FrozenOracle {
  dir: string;
  hash: string;
  gate: string;
  files: string[];
}

/**
 * Result of fail-on-base / pass-on-new witnessing for a new test.
 */
export interface WitnessResult {
  witnessed: boolean;
  failedOnBase: boolean;
  passedOnNew: boolean;
  baseTimedOut: boolean;
  baseExit: number;
  newExit: number;
  baseInvalidReason?: 'timeout' | 'cancelled' | 'execution' | 'module-load';
}

/** Known setup failures cannot establish that a behavioral check ran. */
function witnessResult(base: Awaited<ReturnType<typeof spawnWithTimeout>>, fresh: Awaited<ReturnType<typeof spawnWithTimeout>>): WitnessResult {
  const moduleLoadFailure = /Error \[(?:ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION)\]|code:\s*['"]MODULE_NOT_FOUND['"]|^(?:ModuleNotFoundError|ImportError):/m;
  const baseInvalidReason: WitnessResult['baseInvalidReason'] = base.timedOut ? 'timeout'
    : base.aborted || base.exitCode === 130 || base.exitCode === 143 ? 'cancelled'
      : base.spawnError || base.exitCode === 126 || base.exitCode === 127 ? 'execution'
        : moduleLoadFailure.test(`${base.stdout}\n${base.stderr}`) ? 'module-load' : undefined;
  const failedOnBase = base.exitCode !== 0 && !baseInvalidReason;
  const passedOnNew = fresh.exitCode === 0 && !fresh.timedOut && !fresh.aborted && !fresh.spawnError;
  return {
    witnessed: failedOnBase && passedOnNew,
    failedOnBase, passedOnNew, baseTimedOut: base.timedOut,
    baseExit: base.exitCode, newExit: fresh.exitCode,
    ...(baseInvalidReason ? { baseInvalidReason } : {}),
  };
}

/**
 * Stable sha256 over the gate string + each file's full path:content. Keys on the path-as-given (not basename) so same-named files in different dirs stay distinct.
 */
export function hashOracleInputs(gate: string, files: string[]): string {
  const h = createHash('sha256');
  h.update('gate\n');
  h.update(gate);
  h.update('\n');
  for (const f of [...files].sort()) {
    let content = '';
    try { content = existsSync(f) ? readFileSync(f, 'utf-8') : ''; } catch { content = ''; }
    h.update('file\n');
    h.update(f);
    h.update('\n');
    h.update(content);
    h.update('\n');
  }
  return h.digest('hex');
}

/**
 * True if the live oracle surface no longer matches the frozen hash (audit signal).
 */
export function oracleTampered(oracle: FrozenOracle, currentFiles: string[]): boolean {
  return hashOracleInputs(oracle.gate, currentFiles) !== oracle.hash;
}


export interface GoalOracleEffects extends GoalJournalEffects {
  spawnWithTimeout: typeof spawnWithTimeout;
  worktreeCreate(repoRoot: string, worktreePath: string, sha: string): string;
  worktreeRemoveBestEffort(repoRoot: string, worktreePath: string): void;
  resolveWithin(root: string, candidate: string): string;
}

/** Use the host's existing process, worktree and containment effects. */
export function createGoalOracle(effects: GoalOracleEffects) {
  /**
   * Freeze the gate string + oracle files into ~/.agon/goals/<id>/oracle/ and hash them. FrozenOracle.files holds the ORIGINAL paths (the basis of the hash), not the renamed copies.
   */
  function snapshotOracle(opts: {goalId:string, gate:string, files:string[]}): FrozenOracle {
    const { goalId, gate, files } = opts;
    assertSafeGoalId(goalId);
    effects.ensureHome();
    const dir = effects.path('goals', goalId, 'oracle');
    const filesDir = join(dir, 'files');
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(dir, 'gate.txt'), gate);
    files.forEach((f, i) => {
      if (!existsSync(f)) return;
      // index-prefix avoids basename collisions across dirs
      const dest = join(filesDir, `${i}-${basename(f)}`);
      try { copyFileSync(f, dest); } catch { /* skip unreadable */ }
    });
    const hash = hashOracleInputs(gate, files);
    writeFileSync(join(dir, 'hash.txt'), hash);
    return { dir, hash, gate, files: [...files] };
  }

  /**
   * Copy candidate tests onto the saved baseline and compare command results.
   * Reject timeouts, known setup failures and paths outside the worktree.
   * A differential result is evidence, not proof that an assertion ran.
   */
  async function witnessTest(opts: {repoRoot:string, baseSha:string, basePatch?:string, newWorktree:string, newTestFiles:string[], testCmd:string, timeout:number, signal?:AbortSignal}): Promise<WitnessResult> {
    const { repoRoot, baseSha, newWorktree, newTestFiles, testCmd, timeout } = opts;
    const baseWt = join(effects.path('goals', 'tmp'), `witness-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const timeoutMs = Math.max(1, timeout) * 1000;
    try {
      effects.worktreeCreate(repoRoot, baseWt, baseSha);
      if (opts.basePatch) {
        const applied = applyPatchToTree(baseWt, opts.basePatch);
        if (!applied.ok) throw new Error(`Cannot restore Goal verification baseline: ${applied.error}`);
      }
      // Carry the *new* tests back onto the old code, so the test exists on base.
      for (const rel of newTestFiles) {
        const src = effects.resolveWithin(newWorktree, rel);
        if (!existsSync(src)) continue;
        const dest = effects.resolveWithin(baseWt, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
      const base = await effects.spawnWithTimeout({ command: '/bin/sh', args: ['-c', testCmd], cwd: baseWt, timeout: timeoutMs, signal: opts.signal });
      const fresh = await effects.spawnWithTimeout({ command: '/bin/sh', args: ['-c', testCmd], cwd: newWorktree, timeout: timeoutMs, signal: opts.signal });
      return witnessResult(base, fresh);
    } finally {
      effects.worktreeRemoveBestEffort(repoRoot, baseWt);
    }
  }

  /**
   * Run the same trusted task command on baseline and candidate worktrees.
   * Restore accepted uncommitted work, but copy no candidate tests or code.
   * The command must prepare its own build and check the required behavior.
   * Known load failures are rejected; arbitrary shell failures remain ambiguous.
   * Cancellation stops the process. Cleanup also runs after cancellation.
   */
  async function witnessVerifyCommand(opts: {repoRoot:string, baseSha:string, basePatch?:string, newWorktree:string, verifyCmd:string, timeout:number, signal?:AbortSignal}): Promise<WitnessResult> {
    const { repoRoot, baseSha, newWorktree, verifyCmd, timeout } = opts;
    const baseWt = join(effects.path('goals', 'tmp'), `verify-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const timeoutMs = Math.max(1, timeout) * 1000;
    try {
      effects.worktreeCreate(repoRoot, baseWt, baseSha);
      if (opts.basePatch) {
        const applied = applyPatchToTree(baseWt, opts.basePatch);
        if (!applied.ok) throw new Error(`Cannot restore Goal verification baseline: ${applied.error}`);
      }
      const base = await effects.spawnWithTimeout({ command: '/bin/sh', args: ['-c', verifyCmd], cwd: baseWt, timeout: timeoutMs, signal: opts.signal });
      const fresh = await effects.spawnWithTimeout({ command: '/bin/sh', args: ['-c', verifyCmd], cwd: newWorktree, timeout: timeoutMs, signal: opts.signal });
      return witnessResult(base, fresh);
    } finally {
      effects.worktreeRemoveBestEffort(repoRoot, baseWt);
    }
  }
  return { snapshotOracle, witnessTest, witnessVerifyCommand };
}
