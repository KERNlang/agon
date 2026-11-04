import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMutate } from '../../packages/forge/src/mutate.js';
import { discoverMutateGate, resolveMutateTargets } from '../../packages/forge/src/mutate-targets.js';
import { prepareNodeSandbox } from '../../packages/forge/src/mutate-sandbox.js';
import {
  formatMutationReportLines, mutateVerdictLine, MUTATE_ALL_SURVIVED_WARNING, MUTATE_ALL_SURVIVED_WARNING_GENERIC,
} from '../../packages/forge/src/mutate-report.js';
import type { Mutant } from '../../packages/core/src/tools/mutant-generator.js';
import type { MutationReport } from '../../packages/core/src/tools/mutant-runner.js';

const GO_FIXTURE = fileURLToPath(new URL('../fixtures/mutate-go', import.meta.url));
const PY_FIXTURE = fileURLToPath(new URL('../fixtures/mutate-py', import.meta.url));
const GO_CHECK = "go test -count=1 -run '^$' ./...";
const dirs: string[] = [];
const savedPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = savedPath;
  delete process.env.AGON_FAKE_GO_LOG;
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), content);
  }
}

function gitRepo(fixture: string | undefined, files: Record<string, string> = {}): string {
  const repo = tmp('agon-mutate-ml-');
  if (fixture) cpSync(fixture, repo, { recursive: true });
  writeFiles(repo, files);
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'fixture@agon.test']);
  git(['config', 'user.name', 'fixture']);
  git(['add', '-A']);
  git(['commit', '-qm', 'fixture']);
  return repo;
}

function hasTool(name: string): boolean {
  try { execFileSync('/bin/sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }); return true; } catch { return false; }
}

function fakeGo(failWhen: string): string {
  const bin = tmp('agon-fake-go-');
  const log = join(bin, 'go.log');
  writeFileSync(join(bin, 'go'), `#!/bin/sh\necho "$*" >> "$AGON_FAKE_GO_LOG"\n! grep -q '${failWhen}' calc.go\n`);
  chmodSync(join(bin, 'go'), 0o755);
  process.env.PATH = `${bin}${delimiter}${savedPath ?? ''}`;
  process.env.AGON_FAKE_GO_LOG = log;
  return log;
}

const goLog = (log: string): string[] => (existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n') : []);

const base = {
  engines: [], registry: {} as never, adapter: {} as never, semantic: false,
  maxMutants: 20, perMutantTimeoutSec: 30, totalBudgetSec: 240,
};

const report = (over: Partial<MutationReport>): MutationReport => ({
  testCmd: 'pytest', worktree: '/tmp/wt', generated: 0, killed: 0, survived: 0, invalid: 0, timeouts: 0,
  killedByTimeout: 0, notRun: 0, score: null, outcomes: [], budgetExhausted: false, aborted: false,
  allSurvived: false, baselineMs: 1, baselineOk: true, ...over,
});

const survivor = (file: string): Mutant => ({
  id: `${file}:op`, operator: 'py:and→or', line: 1, before: 'a and b', after: 'a or b',
  class: 'high-signal', origin: 'mechanical', file,
});

describe('AC-5 forge-level compile check', () => {
  it('AC-5 go fixture: a failed-test mutant that does not compile is invalid; the check runs once per failed test plus baseline', async () => {
    const repo = gitRepo(GO_FIXTURE);
    const log = fakeGo('a != b');
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-ml-out-'), files: ['calc.go'],
      testCmd: "! grep -q 'a - b' calc.go && ! grep -q 'a != b' calc.go" });
    const byAfter = Object.fromEntries(result.report.outcomes.map(o => [o.mutant.after.trim(), o.status]));
    expect(byAfter['return a - b']).toBe('killed');
    expect(byAfter['return a != b']).toBe('invalid');
    expect(result.report.compileCheck).toBe(GO_CHECK);
    const failedTests = result.report.outcomes.filter(o => o.status === 'killed' || o.status === 'invalid').length;
    expect(goLog(log)).toHaveLength(failedTests + 1);
    expect(goLog(log)[0]).toBe("test -count=1 -run ^$ ./...");
    expect(result.verdict).toContain(`compile check: ${GO_CHECK}`);
  }, 60_000);

  it('AC-5 --typecheck replaces the default go check', async () => {
    const repo = gitRepo(GO_FIXTURE);
    const log = fakeGo('a != b');
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-ml-out-'), files: ['calc.go'],
      testCmd: "! grep -q 'a - b' calc.go && ! grep -q 'a != b' calc.go", typecheckCmd: 'true' });
    expect(goLog(log)).toEqual([]);
    expect(result.report.compileCheck).toBeUndefined();
    expect(result.report.invalid).toBe(0);
  }, 60_000);

  it.skipIf(!hasTool('go'))('AC-5 go fixture under the real toolchain grades compiling mutants by the tests', async () => {
    const repo = gitRepo(GO_FIXTURE);
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-ml-out-'), files: ['calc.go'],
      testCmd: discoverMutateGate(repo) });
    expect(result.report.testCmd).toBe('go test ./...');
    expect(result.report.baselineOk).toBe(true);
    expect(result.report.compileCheck).toBe(GO_CHECK);
    expect(result.report.killed).toBeGreaterThanOrEqual(2);
    expect(result.report.survived).toBe(0);
    expect(result.report.invalid).toBe(0);
  }, 180_000);
});

describe('AC-8 skip dirs in directory mode', () => {
  it('AC-8 python, rust, jvm and dotnet build dirs never yield targets', () => {
    const root = tmp('agon-ml-skip-');
    writeFiles(root, {
      'Cargo.toml': '[package]\nname = "x"\n', 'pom.xml': '<project/>', 'app.csproj': '<Project/>',
      'src/a.py': 'x = a + b\n', 'src/lib.rs': 'fn f() -> i32 { 1 + 2 }\n',
      '__pycache__/a.py': 'x = 1 + 2\n', 'venv/lib/a.py': 'x = 1 + 2\n', '.venv/lib/a.py': 'x = 1 + 2\n',
      'lib/site-packages/a.py': 'x = 1 + 2\n', 'target/gen.rs': 'fn g() -> i32 { 1 + 2 }\n',
      '.gradle/a.java': 'int x = 1 + 2;\n', 'bin/a.cs': 'int x = 1 + 2;\n', 'obj/a.cs': 'int x = 1 + 2;\n',
    });
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere/real.py'), 'x = 1 + 2\n');
    symlinkSync(join(root, 'elsewhere'), join(root, 'env'));
    const { targets } = resolveMutateTargets({ repoRoot: root, files: ['.'], allowGeneric: false, wantGeneric: false });
    expect(Object.keys(targets).sort()).toEqual(['elsewhere/real.py', 'src/a.py', 'src/lib.rs']);
  });

  it('AC-8 a JS repo keeps its own target/ and bin/ sources', () => {
    const root = tmp('agon-ml-skip-js-');
    writeFiles(root, { 'package.json': '{}', 'target/a.ts': 'export const x = 1 + 2;\n', 'bin/cli.js': 'const y = 1 + 2;\n' });
    const { targets } = resolveMutateTargets({ repoRoot: root, files: ['.'], allowGeneric: false, wantGeneric: false });
    expect(Object.keys(targets).sort()).toEqual(['bin/cli.js', 'target/a.ts']);
  });
});

describe('AC-10 Node sandbox prep only for package.json roots', () => {
  it('AC-10 prepareNodeSandbox is a no-op without package.json and runs with a stray one', () => {
    const repo = tmp('agon-ml-node-');
    const sandbox = tmp('agon-ml-node-sb-');
    expect(prepareNodeSandbox(repo, sandbox, ['calc.py'])).toEqual({ node: false, clearedDist: [], eventData: {} });
    writeFileSync(join(sandbox, 'package.json'), '{}');
    const prep = prepareNodeSandbox(repo, sandbox, ['calc.py']);
    expect(prep.node).toBe(true);
    expect(prep.eventData).toHaveProperty('nodeModules');
  });

  it('AC-10 a python run emits no nodeModules/distCleared fields and no stale-dist hint', async () => {
    const repo = gitRepo(PY_FIXTURE);
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-ml-out-'), files: ['calc.py'],
      testCmd: 'exit 1', onEvent: e => events.push(e) });
    const sandbox = events.find(e => e.type === 'mutate:sandbox');
    expect(sandbox?.data).toBeDefined();
    expect(sandbox?.data).not.toHaveProperty('nodeModules');
    expect(sandbox?.data).not.toHaveProperty('distCleared');
    expect(sandbox?.data).not.toHaveProperty('needsBuild');
    expect(result.report.baselineOk).toBe(false);
    expect(result.error).not.toContain('prebuilt');
  }, 60_000);
});

describe('mutate report — language-aware hints', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map(n => ({ ...survivor(`src/${n}.py`), id: n }));
  const allSurvived = (files: Mutant[]) => report({ survived: 5, allSurvived: true, score: 0,
    outcomes: files.map(m => ({ mutant: m, status: 'survived' as const, durationMs: 1 })) });

  it('uses the Node all-survived wording only when a JS/TS mutant ran', () => {
    expect(formatMutationReportLines(allSurvived(five), five)[0]).toBe(`⚠ ${MUTATE_ALL_SURVIVED_WARNING_GENERIC}`);
    expect(mutateVerdictLine(allSurvived(five), five).text).not.toContain('node_modules');
    const mixed = [...five.slice(0, 4), { ...survivor('src/x.ts'), id: 'x' }];
    expect(formatMutationReportLines(allSurvived(mixed), mixed)[0]).toBe(`⚠ ${MUTATE_ALL_SURVIVED_WARNING}`);
  });

  it('names a red compile-check baseline and the --typecheck override', () => {
    const red = report({ baselineOk: false, baselinePhase: 'compile-check', baselineError: `compile check \`${GO_CHECK}\` fails before any mutation in the sandbox (exit 2)` });
    const text = formatMutationReportLines(red, []).join('\n');
    expect(text).toContain('compile check');
    expect(text).toContain('pass --typecheck');
  });
});

describe('AC-6 shared gate fallback', () => {
  it('AC-6 discoverMutateGate falls back to the language manifest when package.json has no test script', () => {
    const root = tmp('agon-ml-gate-');
    writeFiles(root, { 'package.json': '{"name":"tooling"}', 'pyproject.toml': '[project]\n' });
    expect(discoverMutateGate(root)).toBe('python -m pytest');
    expect(discoverMutateGate(GO_FIXTURE)).toBe('go test ./...');
    writeFiles(root, { 'AGENTS.md': 'fitness: make check\n' });
    expect(discoverMutateGate(root)).toBe('make check');
  });
});

describe('review: compiled profile without a default compile check', () => {
  const CPP = 'struct Money { int c; Money operator+(Money o) const { Money r{c + o.c}; return r; } };\nMoney total(Money a, Money b) { return a + b; }\n';
  const NO_MINUS = "! grep -q 'a - b' calc.cpp";

  it('review: a C++-only target without --build/--typecheck fails with a notice naming the file', async () => {
    const repo = gitRepo(undefined, { 'calc.cpp': CPP });
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-ml-out-'), files: ['calc.cpp'],
      testCmd: NO_MINUS, onEvent: e => events.push(e) });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('calc.cpp');
    expect(result.report.outcomes).toEqual([]);
    const notice = events.find(e => e.type === 'mutate:notice');
    expect(notice?.data?.files).toEqual(['calc.cpp']);
    expect(String(notice?.data?.message)).toMatch(/--build or --typecheck/);
  }, 60_000);

  it('review: a mixed target skips the C++ file and still mutates the rest', async () => {
    const repo = gitRepo(undefined, { 'calc.cpp': CPP, 'calc.py': 'def f(a, b):\n    return a + b\n' });
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-ml-out-'), files: ['calc.cpp', 'calc.py'],
      testCmd: "grep -q 'a + b' calc.py", onEvent: e => events.push(e) });
    expect(events.find(e => e.type === 'mutate:notice')?.data?.files).toEqual(['calc.cpp']);
    expect(new Set(result.report.outcomes.map(o => o.mutant.file))).toEqual(new Set(['calc.py']));
  }, 60_000);

  it('review: an explicit --typecheck grades the non-compiling C++ mutant invalid, never killed', async () => {
    const repo = gitRepo(undefined, { 'calc.cpp': CPP });
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-ml-out-'), files: ['calc.cpp'],
      testCmd: NO_MINUS, typecheckCmd: NO_MINUS });
    expect(result.error).toBeUndefined();
    const byAfter = Object.fromEntries(result.report.outcomes.map(o => [o.mutant.after.trim(), o.status]));
    expect(byAfter['Money total(Money a, Money b) { return a - b; }']).toBe('invalid');
    expect(result.report.killed).toBe(0);
  }, 60_000);
});
