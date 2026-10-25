import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Mutant } from '../../packages/core/src/tools/mutant-generator.js';
import type { SemanticTarget } from '../../packages/forge/src/mutate-semantic.js';

vi.mock('../../packages/forge/src/mutate-semantic.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/forge/src/mutate-semantic.js')>()),
  collectSemanticMutants: vi.fn(),
}));

const { collectSemanticMutants, buildSemanticMutantPrompt } = await import('../../packages/forge/src/mutate-semantic.js');
const { runMutate } = await import('../../packages/forge/src/mutate.js');

const PY_FIXTURE = fileURLToPath(new URL('../fixtures/mutate-py', import.meta.url));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const dirs: string[] = [];
const collect = vi.mocked(collectSemanticMutants);
const panelHealth = { requested: 1, responded: 1, degraded: false, notes: [], banner: null };

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function gitRepo(fixture: string | undefined, files: Record<string, string | Buffer> = {}): string {
  const repo = tmp('agon-mutate-sem-');
  if (fixture) cpSync(fixture, repo, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(repo, name, '..'), { recursive: true });
    writeFileSync(join(repo, name), content);
  }
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

const base = {
  engines: ['fake-engine'], registry: {} as never, adapter: {} as never, semantic: true,
  maxMutants: 20, perMutantTimeoutSec: 30, totalBudgetSec: 240,
};

const offered = (): string[] => (collect.mock.calls.at(-1)?.[0].targets ?? []).map((t: SemanticTarget) => t.file).sort();

beforeEach(() => {
  collect.mockReset();
  collect.mockResolvedValue({ mutants: [], dropped: [], calls: 1, panelHealth });
});
afterEach(() => { while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true }); });

const MIXED = {
  'src/Calc.kt': 'fun same(a: Int, b: Int): Boolean = a == b\n',
  'lib/calc.ex': 'def add(a, b), do: a + b\n',
  'assets/logo.png': PNG,
  'deps/mix.lock': '%{"jason": {:hex, :jason, "1.4.0"}}\n',
  'Cargo.lock': 'version = 3\n',
};

describe('AC-7 semantic targets', () => {
  it('AC-7 without --build/--typecheck an unprofiled file is skipped with one notice naming it', async () => {
    const repo = gitRepo(undefined, MIXED);
    const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
    await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-sem-out-'), files: ['.'], testCmd: 'true', onEvent: e => events.push(e) });
    expect(offered()).toEqual(['src/Calc.kt']);
    const notices = events.filter(e => e.type === 'mutate:notice');
    expect(notices).toHaveLength(1);
    expect(String(notices[0].data?.message)).toContain('lib/calc.ex');
    expect(notices[0].data?.files).toEqual(['lib/calc.ex']);
  }, 60_000);

  it('AC-7 with --build the unprofiled text file is offered; binary and lock files never are', async () => {
    const repo = gitRepo(undefined, MIXED);
    await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-sem-out-'), files: ['.'], testCmd: 'true', buildCmd: 'true' });
    expect(offered()).toEqual(['lib/calc.ex', 'src/Calc.kt']);
  }, 60_000);

  it('AC-7 with --typecheck a diff-touched unprofiled file is offered too', async () => {
    const repo = gitRepo(undefined, MIXED);
    const diff = '--- a/lib/calc.ex\n+++ b/lib/calc.ex\n@@ -0,0 +1,1 @@\n+def add(a, b), do: a + b\n';
    await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-sem-out-'), diff, testCmd: 'true', typecheckCmd: 'true' });
    expect(offered()).toEqual(['lib/calc.ex']);
  }, 60_000);

  it('AC-7 zero targets after filtering is a failed run naming the skipped file', async () => {
    const repo = gitRepo(undefined, { 'lib/calc.ex': MIXED['lib/calc.ex'], 'logo.png': PNG });
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-sem-out-'), files: ['.'], testCmd: 'true' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('lib/calc.ex');
    expect(collect).not.toHaveBeenCalled();
  });

  it('AC-7 each FILE block carries its LANGUAGE', () => {
    const prompt = buildSemanticMutantPrompt([
      { file: 'src/Calc.kt', lines: [{ line: 1, text: 'a == b' }] },
      { file: 'lib/calc.ex', lines: [{ line: 1, text: 'a + b' }] },
    ], 2);
    expect(prompt).toContain('FILE: src/Calc.kt\nLANGUAGE: kt\n');
    expect(prompt).toContain('FILE: lib/calc.ex\nLANGUAGE: generic\n');
  });
});

describe('AC-11 python compile check', () => {
  it.skipIf(!hasTool('python3'))('AC-11 a syntax-breaking semantic mutant is invalid; compiling mutants are killed', async () => {
    const repo = gitRepo(PY_FIXTURE);
    const broken: Mutant = {
      id: 'semantic:fake@calc.py:L6#1', operator: 'semantic:fake', line: 6, before: '    if a or b:', after: '    if a or:',
      class: 'high-signal', file: 'calc.py', origin: 'semantic', engine: 'fake-engine', rationale: 'drops an operand',
    };
    collect.mockResolvedValue({ mutants: [broken], dropped: [], calls: 1, panelHealth });
    const result = await runMutate({ ...base, repoRoot: repo, outputDir: tmp('agon-sem-out-'), files: ['calc.py'], testCmd: 'python3 test_calc.py' });
    expect(result.report.baselineOk).toBe(true);
    expect(result.report.compileCheck).toBe('python3 -m py_compile {file}');
    const semantic = result.report.outcomes.find(o => o.mutant.origin === 'semantic');
    expect(semantic?.status).toBe('invalid');
    expect(semantic?.reason).toBe('the mutated source does not compile');
    const mechanical = result.report.outcomes.filter(o => o.mutant.origin === 'mechanical');
    expect(mechanical.length).toBeGreaterThan(0);
    expect(mechanical.map(o => [o.mutant.after.trim(), o.status])).toEqual(mechanical.map(o => [o.mutant.after.trim(), 'killed']));
  }, 120_000);
});
