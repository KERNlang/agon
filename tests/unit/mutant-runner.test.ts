// Pins the shared, budgeted mutant runner (packages/core/src/kern/tools/mutant-runner.kern).
//
// Every case runs against a disposable COPY of tests/fixtures/mutate-tautology,
// a dependency-free mini-repo whose two test variants (real assertions vs.
// `expect(true).toBe(true)`) make kill/survive deterministic. The fixture's
// checks are `.mjs` scripts on purpose so the repo's own vitest run never
// collects them.
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMutants } from '../../packages/core/src/generated/tools/mutant-generator.js';
import { runMutants } from '../../packages/core/src/generated/tools/mutant-runner.js';
import type { Mutant } from '../../packages/core/src/generated/tools/mutant-generator.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/mutate-tautology', import.meta.url));
const sandboxes: string[] = [];

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-mutant-runner-'));
  cpSync(FIXTURE, dir, { recursive: true });
  sandboxes.push(dir);
  return dir;
}

function addMutants(dir: string): Mutant[] {
  // L2 = `return a + b;`, L6 = `return n > 0;`
  return generateMutants(readFileSync(join(dir, 'src/add.ts'), 'utf-8'), [2, 6], 'src/add.ts');
}

function loopMutants(dir: string): Mutant[] {
  // L5 = `i = i - 1;` — the only mutant is `-` → `+`, which makes the loop infinite.
  return generateMutants(readFileSync(join(dir, 'src/loop.ts'), 'utf-8'), [5], 'src/loop.ts');
}

afterEach(() => {
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const base = { perMutantTimeoutSec: 20, totalBudgetSec: 120 };

describe('runMutants — kill / survive', () => {
  it('kills every mutant when the test asserts real values', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);
    expect(mutants.length).toBeGreaterThanOrEqual(3);

    const report = await runMutants({ ...base, worktree: dir, mutants, testCmd: 'node check-real.mjs' });

    expect(report.baselineOk).toBe(true);
    expect(report.baselineError).toBeUndefined();
    expect(report.generated).toBe(mutants.length);
    expect(report.outcomes).toHaveLength(mutants.length);
    expect(report.survived).toBe(0);
    expect(report.killed).toBe(mutants.length);
    expect(report.score).toBe(1);
    expect(report.notRun).toBe(0);
    expect(report.budgetExhausted).toBe(false);
    expect(report.outcomes.every((o) => o.status === 'killed')).toBe(true);
  });

  it('reports every mutant as a survivor when the only assertion is a tautology', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({ ...base, worktree: dir, mutants, testCmd: 'node check-tautology.mjs' });

    expect(report.baselineOk).toBe(true);
    expect(report.killed).toBe(0);
    expect(report.survived).toBe(mutants.length);
    expect(report.score).toBe(0);
    expect(report.outcomes.filter((o) => o.mutant.class === 'high-signal').length).toBeGreaterThan(0);
  });

  it('restores every touched file, byte for byte', async () => {
    const dir = sandbox();
    const before = readFileSync(join(dir, 'src/add.ts'), 'utf-8');

    await runMutants({ ...base, worktree: dir, mutants: addMutants(dir), testCmd: 'node check-tautology.mjs' });

    expect(readFileSync(join(dir, 'src/add.ts'), 'utf-8')).toBe(before);
  });
});

describe('runMutants — invalid mutants', () => {
  // The typecheck command must be GREEN on the unmutated tree and red on every
  // mutant — `exit 3` would now (correctly) be a baseline failure instead.
  it('marks a mutant invalid when the typecheck command rejects it, and excludes it from the score', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);
    cpSync(join(dir, 'src/add.ts'), join(dir, 'src/add.pristine'));

    const report = await runMutants({
      ...base, worktree: dir, mutants, testCmd: 'node check-real.mjs',
      typecheckCmd: 'cmp -s src/add.ts src/add.pristine',
    });

    expect(report.baselineOk).toBe(true);
    expect(report.invalid).toBe(mutants.length);
    expect(report.killed).toBe(0);
    expect(report.survived).toBe(0);
    expect(report.score).toBeNull();
    expect(report.outcomes.every((o) => o.status === 'invalid')).toBe(true);
    expect(report.outcomes[0].reason).toContain('does not typecheck');
  });

  // A pre-existing type error used to mark EVERY mutant invalid while the run
  // still reported baselineOk — a clean-looking report that measured nothing.
  it('treats a typecheck command that is already red as a BASELINE failure, not as N invalid mutants', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({
      ...base, worktree: dir, mutants, testCmd: 'node check-real.mjs', typecheckCmd: 'exit 3',
    });

    expect(report.baselineOk).toBe(false);
    expect(report.baselineError).toContain('typecheck command fails before any mutation');
    expect(report.outcomes).toHaveLength(0);
    expect(report.invalid).toBe(0);
    expect(report.notRun).toBe(mutants.length);
  });
});

describe('runMutants — a mutant that cannot be placed is invalid, never a throw', () => {
  it('grades a file-less mutant invalid and still runs the rest', async () => {
    const dir = sandbox();
    const fileless: Mutant = { id: 'nofile', operator: 'x', line: 1, before: 'a', after: 'b', class: 'high-signal' };
    const mutants = [fileless, ...addMutants(dir)];

    const report = await runMutants({ ...base, worktree: dir, mutants, testCmd: 'node check-real.mjs' });

    expect(report.baselineOk).toBe(true);
    expect(report.outcomes).toHaveLength(mutants.length);
    expect(report.outcomes[0].status).toBe('invalid');
    expect(report.outcomes[0].reason).toContain("no 'file'");
    expect(report.killed).toBe(mutants.length - 1);
  });

  it('grades a mutant whose file escapes the sandbox invalid, and never writes outside', async () => {
    const dir = sandbox();
    const escaping: Mutant = {
      id: 'evil', operator: 'x', line: 1, before: 'a', after: 'b',
      class: 'high-signal', file: '../escape.ts', origin: 'mechanical',
    };

    const report = await runMutants({ ...base, worktree: dir, mutants: [escaping], testCmd: 'node check-real.mjs' });

    expect(report.invalid).toBe(1);
    expect(report.outcomes[0].status).toBe('invalid');
    expect(report.outcomes[0].reason).toContain('escapes');
  });

  // The blocking finding: containment used to be LEXICAL, but writeFileSync
  // follows symlinks — an in-sandbox link could rewrite the user's own tree.
  it('refuses to write through a symlink that leaves the sandbox', async () => {
    const dir = sandbox();
    const outside = mkdtempSync(join(tmpdir(), 'agon-mutant-outside-'));
    sandboxes.push(outside);
    const victim = join(outside, 'victim.ts');
    writeFileSync(victim, 'export const untouched = true;\n');
    mkdirSync(join(dir, 'src/link'), { recursive: true });
    symlinkSync(victim, join(dir, 'src/link/victim.ts'), 'file');

    const escaping: Mutant = {
      id: 'link', operator: 'x', line: 1, before: 'export const untouched = true;',
      after: 'export const untouched = false;', class: 'high-signal',
      file: 'src/link/victim.ts', origin: 'mechanical',
    };
    const report = await runMutants({ ...base, worktree: dir, mutants: [escaping], testCmd: 'node check-real.mjs' });

    expect(report.invalid).toBe(1);
    expect(report.outcomes[0].reason).toContain('symlink');
    expect(readFileSync(victim, 'utf-8')).toBe('export const untouched = true;\n');
  });

  // A mutant applied to a line that no longer matches `before` is a NO-OP write:
  // the green baseline passes and the mutant is scored as a SURVIVOR — a
  // fabricated weak-test signal.
  it('grades a drifted mutant invalid instead of reporting a fake survivor', async () => {
    const dir = sandbox();
    const drifted: Mutant = {
      id: 'drift', operator: 'arith:+→-', line: 2, before: 'return a * b;', after: 'return a / b;',
      class: 'high-signal', file: 'src/add.ts', origin: 'mechanical',
    };

    const report = await runMutants({ ...base, worktree: dir, mutants: [drifted], testCmd: 'node check-real.mjs' });

    expect(report.survived).toBe(0);
    expect(report.invalid).toBe(1);
    expect(report.outcomes[0].reason).toContain('source drifted');
  });
});

describe('runMutants — a hang is a kill', () => {
  it('classifies a timed-out mutant as timeout AND counts it as killed', async () => {
    const dir = sandbox();
    const mutants = loopMutants(dir);
    expect(mutants).toHaveLength(1);
    expect(mutants[0].operator).toBe('arith:-→+');

    const report = await runMutants({
      worktree: dir, mutants, testCmd: 'node check-loop.mjs',
      perMutantTimeoutSec: 1, totalBudgetSec: 60,
    });

    expect(report.baselineOk).toBe(true);
    expect(report.outcomes[0].status).toBe('timeout');
    expect(report.timeouts).toBe(1);
    expect(report.killedByTimeout).toBe(1);
    expect(report.killed).toBe(1);
    expect(report.survived).toBe(0);
    expect(report.score).toBe(1);
  }, 30_000);
});

describe('runMutants — budget', () => {
  // The budget is a REAL wall clock now: it also bounds setup, so a budget too
  // small for the baseline stops the run before any mutant instead of silently
  // running for minutes.
  it('stops before the baseline when the budget cannot even cover setup', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({
      worktree: dir, mutants, testCmd: 'node check-real.mjs',
      perMutantTimeoutSec: 20, totalBudgetSec: 0.001,
    });

    expect(report.baselineOk).toBe(false);
    expect(report.baselineError).toContain('total budget');
    expect(report.outcomes).toHaveLength(0);
    expect(report.notRun).toBe(mutants.length);
    expect(report.budgetExhausted).toBe(true);
    expect(report.score).toBeNull();
  });

  // A command the BUDGET cut short is not evidence: it must be notRun, never a
  // timeout (which counts as a kill) or invalid.
  it('counts a mutant whose subprocess the budget cut as notRun, not as killed', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({
      // The baseline test is `true`, not a node script: with a node baseline the
      // ~1.2s build plus node's startup can eat the budget on a loaded runner
      // and the BASELINE becomes what the budget cuts, not the mutant.
      worktree: dir, mutants, testCmd: 'true', buildCmd: 'sleep 1.2',
      perMutantTimeoutSec: 20, totalBudgetSec: 2,
    });

    expect(report.baselineOk).toBe(true);
    expect(report.outcomes).toHaveLength(0);
    expect(report.notRun).toBe(mutants.length);
    expect(report.budgetExhausted).toBe(true);
    expect(report.killed).toBe(0);
    expect(report.timeouts).toBe(0);
    expect(report.invalid).toBe(0);
  }, 30_000);
});

describe('runMutants — abort', () => {
  it('reports an abort as notRun + aborted, never as evidence about the tests', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);

    const report = await runMutants({
      ...base, worktree: dir, mutants, testCmd: 'node check-real.mjs', signal: controller.signal,
    });

    expect(report.aborted).toBe(true);
    expect(report.budgetExhausted).toBe(false);
    expect(report.notRun).toBeGreaterThan(0);
    expect(report.killed + report.survived + report.invalid).toBe(report.outcomes.length);
  }, 30_000);
});

describe('runMutants — baseline', () => {
  it('refuses to run a single mutant when the unmutated suite is already red', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({ ...base, worktree: dir, mutants, testCmd: 'exit 7' });

    expect(report.baselineOk).toBe(false);
    expect(report.baselineError).toContain('test command fails before any mutation in the sandbox');
    expect(report.baselineError).toContain('exit 7');
    expect(report.outcomes).toHaveLength(0);
    expect(report.notRun).toBe(mutants.length);
    expect(report.killed).toBe(0);
    expect(report.score).toBeNull();
  });

  it('reports a failing build command before the baseline is even attempted', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({
      ...base, worktree: dir, mutants, testCmd: 'node check-real.mjs', buildCmd: 'exit 2',
    });

    expect(report.baselineOk).toBe(false);
    expect(report.baselineError).toContain('build command fails before any mutation');
    expect(report.baselineMs).toBe(0);
    expect(report.outcomes).toHaveLength(0);
  });
});

describe('runMutants — per-mutant command ORDER', () => {
  // Build must run BEFORE typecheck, the same order the baseline ran in. With
  // the order inverted, a compiled target is typechecked against the artifacts
  // the PREVIOUS mutant's build left behind.
  it('runs build → typecheck → test for every mutant, matching the baseline order', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir).slice(0, 2);

    const report = await runMutants({
      ...base,
      worktree: dir,
      mutants,
      buildCmd: "printf 'build\\n' >> order.log",
      typecheckCmd: "printf 'typecheck\\n' >> order.log",
      testCmd: "printf 'test\\n' >> order.log && node check-real.mjs",
    });

    expect(report.baselineOk).toBe(true);
    expect(report.outcomes).toHaveLength(mutants.length);

    const seq = readFileSync(join(dir, 'order.log'), 'utf-8').trim().split('\n');
    // One build→typecheck→test triple for the baseline, then one per mutant.
    expect(seq).toHaveLength(3 * (mutants.length + 1));
    for (let i = 0; i <= mutants.length; i += 1) {
      expect(seq.slice(i * 3, i * 3 + 3)).toEqual(['build', 'typecheck', 'test']);
    }
  }, 60_000);

  // The recording fake: `build` publishes an ARTIFACT from the mutated source
  // and `typecheck` reads only that artifact. Build-first means the artifact is
  // this mutant's; typecheck-first means it is the previous mutant's (or the
  // baseline's) — which is exactly how a build-breaking mutant used to slip
  // through the typecheck gate and get a fabricated survived/killed verdict.
  it('typechecks THIS mutant\'s build artifact, never the previous mutant\'s', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir).filter((m) => m.line === 2);
    expect(mutants.length).toBeGreaterThanOrEqual(2);

    const report = await runMutants({
      ...base,
      worktree: dir,
      mutants,
      buildCmd: 'cp src/add.ts built.snapshot',
      // Rejects any artifact whose add() no longer computes a sum.
      typecheckCmd: "node -e \"process.exit(require('node:fs').readFileSync('built.snapshot','utf-8').includes('a + b') ? 0 : 1)\"",
      testCmd: 'node check-real.mjs',
    });

    expect(report.baselineOk).toBe(true);
    expect(report.outcomes).toHaveLength(mutants.length);
    // Every line-2 mutant rewrites `a + b`, so every one of them must be
    // rejected by the typecheck of its OWN artifact.
    for (const outcome of report.outcomes) {
      expect(outcome.status, outcome.mutant.operator).toBe('invalid');
      expect(outcome.reason, outcome.mutant.operator).toContain('does not typecheck');
    }
    expect(report.killed).toBe(0);
    expect(report.survived).toBe(0);
    expect(report.invalid).toBe(mutants.length);
    // And the artifact is restored to the baseline content by the final build
    // of nothing — the source itself is always restored.
    expect(readFileSync(join(dir, 'src/add.ts'), 'utf-8')).toContain('a + b');
  }, 60_000);
});

describe('runMutants — invalid options are an operational failure, never NaN caps', () => {
  it('rejects a non-finite budget or timeout instead of passing NaN to the subprocess', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    for (const bad of [
      { perMutantTimeoutSec: Number.NaN, totalBudgetSec: 60 },
      { perMutantTimeoutSec: 20, totalBudgetSec: Number.POSITIVE_INFINITY },
      { perMutantTimeoutSec: 0, totalBudgetSec: 60 },
      { perMutantTimeoutSec: 20, totalBudgetSec: -1 },
    ]) {
      const report = await runMutants({ ...bad, worktree: dir, mutants, testCmd: 'node check-real.mjs' });
      expect(report.baselineOk).toBe(false);
      expect(report.baselineError).toContain('finite positive numbers');
      expect(report.outcomes).toHaveLength(0);
      expect(report.notRun).toBe(mutants.length);
    }
  });
});
