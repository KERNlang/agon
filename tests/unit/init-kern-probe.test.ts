import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { countKernFiles } from '../../packages/cli/src/signals/dispatch/intent-init.js';

// `/init` decides whether to emit the KERN sections of AGENTS.md from this
// probe. It must count real *.kern FILES only — an empty `src/kern`, a tree of
// .ts files, or a directory NAMED `foo.kern` is not KERN evidence.
describe('/init KERN probe — countKernFiles', () => {
  const dirs: string[] = [];
  function tmpRepo(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(d);
    return d;
  }
  afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

  it('counts .kern files at the top level and nested', () => {
    const root = tmpRepo('agon-initprobe-');
    mkdirSync(join(root, 'blocks'), { recursive: true });
    writeFileSync(join(root, 'app.kern'), 'fn name=main\n');
    writeFileSync(join(root, 'blocks', 'arena.kern'), 'fn name=arena\n');
    expect(countKernFiles(root, readdirSync)).toBe(2);
  });

  it('is 0 for a missing directory', () => {
    const root = tmpRepo('agon-initprobe-missing-');
    expect(countKernFiles(join(root, 'src', 'kern'), readdirSync)).toBe(0);
  });

  it('is 0 for an empty directory', () => {
    const root = tmpRepo('agon-initprobe-empty-');
    expect(countKernFiles(root, readdirSync)).toBe(0);
  });

  it('is 0 when the directory only holds subdirectories', () => {
    const root = tmpRepo('agon-initprobe-subdirs-');
    mkdirSync(join(root, 'blocks', 'nested'), { recursive: true });
    expect(countKernFiles(root, readdirSync)).toBe(0);
  });

  it('is 0 when the directory only holds non-.kern files', () => {
    const root = tmpRepo('agon-initprobe-ts-');
    writeFileSync(join(root, 'app.ts'), 'export const x = 1;\n');
    expect(countKernFiles(root, readdirSync)).toBe(0);
  });

  it('does not count a DIRECTORY named *.kern', () => {
    const root = tmpRepo('agon-initprobe-dir-');
    mkdirSync(join(root, 'foo.kern'), { recursive: true });
    mkdirSync(join(root, 'nested', 'bar.kern'), { recursive: true });
    expect(countKernFiles(root, readdirSync)).toBe(0);
  });

  it('counts real .kern files that live inside a directory named *.kern', () => {
    const root = tmpRepo('agon-initprobe-mixed-');
    mkdirSync(join(root, 'foo.kern'), { recursive: true });
    writeFileSync(join(root, 'foo.kern', 'real.kern'), 'fn name=real\n');
    expect(countKernFiles(root, readdirSync)).toBe(1);
  });
});
