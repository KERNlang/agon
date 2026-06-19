import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherReviewFileContext, resolveReviewTarget } from '../../packages/cli/src/generated/handlers/review.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}-outside`, { recursive: true, force: true });
  }
  dir = undefined;
});

function setup(): string {
  dir = mkdtempSync(join(tmpdir(), 'agon-fctx-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'src', 'generated'), { recursive: true });
  writeFileSync(join(dir, 'src', 'foo.ts'), 'export function foo() { return 42; }\n');
  writeFileSync(join(dir, 'src', 'generated', 'foo.ts'), 'export const GENERATED = true;\n');
  return dir;
}

const diffFor = (...paths: string[]) =>
  paths.map((p) => `diff --git a/${p} b/${p}\nindex 1..2 100644\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n+x`).join('\n');

describe('gatherReviewFileContext (repo grounding)', () => {
  it('includes the full current content of a changed source file', () => {
    const d = setup();
    const out = gatherReviewFileContext(diffFor('src/foo.ts'), d);
    expect(out).toContain('### src/foo.ts');
    expect(out).toContain('export function foo() { return 42; }');
  });

  it('skips generated/ files (derived noise)', () => {
    const d = setup();
    const out = gatherReviewFileContext(diffFor('src/generated/foo.ts'), d);
    expect(out).toBe('');
  });

  it('skips files that do not exist (deleted/binary) without throwing', () => {
    const d = setup();
    const out = gatherReviewFileContext(diffFor('src/gone.ts'), d);
    expect(out).toBe('');
  });

  it('returns empty string for a diff with no eligible files', () => {
    const d = setup();
    expect(gatherReviewFileContext('not a diff', d)).toBe('');
  });

  it('refuses path traversal: a ../ path that escapes the repo root is skipped', () => {
    const d = setup();
    // A sibling secret OUTSIDE the repo root, referenced via ../
    const secret = join(d, '..', `agon-secret-${process.pid}.ts`);
    writeFileSync(secret, 'const API_KEY = "do-not-leak";\n');
    try {
      const out = gatherReviewFileContext(diffFor(`../agon-secret-${process.pid}.ts`), d);
      expect(out).toBe('');
      expect(out).not.toContain('do-not-leak');
    } finally {
      rmSync(secret, { force: true });
    }
  });

  it('skips binary files (NUL byte) decoded as utf-8', () => {
    const d = setup();
    writeFileSync(join(d, 'src', 'bin.dat'), Buffer.from([0x66, 0x00, 0x6f, 0x6f]));
    const out = gatherReviewFileContext(diffFor('src/bin.dat'), d);
    expect(out).toBe('');
  });

  it('does not put NUL bytes from untracked binary files into review diffs', () => {
    const d = setup();
    execFileSync('git', ['init'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'agon-test@example.test'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Agon Test'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['add', 'src/foo.ts', 'src/generated/foo.ts'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: d, stdio: 'ignore' });

    writeFileSync(join(d, 'src', 'new.bin'), Buffer.from([0x66, 0x00, 0x6f, 0x6f]));

    const { diff } = resolveReviewTarget('uncommitted', d);
    expect(diff).not.toContain('\u0000');
    expect(diff).toContain('src/new.bin');
    expect(diff).toContain('[binary or unreadable]');
  });

  it('does not follow untracked symlinks outside the repo when synthesizing review diffs', () => {
    const d = setup();
    execFileSync('git', ['init'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'agon-test@example.test'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Agon Test'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['add', 'src/foo.ts', 'src/generated/foo.ts'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: d, stdio: 'ignore' });

    const outside = `${d}-outside`;
    writeFileSync(outside, 'SECRET_OUTSIDE_REPO\n');
    symlinkSync(outside, join(d, 'src', 'outside-link.txt'));

    const { diff } = resolveReviewTarget('uncommitted', d);
    expect(diff).not.toContain('SECRET_OUTSIDE_REPO');
    expect(diff).not.toContain('outside-link.txt');
  });

  it('explicit-base branch reviews do not trigger the self-diff fallback', () => {
    const d = setup();
    execFileSync('git', ['init'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'agon-test@example.test'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Agon Test'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['add', 'src/foo.ts', 'src/generated/foo.ts'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'base'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['branch', '-m', 'main'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['switch', '-c', 'feature'], { cwd: d, stdio: 'ignore' });
    writeFileSync(join(d, 'src', 'foo.ts'), 'export function foo() { return 43; }\n');
    execFileSync('git', ['add', 'src/foo.ts'], { cwd: d, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feature'], { cwd: d, stdio: 'ignore' });

    const { diff, label } = resolveReviewTarget('branch:feature', d, 'main');
    expect(label).toBe('branch feature vs main');
    expect(diff).toContain('return 43');
  });

  it('enforces a HARD total cap (does not overshoot by a full block)', () => {
    const d = setup();
    const big = 'x'.repeat(19_000);
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      const rel = `src/big${i}.ts`;
      writeFileSync(join(d, 'src', `big${i}.ts`), big);
      names.push(rel);
    }
    const out = gatherReviewFileContext(diffFor(...names), d);
    // 5×19k would be ~95k; the hard cap stops before overshooting 60k.
    expect(out.length).toBeLessThan(60_000);
    expect(out).toContain('total cap reached');
  });
});
