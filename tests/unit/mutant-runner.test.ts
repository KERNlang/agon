// Pins the shared, budgeted mutant runner (packages/core/src/kern/tools/mutant-runner.kern).
//
// Every case runs against a disposable COPY of tests/fixtures/mutate-tautology,
// a dependency-free mini-repo whose two test variants (real assertions vs.
// `expect(true).toBe(true)`) make kill/survive deterministic. The fixture's
// checks are `.mjs` scripts on purpose so the repo's own vitest run never
// collects them.
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  it('marks a mutant invalid when the typecheck command rejects it, and excludes it from the score', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({
      ...base, worktree: dir, mutants, testCmd: 'node check-real.mjs', typecheckCmd: 'exit 3',
    });

    expect(report.baselineOk).toBe(true);
    expect(report.invalid).toBe(mutants.length);
    expect(report.killed).toBe(0);
    expect(report.survived).toBe(0);
    expect(report.score).toBeNull();
    expect(report.outcomes.every((o) => o.status === 'invalid' && o.exitCode === 3)).toBe(true);
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
  it('omits unrun mutants from outcomes, counts them in notRun and flags budgetExhausted', async () => {
    const dir = sandbox();
    const mutants = addMutants(dir);

    const report = await runMutants({
      worktree: dir, mutants, testCmd: 'node check-real.mjs',
      perMutantTimeoutSec: 20, totalBudgetSec: 0.001,
    });

    expect(report.baselineOk).toBe(true);
    expect(report.outcomes).toHaveLength(0);
    expect(report.notRun).toBe(mutants.length);
    expect(report.budgetExhausted).toBe(true);
    expect(report.killed).toBe(0);
    expect(report.survived).toBe(0);
    expect(report.score).toBeNull();
  });
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

describe('runMutants — containment', () => {
  it('rejects a mutant whose file escapes the sandbox root', async () => {
    const dir = sandbox();
    const escaping: Mutant = {
      id: 'evil', operator: 'x', line: 1, before: 'a', after: 'b',
      class: 'high-signal', file: '../escape.ts', origin: 'mechanical',
    };

    await expect(runMutants({ ...base, worktree: dir, mutants: [escaping], testCmd: 'node check-real.mjs' }))
      .rejects.toThrow(/escapes/);
  });

  it('rejects a mutant with no file at all', async () => {
    const dir = sandbox();
    const fileless: Mutant = { id: 'nofile', operator: 'x', line: 1, before: 'a', after: 'b', class: 'high-signal' };

    await expect(runMutants({ ...base, worktree: dir, mutants: [fileless], testCmd: 'node check-real.mjs' }))
      .rejects.toThrow(/no 'file'/);
  });
});
