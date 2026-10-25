import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMutationAssessment } from '../../packages/support-worktree/src/mutation-runner.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('modular mutation sandbox hydration', () => {
  it('copies untracked non-target files the gate needs, never ignored ones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-untracked-'));
    dirs.push(root);
    writeFileSync(join(root, 'value.mjs'), 'export const value = 2 + 3;\n');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.'); git('commit', '-m', 'fixture');
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests', 'value check.mjs'), "import { value } from '../value.mjs';\nif (value !== 5) process.exit(1);\n");
    writeFileSync(join(root, 'ignored.txt'), 'local only\n');
    const testCmd = "test ! -e ignored.txt && node 'tests/value check.mjs'";
    const result = await runMutationAssessment({ repoRoot: root, files: ['value.mjs'], testCmd, outputDir: join(root, 'out') },
      { cwd: root, signal: new AbortController().signal }, { engines: { dispatch() { throw new Error('Unexpected provider'); } } });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.report?.baselineOk).toBe(true);
    expect(result.report?.killed).toBeGreaterThan(0);
  });
});
