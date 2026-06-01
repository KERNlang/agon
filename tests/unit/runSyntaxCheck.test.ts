import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSyntaxCheck } from '../../packages/forge/src/quality.js';

// Mock the @kernlang/agon-core bridge so these tests don't need the tree-sitter
// Python sidecar installed on the runner. The mock mimics the real
// language detection + a small fake validator that catches the specific
// invalid inputs the tests use (broken-TS missing-rhs, broken-Python
// indentation). Real-sidecar behavior is covered by the dedup smoke
// tests, which fail loudly when tree-sitter isn't installed.
vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  const detect = (p: string): string => {
    if (p.endsWith('.ts') || p.endsWith('.cts') || p.endsWith('.mts')) return 'typescript';
    if (p.endsWith('.tsx')) return 'tsx';
    if (p.endsWith('.js') || p.endsWith('.cjs') || p.endsWith('.mjs')) return 'javascript';
    if (p.endsWith('.jsx')) return 'jsx';
    if (p.endsWith('.py') || p.endsWith('.pyi')) return 'python';
    if (p.endsWith('.json')) return 'json';
    return '';
  };
  return {
    ...orig,
    detectLanguageFromPath: detect,
    validateSyntax: (files: Array<{ path: string; content: string; language: string }>) => {
      if (process.env.AGON_DISABLE_SYNTAX_VALIDATOR_SIDECAR) return null;
      return files.map((f) => {
        // Trivial broken-TS detector: dangling `= ;` style.
        const tsBroken = (f.language === 'typescript' || f.language === 'tsx')
          && /=\s*;/.test(f.content);
        // Broken Python: `def name():\n<unindented>...` (no indent after colon).
        const pyBroken = f.language === 'python'
          && /:\s*\n[^\s#]/m.test(f.content);
        const invalid = tsBroken || pyBroken;
        return {
          path: f.path,
          valid: !invalid,
          language: f.language,
          errors: invalid ? [{ row: 0, column: 0, message: 'ERROR' }] : [],
          languageUnsupported: f.language ? undefined : true,
        };
      });
    },
  };
});

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
