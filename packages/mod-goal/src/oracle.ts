import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync, renameSync, rmSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
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
function hashOracleContents(gate: string, files: ReadonlyArray<{ path: string; content: Buffer }>): string {
  const h = createHash('sha256');
  h.update('gate\n');
  h.update(gate);
  h.update('\n');
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    h.update('file\n');
    h.update(file.path);
    h.update('\n');
    // Preserve old journal hashes. Snapshot verification also compares exact bytes.
    h.update(file.content.toString('utf8'));
    h.update('\n');
  }
  return h.digest('hex');
}

function readOracleFile(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`Goal oracle input is not a regular file: ${path}`);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

export function hashOracleInputs(gate: string, files: string[]): string {
  return hashOracleContents(gate, files.map(path => {
    let content: Buffer;
    try { content = readOracleFile(path); } catch { content = Buffer.alloc(0); }
    return { path, content };
  }));
}

function snapshotMatches(dir: string, gate: string, hash: string,
  captured: ReadonlyArray<{ path: string; content: Buffer }>, originalPaths: string[]): boolean {
  if (readOracleFile(join(dir, 'gate.txt')).toString('utf8') !== gate ||
      readOracleFile(join(dir, 'hash.txt')).toString('utf8') !== hash) return false;
  const mappingPath = join(dir, 'files.json');
  const mapping: unknown = existsSync(mappingPath) ? JSON.parse(readOracleFile(mappingPath).toString('utf8')) : originalPaths;
  if (!Array.isArray(mapping) || !mapping.every(path => typeof path === 'string') ||
      JSON.stringify([...mapping].sort()) !== JSON.stringify(captured.map(file => file.path).sort())) return false;
  return mapping.every((path, i) => {
    const source = captured.find(file => file.path === path);
    return source !== undefined && readOracleFile(join(dir, 'files', `${i}-${basename(path)}`)).equals(source.content);
  });
}

/**
 * True if the live oracle surface no longer matches the frozen hash (audit signal).
 */
export function oracleTampered(oracle: FrozenOracle, currentFiles: string[]): boolean {
  try {
    const captured = currentFiles.map(path => ({ path, content: readOracleFile(path) }));
    return hashOracleContents(oracle.gate, captured) !== oracle.hash ||
      !snapshotMatches(oracle.dir, oracle.gate, oracle.hash, captured, oracle.files);
  } catch { return true; }
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
    const captured = files.map(path => ({ path, content: readOracleFile(path) }));
    const hash = hashOracleContents(gate, captured);
    effects.ensureHome();
    const dir = effects.path('goals', goalId, 'oracle');
    const verifyExisting = () => {
      if (!snapshotMatches(dir, gate, hash, captured, files)) {
        throw new Error('Frozen Goal oracle differs from its recorded input. Restore the original input or start a new goal.');
      }
    };
    if (existsSync(dir)) {
      verifyExisting();
      return { dir, hash, gate, files: [...files] };
    }
    mkdirSync(dirname(dir), { recursive: true });
    const staging = mkdtempSync(join(dirname(dir), '.oracle-'));
    let failure: { error: unknown } | undefined;
    try {
      const filesDir = join(staging, 'files');
      mkdirSync(filesDir);
      writeFileSync(join(staging, 'gate.txt'), gate);
      captured.forEach((file, i) => {
        // Index prefixes keep equal basenames distinct.
        writeFileSync(join(filesDir, `${i}-${basename(file.path)}`), file.content);
      });
      writeFileSync(join(staging, 'hash.txt'), hash);
      writeFileSync(join(staging, 'files.json'), JSON.stringify(files));
      try { renameSync(staging, dir); }
      catch (error) {
        if (!existsSync(dir)) throw error;
        verifyExisting();
      }
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      try { rmSync(staging, { recursive: true, force: true }); }
      catch (cleanupError) {
        if (failure) throw new AggregateError([failure.error, cleanupError], `Goal oracle snapshot and staging cleanup failed: ${staging}`);
        throw cleanupError;
      }
    }
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
