import { describe, it, expect } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mutant, MutationReport } from '@kernlang/agon-core';

import { runReviewMutation } from '../../packages/cli/src/generated/blocks/review-mutate.js';

import { formatMutationFindings } from '../../packages/cli/src/generated/blocks/review-mutate.js';
import { parseMutateArgs, formatMutateProgressLine, parsePositiveInt } from '../../packages/cli/src/generated/handlers/mutate.js';

function mutant(over: Partial<Mutant> = {}): Mutant {
  return {
    id: 'm1',
    file: 'src/add.ts',
    line: 2,
    operator: 'arith:+→-',
    before: '  return a + b;',
    after: '  return a - b;',
    class: 'high-signal',
    origin: 'mechanical',
    ...over,
  } as Mutant;
}

function report(over: Partial<MutationReport> = {}): MutationReport {
  return {
    testCmd: 'npm test',
    worktree: '/tmp/agon-mutate-abc',
    generated: 4,
    killed: 3,
    survived: 1,
    invalid: 0,
    timeouts: 0,
    killedByTimeout: 0,
    notRun: 0,
    score: 0.75,
    outcomes: [],
    budgetExhausted: false,
    allSurvived: false,
    baselineMs: 120,
    baselineOk: true,
    ...over,
  } as MutationReport;
}

describe('formatMutationFindings — the advisory review section', () => {
  it('renders the score line and every survivor grouped by file', () => {
    const lines = formatMutationFindings(report(), [
      mutant(),
      mutant({ id: 'm2', file: 'src/other.ts', line: 9, operator: 'eq:===→!==', before: 'if (a === b) {', after: 'if (a !== b) {' }),
    ]);
    const text = lines.join('\n');
    expect(text).toContain('Mutation score 75% — 3/4 mutants killed, 1 survived');
    expect(text).toContain('SURVIVORS (2)');
    expect(text).toContain('    src/add.ts');
    expect(text).toContain('    src/other.ts');
    expect(text).toContain('L2  arith:+→-  [high-signal]');
    expect(text).toContain('- return a + b;');
    expect(text).toContain('+ return a - b;');
  });

  it('attributes a semantic survivor to its engine and prints the rationale', () => {
    const lines = formatMutationFindings(report(), [
      mutant({ origin: 'semantic', engine: 'codex', rationale: 'off-by-one at the boundary is never asserted' }),
    ]);
    const text = lines.join('\n');
    expect(text).toContain('semantic/codex');
    expect(text).toContain('why: off-by-one at the boundary is never asserted');
  });

  it('celebrates a clean run instead of printing an empty survivor block', () => {
    const lines = formatMutationFindings(report({ killed: 4, survived: 0, score: 1 }), []);
    const text = lines.join('\n');
    expect(text).toContain('Mutation score 100%');
    expect(text).toContain('no survivors');
    expect(text).not.toContain('SURVIVORS');
  });

  it('breaks out timeouts, invalid mutants and budget exhaustion honestly', () => {
    const lines = formatMutationFindings(
      report({ killed: 3, survived: 1, invalid: 2, timeouts: 1, killedByTimeout: 1, notRun: 5, budgetExhausted: true }),
      [mutant()],
    );
    const text = lines.join('\n');
    expect(text).toContain('1 killed by timeout');
    expect(text).toContain('2 invalid');
    expect(text).toContain('5 mutants not run (budget)');
  });

  it('warns loudly when every mutant survived (stale-artifact signature)', () => {
    const lines = formatMutationFindings(
      report({ killed: 0, survived: 6, score: 0, allSurvived: true }),
      [mutant()],
    );
    expect(lines.join('\n')).toContain('every mutant survived');
  });

  it('reports a red baseline as skipped and never as a score', () => {
    const lines = formatMutationFindings(
      report({ baselineOk: false, baselineError: 'test command fails before any mutation in the sandbox (exit 1)', killed: 0, survived: 0, score: null }),
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('skipped —');
    expect(lines[0]).toContain('exit 1');
  });

  it('shows n/a rather than NaN when nothing ran', () => {
    const lines = formatMutationFindings(report({ killed: 0, survived: 0, score: null }), []);
    expect(lines[0]).toContain('Mutation score n/a');
  });
});

describe('parseMutateArgs — the /mutate argument string', () => {
  it('extracts a quoted test command and leaves the path as the positional', () => {
    const args = parseMutateArgs('src/add.ts --test "npm run test:unit" --mechanical-only');
    expect(args.path).toBe('src/add.ts');
    expect(args.test).toBe('npm run test:unit');
    expect(args.mechanicalOnly).toBe(true);
    expect(args.semantic).toBe(false);
  });

  it('defaults the numeric budgets and accepts overrides', () => {
    expect(parseMutateArgs('')).toMatchObject({ maxMutants: 40, semanticPerEngine: 8, timeout: 120, budget: 900 });
    expect(parseMutateArgs('--max-mutants 5 --semantic-per-engine 2 --timeout 30 --budget 60'))
      .toMatchObject({ maxMutants: 5, semanticPerEngine: 2, timeout: 30, budget: 60 });
  });

  it('parses diff/base/engines and never leaves flag text in the path', () => {
    const args = parseMutateArgs('--diff origin/main --base HEAD~2 -e codex,claude --semantic');
    expect(args).toMatchObject({ diff: 'origin/main', base: 'HEAD~2', semantic: true });
    expect(args.engines).toEqual(['codex', 'claude']);
    expect(args.path).toBeUndefined();
  });
});

describe('formatMutateProgressLine', () => {
  it('narrates the pipeline events and ignores unknown ones', () => {
    expect(formatMutateProgressLine({ type: 'mutate:targets', data: { files: 2, lines: 30 } })).toBe('targets: 2 file(s), 30 line(s)');
    expect(formatMutateProgressLine({ type: 'mutate:pool', data: { total: 12, semantic: 4, mechanical: 8 } })).toContain('pool: 12 mutant(s)');
    expect(formatMutateProgressLine({ type: 'mutate:progress', data: { phase: 'baseline', status: 'ok', durationMs: 90 } })).toContain('baseline: unmutated suite passed');
    expect(formatMutateProgressLine({ type: 'mutate:progress', data: { phase: 'mutant', index: 3, total: 9, status: 'survived', mutantId: 'm3', durationMs: 40 } })).toBe('[3/9] survived · m3 (40ms)');
    expect(formatMutateProgressLine({ type: 'mutate:done', data: {} })).toBeNull();
  });
});

describe('parsePositiveInt', () => {
  it('falls back on empty, NaN, zero and negative values', () => {
    expect(parsePositiveInt(undefined, 7)).toBe(7);
    expect(parsePositiveInt('', 7)).toBe(7);
    expect(parsePositiveInt('abc', 7)).toBe(7);
    expect(parsePositiveInt('0', 7)).toBe(7);
    expect(parsePositiveInt('-3', 7)).toBe(7);
    expect(parsePositiveInt('12', 7)).toBe(12);
  });
});

// ── runReviewMutation — the `agon review --mutate` seam (AC8) ────────
// One real pass over a throwaway git repo built from the tautology fixture:
// it must produce the advisory heading, write mutation-report.json into the
// review's own run dir, and NEVER throw (the review's exit code is downstream).
const FIXTURE = fileURLToPath(new URL('../fixtures/mutate-tautology', import.meta.url));

describe('runReviewMutation — advisory review hook', () => {
  it('mutates the reviewed diff and writes mutation-report.json into the run dir', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'agon-reviewmutate-'));
    const outputDir = mkdtempSync(join(tmpdir(), 'agon-reviewmutate-out-'));
    cpSync(FIXTURE, repo, { recursive: true });
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
    git(['init', '-q']);
    git(['config', 'user.email', 'fixture@agon.test']);
    git(['config', 'user.name', 'fixture']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);

    const diff = [
      'diff --git a/src/add.ts b/src/add.ts',
      '--- a/src/add.ts',
      '+++ b/src/add.ts',
      '@@ -1,3 +1,3 @@',
      ' export function add(a: number, b: number): number {',
      '+  return a + b;',
      ' }',
      '',
    ].join('\n');

    const lines = await runReviewMutation({
      repoRoot: repo,
      diff,
      outputDir,
      registry: {} as never,
      adapter: {} as never,
      engines: [],
      semantic: false,
      testCmd: 'node check-tautology.mjs',
      maxMutants: 5,
      perMutantTimeoutSec: 20,
      totalBudgetSec: 120,
    });

    const text = lines.join('\n');
    expect(lines[0]).toContain('MUTATION (advisory)');
    expect(text).toContain('test command: node check-tautology.mjs');
    expect(text).toContain('SURVIVORS');
    expect(existsSync(join(outputDir, 'mutation-report.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(outputDir, 'mutation-report.json'), 'utf-8')).baselineOk).toBe(true);
  }, 60_000);

  it('degrades to a single skipped line instead of throwing when there is no diff', async () => {
    const lines = await runReviewMutation({
      repoRoot: process.cwd(), diff: '   ', outputDir: mkdtempSync(join(tmpdir(), 'agon-reviewmutate-empty-')),
      registry: {} as never, adapter: {} as never, engines: [], semantic: false,
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('skipped — no diff to mutate');
  });
});
