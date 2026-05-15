import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { runSyntaxCheck } from '../../packages/forge/src/quality.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorktree(): string {
  const dir = join(tmpdir(), `agon-syntax-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# init\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('runSyntaxCheck (forge quality)', () => {
  it('returns clean when the changed file is valid TypeScript', () => {
    const wt = makeWorktree();
    writeFileSync(join(wt, 'a.ts'), 'export const x: number = 1;\n');
    const r = runSyntaxCheck(wt);
    expect(r.errors).toBe(0);
    expect(r.invalidFiles).toEqual([]);
  });

  it('flags invalid TypeScript with the file path', () => {
    const wt = makeWorktree();
    writeFileSync(join(wt, 'broken.ts'), 'export const x: number = ;\n');
    const r = runSyntaxCheck(wt);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.invalidFiles).toContain('broken.ts');
  });

  it('flags Python files where tree-sitter is forgiving but CPython is not', () => {
    const wt = makeWorktree();
    // Tree-sitter recovers this as valid; the CPython ast.parse supplement
    // catches the indentation error.
    writeFileSync(join(wt, 'bad.py'), 'def hi():\nreturn 1\n');
    const r = runSyntaxCheck(wt);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.invalidFiles).toContain('bad.py');
  });

  it('skips files with unknown extensions (no false positives)', () => {
    const wt = makeWorktree();
    writeFileSync(join(wt, 'notes.md'), '# anything goes\n```\nbroken {\n```\n');
    writeFileSync(join(wt, 'data.yaml'), 'a: [1, 2,\n');
    const r = runSyntaxCheck(wt);
    expect(r.errors).toBe(0);
    expect(r.invalidFiles).toEqual([]);
  });

  it('returns clean when there are no changes at all', () => {
    const wt = makeWorktree();
    const r = runSyntaxCheck(wt);
    expect(r.errors).toBe(0);
    expect(r.invalidFiles).toEqual([]);
  });

  it('returns clean when the sidecar is disabled — no fabricated failures', () => {
    const wt = makeWorktree();
    writeFileSync(join(wt, 'broken.ts'), 'export const x: number = ;\n');
    process.env.AGON_DISABLE_SYNTAX_VALIDATOR_SIDECAR = '1';
    try {
      const r = runSyntaxCheck(wt);
      expect(r.errors).toBe(0);
      expect(r.invalidFiles).toEqual([]);
    } finally {
      delete process.env.AGON_DISABLE_SYNTAX_VALIDATOR_SIDECAR;
    }
  });
});
