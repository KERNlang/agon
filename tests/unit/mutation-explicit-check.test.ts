import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMutationAssessment } from '../../packages/support-worktree/src/mutation-runner.js';
import type { MutationReport } from '../../packages/support-worktree/src/mutant-runner.js';

const CPP = 'struct Money { int c; Money operator+(Money o) const { Money r{c + o.c}; return r; } };\nMoney total(Money a, Money b) { return a + b; }\n';
const NO_OPERATOR_MINUS = "! grep -q 'a - b' calc.cpp";
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function cppRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'agon-explicit-check-'));
  dirs.push(root);
  writeFileSync(join(root, 'calc.cpp'), CPP);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.'); git('commit', '-m', 'fixture');
  return root;
}

const assess = (root: string, extra: { typecheckCmd?: string } = {}) => runMutationAssessment(
  { repoRoot: root, files: ['calc.cpp'], testCmd: NO_OPERATOR_MINUS, outputDir: join(root, 'out'), ...extra },
  { cwd: root, signal: new AbortController().signal },
  { engines: { dispatch() { throw new Error('Unexpected provider'); } } });

describe('review: compiled profile without a default compile check', () => {
  it('review: a C++ target without --build/--typecheck runs no mutants and names the file', async () => {
    const root = cppRepo();
    const result = await assess(root);
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('calc.cpp');
    expect(String(result.error)).toMatch(/--build or --typecheck/);
    expect((result.report as MutationReport | undefined)?.outcomes ?? []).toEqual([]);
  });

  it('review: an explicit typecheck grades the non-compiling C++ mutant invalid, never killed', async () => {
    const root = cppRepo();
    const result = await assess(root, { typecheckCmd: NO_OPERATOR_MINUS });
    const report = result.report as MutationReport;
    expect(result.error).toBeUndefined();
    expect(report.baselineOk).toBe(true);
    const byAfter = Object.fromEntries(report.outcomes.map(o => [o.mutant.after.trim(), o.status]));
    expect(byAfter['Money total(Money a, Money b) { return a - b; }']).toBe('invalid');
    expect(report.killed).toBe(0);
  });
});
