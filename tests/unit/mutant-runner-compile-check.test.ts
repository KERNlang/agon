import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LANGUAGE_PROFILES, generateMutants, runMutants } from '../../packages/support-worktree/src/index.js';
import type { Mutant } from '../../packages/support-worktree/src/index.js';

const GO = 'package a\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n';
const RS = 'pub fn same(x: i32, y: i32) -> bool {\n    x == y\n}\n';
const dirs: string[] = [];

function sandbox(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'agon-compile-check-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true }); });

const profile = (id: string) => LANGUAGE_PROFILES.find(p => p.id === id)!;
const mutantsOf = (dir: string, file: string, id: string, lines: number[]): Mutant[] =>
  generateMutants(readFileSync(join(dir, file), 'utf-8'), lines, file, profile(id));
const checkLog = (dir: string): string[] =>
  existsSync(join(dir, 'checks.log')) ? readFileSync(join(dir, 'checks.log'), 'utf-8').trim().split('\n') : [];
const base = { perMutantTimeoutSec: 20, totalBudgetSec: 120 };

describe('AC-5 compile check on kill only', () => {
  it('AC-5 a failed-test mutant that does not compile is invalid, checked while still on disk', async () => {
    const dir = sandbox({ 'src/a.go': GO });
    const report = await runMutants({ ...base, worktree: dir, mutants: mutantsOf(dir, 'src/a.go', 'go', [4]),
      testCmd: "! grep -q 'a - b' src/a.go",
      compileChecks: { go: "echo go >> checks.log; ! grep -q 'a - b' src/a.go" } });
    expect(report.outcomes.map(o => [o.status, o.reason])).toEqual([['invalid', 'the mutated source does not compile']]);
    expect(report.killed).toBe(0);
    expect(report.invalid).toBe(1);
    expect(report.score).toBeNull();
    expect(checkLog(dir)).toEqual(['go', 'go']);
    expect(readFileSync(join(dir, 'src/a.go'), 'utf-8')).toBe(GO);
  });

  it('AC-5 a mutant that compiles but fails tests is killed with one check call; survivors are never checked', async () => {
    const dir = sandbox({ 'src/a.go': GO, 'src/b.go': GO });
    const mutants = [...mutantsOf(dir, 'src/a.go', 'go', [4]), ...mutantsOf(dir, 'src/b.go', 'go', [4])];
    const report = await runMutants({ ...base, worktree: dir, mutants,
      testCmd: "! grep -q 'a - b' src/a.go",
      compileChecks: { go: 'echo go >> checks.log' } });
    expect(report.outcomes.map(o => [o.mutant.file, o.status])).toEqual([['src/a.go', 'killed'], ['src/b.go', 'survived']]);
    expect(checkLog(dir)).toEqual(['go', 'go']);
    expect(report.compileCheck).toBe('echo go >> checks.log');
  });

  it('AC-5 --typecheck suppresses the profile check', async () => {
    const dir = sandbox({ 'src/a.go': GO });
    const report = await runMutants({ ...base, worktree: dir, mutants: mutantsOf(dir, 'src/a.go', 'go', [4]),
      testCmd: "! grep -q 'a - b' src/a.go", typecheckCmd: 'true',
      compileChecks: { go: 'echo go >> checks.log; exit 1' } });
    expect(report.outcomes.map(o => o.status)).toEqual(['killed']);
    expect(checkLog(dir)).toEqual([]);
    expect(report.compileCheck).toBeUndefined();
  });

  it('AC-5 a pooled Go+Rust run checks each mutant with its own language', async () => {
    const dir = sandbox({ 'src/a.go': GO, 'src/b.rs': RS });
    const mutants = [...mutantsOf(dir, 'src/a.go', 'go', [4]), ...mutantsOf(dir, 'src/b.rs', 'rs', [2])];
    expect(mutants.map(m => m.operator)).toEqual(['go:+→-', 'rs:==→!=']);
    const report = await runMutants({ ...base, worktree: dir, mutants,
      testCmd: "grep -q 'a + b' src/a.go && grep -q 'x == y' src/b.rs",
      compileChecks: { go: 'echo go >> checks.log', rs: 'echo rs >> checks.log' } });
    expect(report.outcomes.map(o => o.status)).toEqual(['killed', 'killed']);
    expect(checkLog(dir)).toEqual(['go', 'rs', 'go', 'rs']);
    expect(report.compileCheck).toBe('echo go >> checks.log; echo rs >> checks.log');
  });

  it('AC-5 a check tool absent from PATH fails the baseline naming the tool', async () => {
    const dir = sandbox({ 'src/a.go': GO });
    const report = await runMutants({ ...base, worktree: dir, mutants: mutantsOf(dir, 'src/a.go', 'go', [4]),
      testCmd: 'true', compileChecks: { go: 'agon-missing-go-tool test -run x ./...' } });
    expect(report.baselineOk).toBe(false);
    expect(report.baselinePhase).toBe('compile-check');
    expect(report.baselineError).toContain('agon-missing-go-tool');
    expect(report.outcomes).toEqual([]);
    expect(report.notRun).toBe(1);
  });

  it('AC-5 a check red at baseline aborts the run like a red typecheck', async () => {
    const dir = sandbox({ 'src/a.go': GO });
    const report = await runMutants({ ...base, worktree: dir, mutants: mutantsOf(dir, 'src/a.go', 'go', [4]),
      testCmd: 'true', compileChecks: { go: 'echo go >> checks.log; exit 3' } });
    expect(report.baselineOk).toBe(false);
    expect(report.baselinePhase).toBe('compile-check');
    expect(report.baselineError).toContain('exit 3');
    expect(report.outcomes).toEqual([]);
    expect(checkLog(dir)).toEqual(['go']);
  });

  it('AC-5 languages without a configured check are graded by tests alone', async () => {
    const dir = sandbox({ 'src/a.go': GO });
    const report = await runMutants({ ...base, worktree: dir, mutants: mutantsOf(dir, 'src/a.go', 'go', [4]),
      testCmd: "! grep -q 'a - b' src/a.go", compileChecks: { rs: 'echo rs >> checks.log; exit 1' } });
    expect(report.outcomes.map(o => o.status)).toEqual(['killed']);
    expect(checkLog(dir)).toEqual([]);
  });
});

describe('AC-11 python per-file check', () => {
  it('AC-11 `{file}` is the quoted path of each target; a syntax-breaking semantic mutant is invalid', async () => {
    const dir = sandbox({ 'src/my file.py': 'def f(a, b):\n    if a and b:\n        return 1\n', 'src/two.py': 'x = -1\n' });
    const semantic: Mutant = { id: 'semantic:e@src/my file.py:L2#1', operator: 'semantic:e', line: 2,
      before: '    if a and b:', after: '    if a or:', class: 'high-signal', file: 'src/my file.py', origin: 'semantic' };
    const mechanical = mutantsOf(dir, 'src/two.py', 'py', [1]);
    expect(mechanical.map(m => m.after)).toEqual(['x = +1']);
    const report = await runMutants({ ...base, worktree: dir, mutants: [semantic, ...mechanical],
      testCmd: "grep -q 'a and b' 'src/my file.py' && grep -q 'x = -1' src/two.py",
      compileChecks: { py: "basename {file} >> checks.log; ! grep -q 'or:' {file}" } });
    expect(report.outcomes.map(o => [o.mutant.file, o.status])).toEqual([['src/my file.py', 'invalid'], ['src/two.py', 'killed']]);
    expect(checkLog(dir)).toEqual(['my file.py', 'two.py', 'my file.py', 'two.py']);
    expect(report.compileCheck).toBe("basename {file} >> checks.log; ! grep -q 'or:' {file}");
  });
});
