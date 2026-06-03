import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { extractSymbols, collectSourceFiles, buildCodebaseMap, clearCodebaseMapCache } from '../../packages/core/src/generated/blocks/codebase-map.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

describe('codebase-map — extractSymbols', () => {
  it('pulls KERN node declarations', () => {
    const src = `fn name=doThing params="x:string" returns=void\nservice name=Widget\nunion name=Shape\nconst name=LIMIT value={{ 5 }}\ninterface name=Opts`;
    expect(extractSymbols('a.kern', src)).toEqual(['doThing', 'Widget', 'Shape', 'LIMIT', 'Opts']);
  });

  it('pulls TS exported declarations only (not internal)', () => {
    const src = `const internal = 1;\nexport function publicFn() {}\nexport const PUBLIC = 2;\nexport class Foo {}\nexport interface Bar {}\nexport type Baz = number;`;
    expect(extractSymbols('a.ts', src)).toEqual(['publicFn', 'PUBLIC', 'Foo', 'Bar', 'Baz']);
  });

  it('pulls Python def/class', () => {
    expect(extractSymbols('a.py', 'def run():\n    pass\nclass Engine:\n    pass')).toEqual(['run', 'Engine']);
  });

  it('caps at 12 names', () => {
    const src = Array.from({ length: 20 }, (_, i) => `export const S${i} = ${i};`).join('\n');
    expect(extractSymbols('a.ts', src).length).toBe(12);
  });

  it('returns [] for non-source extensions', () => {
    expect(extractSymbols('a.md', '# hi')).toEqual([]);
  });
});

describe('codebase-map — buildCodebaseMap', () => {
  let testHome: string;
  beforeEach(() => { testHome = setupTestAgonHome('codebase-map'); });
  afterEach(() => { cleanupTestAgonHome(testHome); });

  function cacheFileFor(root: string): string {
    const key = createHash('sha1').update(root).digest('hex').slice(0, 16);
    return agonHomePath('cache', 'codebase-map', `${key}.json`);
  }

  function seedCache(root: string, payload: { sig: string; brief: string; builtAt: number }): void {
    const file = cacheFileFor(root);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(payload));
  }

  function fixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'agon-map-'));
    mkdirSync(join(root, 'packages/core/src'), { recursive: true });
    mkdirSync(join(root, 'packages/core/src/generated'), { recursive: true });
    mkdirSync(join(root, 'node_modules/junk'), { recursive: true });
    writeFileSync(join(root, 'packages/core/src/widget.kern'), 'fn name=makeWidget returns=void\nservice name=Widget');
    writeFileSync(join(root, 'packages/core/src/generated/widget.ts'), 'export const makeWidget = () => {};');
    writeFileSync(join(root, 'node_modules/junk/index.ts'), 'export const SHOULD_NOT_APPEAR = 1;');
    return root;
  }

  it('builds a brief that groups by package, lists symbols, and excludes node_modules', () => {
    const root = fixture();
    clearCodebaseMapCache(root);
    const brief = buildCodebaseMap(root);
    expect(brief).toContain('CODEBASE BRIEF');
    expect(brief).toContain('packages/core');
    expect(brief).toContain('widget.kern');
    expect(brief).toContain('makeWidget');
    expect(brief).toContain('Widget');
    // node_modules is ignored
    expect(brief).not.toContain('SHOULD_NOT_APPEAR');
    // generated mirror is noted but not listed for symbols
    expect(brief).toContain('EDIT THE .kern');
    expect(brief).not.toContain('generated/widget.ts');
  });

  it('respects the maxChars cap', () => {
    const root = fixture();
    clearCodebaseMapCache(root);
    const brief = buildCodebaseMap(root, 120);
    expect(brief.length).toBeLessThanOrEqual(120 + 40); // + truncation marker
  });

  it('collectSourceFiles finds indexed files and skips ignored dirs', () => {
    const root = fixture();
    const files = collectSourceFiles(root);
    expect(files.some((f) => f.endsWith('widget.kern'))).toBe(true);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('writes a disk cache (sig + brief + builtAt) on build', () => {
    const root = fixture();
    clearCodebaseMapCache(root);
    buildCodebaseMap(root);
    const raw = JSON.parse(readFileSync(cacheFileFor(root), 'utf-8'));
    expect(typeof raw.sig).toBe('string');
    expect(typeof raw.builtAt).toBe('number');
    expect(raw.brief).toContain('CODEBASE BRIEF');
    // Non-git temp dir, no lockfile → 'nogit:0'.
    expect(raw.sig).toBe('nogit:0');
  });

  it('serves a valid disk cache instead of rebuilding (cold memo)', () => {
    const root = fixture();
    seedCache(root, { sig: 'nogit:0', brief: 'sentinel-DISK-HIT', builtAt: Date.now() });
    const brief = buildCodebaseMap(root);
    expect(brief).toBe('sentinel-DISK-HIT'); // came from disk, not a fresh walk
    expect(brief).not.toContain('widget.kern');
  });

  it('invalidates the disk cache when the signature changes', () => {
    const root = fixture();
    seedCache(root, { sig: 'STALE-SIG', brief: 'OLD STALE BRIEF', builtAt: Date.now() });
    const brief = buildCodebaseMap(root);
    expect(brief).toContain('widget.kern'); // rebuilt
    expect(brief).not.toContain('OLD STALE BRIEF');
    const rewritten = JSON.parse(readFileSync(cacheFileFor(root), 'utf-8'));
    expect(rewritten.sig).toBe('nogit:0'); // refreshed with the current signature
  });

  it('ignores a disk cache past its TTL', () => {
    const root = fixture();
    const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000; // TTL is 6h
    seedCache(root, { sig: 'nogit:0', brief: 'EXPIRED BRIEF', builtAt: sevenHoursAgo });
    const brief = buildCodebaseMap(root);
    expect(brief).not.toContain('EXPIRED BRIEF');
    expect(brief).toContain('widget.kern'); // rebuilt despite a matching signature
  });

  it('a custom maxChars bypasses the cache (never reads a seeded brief)', () => {
    const root = fixture();
    seedCache(root, { sig: 'nogit:0', brief: 'sentinel-DISK-HIT', builtAt: Date.now() });
    const brief = buildCodebaseMap(root, 4000);
    expect(brief).not.toBe('sentinel-DISK-HIT');
    expect(brief).toContain('widget.kern');
  });

  it('lists .kern sources before hand-TS facades within a group', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-map-heur-'));
    mkdirSync(join(root, 'packages/cli/src/blocks'), { recursive: true });
    mkdirSync(join(root, 'packages/cli/src/kern'), { recursive: true });
    // 'blocks/aaa.ts' sorts alphabetically before 'kern/zzz.kern'; the heuristic
    // must still surface the .kern source first.
    writeFileSync(join(root, 'packages/cli/src/blocks/aaa.ts'), 'export const aaaFacade = 1;');
    writeFileSync(join(root, 'packages/cli/src/kern/zzz.kern'), 'fn name=zzzSource returns=void');
    clearCodebaseMapCache(root);
    const brief = buildCodebaseMap(root);
    const kernAt = brief.indexOf('zzz.kern');
    const facadeAt = brief.indexOf('aaa.ts');
    expect(kernAt).toBeGreaterThanOrEqual(0);
    expect(facadeAt).toBeGreaterThanOrEqual(0);
    expect(kernAt).toBeLessThan(facadeAt);
  });

  it('gives every package a fair share so a huge group cannot starve the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-map-fair-'));
    mkdirSync(join(root, 'packages/big/src/kern'), { recursive: true });
    mkdirSync(join(root, 'packages/small/src/kern'), { recursive: true });
    for (let i = 0; i < 15; i++) {
      writeFileSync(join(root, `packages/big/src/kern/f${String(i).padStart(2, '0')}.kern`), `fn name=symBig${i} returns=void`);
    }
    writeFileSync(join(root, 'packages/small/src/kern/only.kern'), 'fn name=symSmall returns=void');
    // A tight cap: under the old flat-12-per-group logic, packages/big would
    // consume the whole budget and packages/small would never be reached.
    const brief = buildCodebaseMap(root, 600);
    expect(brief).toContain('### packages/big');
    expect(brief).toContain('### packages/small'); // the starved group still appears
    expect(brief).toContain('only.kern');
  });
});
