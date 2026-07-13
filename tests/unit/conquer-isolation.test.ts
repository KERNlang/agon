import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeSessionWorktree } from '../../packages/core/src/generated/blocks/worktree-session.js';
import { createConquerIsolation } from '../../packages/forge/src/generated/conquer.js';

describe('Conquer worktree isolation', () => {
  let base: string;
  let repo: string;
  let previousHome: string | undefined;

  const git = (args: string[], cwd = repo): string => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

  beforeEach(() => {
    previousHome = process.env.AGON_HOME;
    base = mkdtempSync(join(tmpdir(), 'agon-conquer-isolation-'));
    process.env.AGON_HOME = join(base, 'agon-home');
    repo = join(base, 'repo');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@agon.dev']);
    git(['config', 'user.name', 'Agon Test']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = previousHome;
    rmSync(base, { recursive: true, force: true });
  });

  it('keeps source WIP untouched while mutations land on a named branch', () => {
    writeFileSync(join(repo, 'source-wip.txt'), 'keep me\n');
    const isolation = createConquerIsolation('Build a CSV importer', repo, 'test-run');

    expect(isolation.branch).toBe('conquer/build-a-csv-importer-test-run');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], isolation.path)).toBe(isolation.branch);
    expect(() => readFileSync(join(isolation.path, 'source-wip.txt'), 'utf-8')).toThrow();

    writeFileSync(join(isolation.path, 'README.md'), 'builder change\n');
    writeFileSync(join(isolation.path, 'built.txt'), 'isolated\n');

    expect(readFileSync(join(repo, 'README.md'), 'utf-8')).toBe('base\n');
    expect(readFileSync(join(repo, 'source-wip.txt'), 'utf-8')).toBe('keep me\n');
    expect(git(['status', '--porcelain'])).toBe('?? source-wip.txt');

    expect(removeSessionWorktree(repo, isolation.branch, true)).toBe(true);
  });

  it('overlays installed dependencies and build artifacts for the gate', () => {
    mkdirSync(join(repo, 'packages', 'demo'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'demo', 'package.json'), '{"name":"demo"}\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'add workspace package']);
    mkdirSync(join(repo, 'node_modules', 'example'), { recursive: true });
    mkdirSync(join(repo, 'packages', 'demo', 'dist'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'example', 'index.js'), 'module.exports = 42;\n');
    writeFileSync(join(repo, 'packages', 'demo', 'dist', 'artifact.js'), 'built\n');

    const isolation = createConquerIsolation('Build with dependencies', repo, 'overlay-test');

    expect(readFileSync(join(isolation.path, 'node_modules', 'example', 'index.js'), 'utf-8')).toContain('42');
    expect(readFileSync(join(isolation.path, 'packages', 'demo', 'dist', 'artifact.js'), 'utf-8')).toBe('built\n');
    expect(removeSessionWorktree(repo, isolation.branch, true)).toBe(true);
  });
});
