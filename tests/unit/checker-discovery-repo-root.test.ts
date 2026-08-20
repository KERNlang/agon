import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverChecker, REPO_ROOT_MARKERS } from '../../packages/core/src/diagnostics/checker-discovery.js';

// The upward config search must STOP at the repo root. Without the marker
// probe the walk escapes the repo and can bind a package's checker to a
// tsconfig from an unrelated parent directory (e.g. a sibling checkout, or
// the developer's home dir) — running `tsc -p` against the wrong project on
// every edit.

const dirs: string[] = [];

function scaffold(marker: string): { outer: string; repo: string; src: string } {
  const outer = mkdtempSync(join(tmpdir(), 'agon-checker-outer-'));
  dirs.push(outer);
  // A tsconfig ABOVE the repo root — must never be picked up.
  writeFileSync(join(outer, 'tsconfig.json'), '{}');
  const repo = join(outer, 'repo');
  const src = join(repo, 'src');
  mkdirSync(src, { recursive: true });
  if (marker === '.git') mkdirSync(join(repo, marker));
  else writeFileSync(join(repo, marker), '');
  return { outer, repo, src };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('discoverChecker repo-root containment', () => {
  for (const marker of REPO_ROOT_MARKERS) {
    it(`stops the upward walk at a dir holding ${marker}`, () => {
      const { src } = scaffold(marker);
      expect(discoverChecker(join(src, 'a.ts'), src)).toBeNull();
    });
  }

  it('still finds a tsconfig AT the repo root (the root is searched, inclusively)', () => {
    const { repo, src } = scaffold('.git');
    writeFileSync(join(repo, 'tsconfig.json'), '{}');
    const plan = discoverChecker(join(src, 'a.ts'), src);
    expect(plan).not.toBeNull();
    expect(plan!.packageDir).toBe(repo);
    expect(plan!.lang).toBe('ts');
    expect(plan!.cmd).toBe('npx');
  });

  it('finds the NEAREST tsconfig below the repo root', () => {
    const { repo, src } = scaffold('.git');
    writeFileSync(join(repo, 'tsconfig.json'), '{}');
    writeFileSync(join(src, 'tsconfig.json'), '{}');
    expect(discoverChecker(join(src, 'a.ts'), src)!.packageDir).toBe(src);
  });

  it('stops the python ruff walk at the repo root too', () => {
    const { outer, src } = scaffold('.git');
    writeFileSync(join(outer, 'ruff.toml'), '');
    expect(discoverChecker(join(src, 'a.py'), src)).toBeNull();
  });
});
