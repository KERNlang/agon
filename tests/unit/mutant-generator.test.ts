// Pins the shared MECHANICAL operator set (packages/core/src/kern/tools/mutant-generator.kern).
// The runner's kill/survive behavior lives in mutant-runner.test.ts; what is
// pinned here is which LINES earn a mutant at all, and that the operator classes
// did not move when comment skipping landed.
import { describe, it, expect } from 'vitest';
import { commentOnlyLines, generateMutants } from '../../packages/core/src/generated/tools/mutant-generator.js';

const allLines = (src: string): number[] => src.split('\n').map((_, i) => i + 1);

describe('commentOnlyLines — which lines carry no executable code', () => {
  it('flags line comments, block comments and their continuations', () => {
    const src = [
      '// a + b',            // 1
      'const x = a + b;',    // 2
      '/* a + b */',         // 3
      '/**',                 // 4
      ' * a + b',            // 5
      ' */',                 // 6
      'const y = a && b;',   // 7
    ].join('\n');
    expect(commentOnlyLines(src)).toEqual([true, false, true, true, true, true, false]);
  });

  it('does not flag a line that mixes code with a trailing comment', () => {
    expect(commentOnlyLines('x = a + b; // note')).toEqual([false]);
    expect(commentOnlyLines('x = a + b; /* note */')).toEqual([false]);
    expect(commentOnlyLines('x /* mid */ = a + b;')).toEqual([false]);
  });

  it('is string-aware — a comment opener inside a literal opens nothing', () => {
    const src = [
      "const s = '/* not a comment';", // 1
      'const t = a + b;',              // 2
    ].join('\n');
    expect(commentOnlyLines(src)).toEqual([false, false]);
  });

  it('reopens code on the line that CLOSES a block comment', () => {
    const src = ['/* start', 'still comment', '*/ const z = a + b;'].join('\n');
    expect(commentOnlyLines(src)).toEqual([true, true, false]);
  });
});

describe('generateMutants — comment-only lines produce no mutants', () => {
  it('yields nothing for a doc comment (every swap there is equivalent by construction)', () => {
    const src = ['// a + b', ' * a === b', '/* a && b */'].join('\n');
    expect(generateMutants(src, allLines(src), 'src/a.ts')).toEqual([]);
  });

  it('still mutates a code line that carries a trailing comment', () => {
    const mutants = generateMutants('x = a + b; // note', [1], 'src/a.ts');
    expect(mutants.map((m) => m.operator)).toContain('arith:+→-');
    expect(mutants[0].after).toBe('x = a - b; // note');
  });

  it('leaves string literals alone — only comments are skipped', () => {
    const mutants = generateMutants("const s = 'a + b';", [1], 'src/a.ts');
    expect(mutants.map((m) => m.operator)).toContain('arith:+→-');
  });

  it('keeps the operator set and its class labels unchanged', () => {
    const src = 'const ok = a + b === c && d < e ? true : [];';
    const mutants = generateMutants(src, [1], 'src/a.ts');
    const byOp = new Map(mutants.map((m) => [m.operator, m.class]));
    expect(byOp.get('arith:+→-')).toBe('high-signal');
    expect(byOp.get('eq:===→!==')).toBe('high-signal');
    expect(byOp.get('logic:&&→||')).toBe('high-signal');
    expect(byOp.get('bool:true→false')).toBe('high-signal');
    expect(byOp.get('rel:<→>=')).toBe('equiv-prone');
    expect(byOp.get('arr:[]→[0]')).toBe('equiv-prone');
  });
});
