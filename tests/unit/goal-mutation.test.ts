import { describe, it, expect } from 'vitest';
import { generateMutants, applyMutantToSource } from '../../packages/forge/src/generated/goal/mutation.js';
import { hashOracleInputs } from '../../packages/forge/src/generated/goal/oracle.js';
import { assertSafeGoalId, resolveWithin } from '../../packages/forge/src/generated/goal/paths.js';

describe('mutation-witness — generateMutants', () => {
  const src = [
    'function add(a, b) {',          // L1
    '  return a + b;',               // L2  (arith + ; return)
    '  const ok = a === b && a > 0;', // L3 (===, &&, >)
    '  const xs = [];',              // L4  ([])
    '}',                             // L5
  ].join('\n');

  it('only mutates the lines marked as changed', () => {
    const mutants = generateMutants(src, [2]);
    expect(mutants.length).toBeGreaterThan(0);
    expect(mutants.every((m) => m.line === 2)).toBe(true);
    // line 2 yields at least the + -> - and the return -> undefined mutants
    const ops = mutants.map((m) => m.operator);
    expect(ops).toContain('arith:+→-');
    expect(ops).toContain('ret:→undefined');
  });

  it('produces operator-specific mutants with correct mutated text (not just presence)', () => {
    const mutants = generateMutants(src, [3]);
    const ops = mutants.map((m) => m.operator);
    expect(ops).toContain('eq:===→!==');
    expect(ops).toContain('logic:&&→||');
    expect(ops).toContain('rel:>→<=');
    // each operator starts from the pristine line, so no self-inversion
    expect(mutants.find((m) => m.operator === 'eq:===→!==')!.after).toBe('  const ok = a !== b && a > 0;');
    expect(mutants.find((m) => m.operator === 'logic:&&→||')!.after).toBe('  const ok = a === b || a > 0;');
  });

  it('mutates empty-array literal but not array TYPE annotations', () => {
    expect(generateMutants(src, [4]).map((m) => m.operator)).toContain('arr:[]→[0]');
    // `string[] = []` must mutate the value [], never the `string[]` type
    const typed = generateMutants('const xs: string[] = [];', [1]);
    const arr = typed.find((m) => m.operator === 'arr:[]→[0]');
    expect(arr!.after).toBe('const xs: string[] = [0];');
  });

  it('ignores out-of-range line numbers', () => {
    expect(generateMutants(src, [999])).toEqual([]);
    expect(generateMutants(src, [0])).toEqual([]);
  });

  it('does not mutate ++ as a + -> - operator (lookbehind guard)', () => {
    const ops = generateMutants('  i++;', [1]).map((m) => m.operator);
    expect(ops).not.toContain('arith:+→-');
  });
});

describe('mutation-witness — applyMutantToSource', () => {
  const src = 'a\nb\nc';
  it('swaps exactly the mutant line, leaving others intact', () => {
    const [m] = generateMutants('x + y', [1]);
    const out = applyMutantToSource('x + y\nz', m);
    expect(out.split('\n')[0]).toBe('x - y');
    expect(out.split('\n')[1]).toBe('z');
  });
  it('returns source unchanged for an out-of-range line', () => {
    expect(applyMutantToSource(src, { id: 'x', operator: 'x', line: 99, before: '', after: 'ZZ', class: 'equiv-prone' })).toBe(src);
  });
});

describe('path safety', () => {
  it('assertSafeGoalId accepts slugs and rejects traversal', () => {
    expect(assertSafeGoalId('g-123_abc')).toBe('g-123_abc');
    for (const bad of ['..', 'a/b', '../etc', 'a.b', '/abs', '', 'has space']) {
      expect(() => assertSafeGoalId(bad)).toThrow();
    }
  });
  it('resolveWithin rejects paths that escape the root', () => {
    expect(resolveWithin('/tmp/wt', 'a/b.ts')).toBe('/tmp/wt/a/b.ts');
    expect(() => resolveWithin('/tmp/wt', '../escape.ts')).toThrow();
    expect(() => resolveWithin('/tmp/wt', '/etc/passwd')).toThrow();
  });
});

describe('frozen oracle — hashOracleInputs', () => {
  it('is stable and gate-sensitive', () => {
    const h1 = hashOracleInputs('npm test', []);
    const h2 = hashOracleInputs('npm test', []);
    const h3 = hashOracleInputs('npm test -- --changed', []);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
  it('is order-independent across the file list', () => {
    // nonexistent files contribute empty content, but sorting makes order irrelevant
    const a = hashOracleInputs('g', ['/tmp/zzz-nope.txt', '/tmp/aaa-nope.txt']);
    const b = hashOracleInputs('g', ['/tmp/aaa-nope.txt', '/tmp/zzz-nope.txt']);
    expect(a).toBe(b);
  });
});
