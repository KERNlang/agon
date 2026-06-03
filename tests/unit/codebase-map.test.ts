import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractSymbols, collectSourceFiles, buildCodebaseMap, clearCodebaseMapCache } from '../../packages/core/src/generated/blocks/codebase-map.js';

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
});
