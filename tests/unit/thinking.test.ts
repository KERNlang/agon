// Unit tests for the native sequential-thinking pure logic.
// Covers the prompt scaffold, JSON parse/normalize, tool-grounding, and the
// machine-enforced protocol validation — everything testable without a paid
// engine dispatch.
import { describe, it, expect } from 'vitest';
import {
  isThinkStrategy,
  buildThinkPrompt,
  parseThoughts,
  groundThoughts,
  validateChain,
  joinProblemInput,
  selectBranch,
} from '@kernlang/agon-forge';
import type { ThoughtNode } from '@kernlang/agon-forge';

const node = (over: Partial<ThoughtNode>): ThoughtNode => ({
  thoughtNumber: 1,
  totalThoughts: 1,
  thought: '',
  kind: 'analysis',
  nextThoughtNeeded: false,
  ...over,
});

describe('isThinkStrategy', () => {
  it('accepts all five strategies', () => {
    for (const s of ['linear', 'reflexion', 'tot', 'graph', 'hypothesis']) {
      expect(isThinkStrategy(s)).toBe(true);
    }
  });
  it('rejects unknown strategies', () => {
    expect(isThinkStrategy('nonsense')).toBe(false);
    expect(isThinkStrategy('')).toBe(false);
  });
});

describe('joinProblemInput', () => {
  it('does not double the prompt when citty mirrors the positional into _', () => {
    // The exact bug the live smoke test caught.
    expect(joinProblemInput('use a token bucket?', ['use a token bucket?'])).toBe('use a token bucket?');
  });
  it('folds trailing unquoted words after the named positional', () => {
    expect(joinProblemInput('foo', ['foo', 'bar', 'baz'])).toBe('foo bar baz');
  });
  it('handles an empty _ array', () => {
    expect(joinProblemInput('just this', [])).toBe('just this');
  });
  it('handles an absent named positional', () => {
    expect(joinProblemInput(undefined, ['only', 'extras'])).toBe('only extras');
  });
});

describe('buildThinkPrompt', () => {
  it('selects the linear method block', () => {
    const p = buildThinkPrompt('do x', 'linear', 6, 1);
    expect(p).toContain('METHOD = linear');
    expect(p).not.toContain('BRANCHING');
    expect(p).toContain('at most 6 thoughts');
  });
  it('selects the reflexion method block', () => {
    const p = buildThinkPrompt('do x', 'reflexion', 6, 1);
    expect(p).toContain('METHOD = reflexion');
    expect(p).toContain('critique');
  });
  it('adds branching instructions when branches > 1', () => {
    const p = buildThinkPrompt('do x', 'linear', 20, 5);
    expect(p).toContain('BRANCHING');
    expect(p).toContain('5 alternative reasoning branches');
    expect(p).toContain('per branch');
  });
  it('selects the tot method with branch scoring', () => {
    const p = buildThinkPrompt('do x', 'tot', 8, 3);
    expect(p).toContain('tree-of-thoughts');
    expect(p).toContain('branchScore');
  });
  it('selects the graph method with merge', () => {
    expect(buildThinkPrompt('do x', 'graph', 8, 3)).toContain('graph-of-thoughts');
    expect(buildThinkPrompt('do x', 'graph', 8, 3)).toContain('MERGE');
  });
  it('selects the hypothesis-elimination method', () => {
    const p = buildThinkPrompt('do x', 'hypothesis', 8, 1);
    expect(p).toContain('hypothesis-elimination');
    expect(p).toContain('competing');
  });
});

describe('selectBranch', () => {
  it('keeps the highest mean-scored branch and prunes the losers', () => {
    const chain = [
      node({ thoughtNumber: 1, kind: 'analysis' }), // shared lead-up, no branch
      node({ thoughtNumber: 2, kind: 'analysis', branchId: 'A', branchScore: 80 }),
      node({ thoughtNumber: 3, kind: 'analysis', branchId: 'A', branchScore: 90 }),
      node({ thoughtNumber: 4, kind: 'analysis', branchId: 'B', branchScore: 30 }),
    ];
    const { thoughts, chosenBranch } = selectBranch(chain);
    expect(chosenBranch).toBe('A');
    expect(thoughts.find((t) => t.thoughtNumber === 1)?.pruned).toBeUndefined(); // shared never pruned
    expect(thoughts.find((t) => t.thoughtNumber === 2)?.pruned).toBeUndefined(); // chosen branch kept
    expect(thoughts.find((t) => t.thoughtNumber === 4)?.pruned).toBe(true);      // loser pruned
  });
  it('does nothing with fewer than two branches', () => {
    const chain = [node({ kind: 'analysis' }), node({ kind: 'analysis', branchId: 'A', branchScore: 50 })];
    const { chosenBranch, thoughts } = selectBranch(chain);
    expect(chosenBranch).toBeUndefined();
    expect(thoughts.every((t) => !t.pruned)).toBe(true);
  });
});

describe('parseThoughts', () => {
  it('parses a well-formed JSON chain', () => {
    const raw = JSON.stringify({
      thoughts: [
        { thoughtNumber: 1, totalThoughts: 2, thought: 'first', kind: 'analysis', nextThoughtNeeded: true },
        { thoughtNumber: 2, totalThoughts: 2, thought: 'second', kind: 'decision', nextThoughtNeeded: false },
      ],
      summary: 'done',
      openQuestions: ['q1?'],
      refinedSpec: 'spec',
    });
    const out = parseThoughts(raw, 6);
    expect(out.thoughts).toHaveLength(2);
    expect(out.thoughts[1].kind).toBe('decision');
    expect(out.summary).toBe('done');
    expect(out.openQuestions).toEqual(['q1?']);
    expect(out.refinedSpec).toBe('spec');
  });

  it('tolerates code fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n{"thoughts":[{"thought":"x","kind":"analysis"}],"summary":"s"}\n```\nthanks';
    const out = parseThoughts(raw, 6);
    expect(out.thoughts).toHaveLength(1);
    expect(out.thoughts[0].thought).toBe('x');
  });

  it('clamps to maxThoughts', () => {
    const thoughts = Array.from({ length: 10 }, (_, i) => ({ thought: `t${i}`, kind: 'analysis' }));
    const out = parseThoughts(JSON.stringify({ thoughts }), 3);
    expect(out.thoughts).toHaveLength(3);
  });

  it('falls back to a single thought when JSON is absent', () => {
    const out = parseThoughts('just some prose, no json here', 6);
    expect(out.thoughts).toHaveLength(1);
    expect(out.thoughts[0].kind).toBe('analysis');
    expect(out.thoughts[0].thought).toContain('prose');
  });

  it('parses thoughts whose text contains braces (code snippets)', () => {
    // Regression: brace-counting must skip braces inside JSON string values,
    // or a thought about code dumps the whole chain into one raw fallback.
    const raw = JSON.stringify({
      thoughts: [
        { thought: 'use a KERN fn: fn foo() { return { a: 1 }; }', kind: 'analysis' },
        { thought: 'then guard with if (x) { bail(); }', kind: 'decision' },
      ],
      summary: 'wrap it in { braces }',
      refinedSpec: 'emit { "ok": true }',
    });
    const out = parseThoughts(raw, 6);
    expect(out.thoughts).toHaveLength(2);
    expect(out.thoughts[0].thought).toContain('return { a: 1 }');
    expect(out.summary).toContain('{ braces }');
  });

  it('preserves a fenced code block inside a thought string (no fence-stripping)', () => {
    const raw = JSON.stringify({
      thoughts: [{ thought: 'write:\n```ts\nfn x() { return 1; }\n```\ndone', kind: 'analysis' }],
      summary: 's',
    });
    const out = parseThoughts(raw, 6);
    expect(out.thoughts).toHaveLength(1);
    expect(out.thoughts[0].thought).toContain('```ts');
    expect(out.thoughts[0].thought).toContain('fn x() { return 1; }');
  });

  it('extracts JSON even with prose and a stray brace before it', () => {
    const raw = 'Here is my answer (note: use {} carefully):\n{"thoughts":[{"thought":"x","kind":"analysis"}],"summary":"s"}';
    const out = parseThoughts(raw, 6);
    expect(out.thoughts).toHaveLength(1);
    expect(out.thoughts[0].thought).toBe('x');
    expect(out.summary).toBe('s');
  });

  it('coerces unknown kinds to analysis', () => {
    const out = parseThoughts(JSON.stringify({ thoughts: [{ thought: 'x', kind: 'wat' }] }), 6);
    expect(out.thoughts[0].kind).toBe('analysis');
  });
});

describe('groundThoughts', () => {
  it('flags a thought that cites a non-existent repo path', () => {
    const { thoughts, issues } = groundThoughts(
      [node({ thought: 'edit packages/forge/nope-does-not-exist.ts please' })],
      process.cwd(),
    );
    expect(thoughts[0].grounded).toBe(false);
    expect(issues.join(' ')).toContain('nope-does-not-exist.ts');
  });

  it('accepts a thought citing a real repo path', () => {
    const { thoughts, issues } = groundThoughts(
      [node({ thought: 'look at packages/forge/package.json' })],
      process.cwd(),
    );
    expect(thoughts[0].grounded).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it('ignores bare filenames without a path separator', () => {
    const { issues } = groundThoughts([node({ thought: 'see index.js somewhere' })], process.cwd());
    expect(issues).toHaveLength(0);
  });

  it('does not flag URLs or dotted hosts as missing local files', () => {
    const { issues } = groundThoughts(
      [node({ thought: 'see https://github.com/foo/bar.md and docs at example.com/spec.json' })],
      process.cwd(),
    );
    expect(issues).toHaveLength(0);
  });
});

describe('validateChain (machine-enforced protocol)', () => {
  it('accepts a plain linear chain', () => {
    const chain = [node({ kind: 'analysis' }), node({ kind: 'analysis' }), node({ kind: 'decision' })];
    expect(validateChain(chain, 'linear')).toBe(true);
  });

  it('accepts a reflexion chain with critique then revision', () => {
    const chain = [
      node({ kind: 'analysis' }),
      node({ kind: 'critique' }),
      node({ kind: 'revision' }),
    ];
    expect(validateChain(chain, 'reflexion')).toBe(true);
  });

  it('rejects reflexion that never critiques', () => {
    const chain = [node({ kind: 'analysis' }), node({ kind: 'analysis' })];
    expect(validateChain(chain, 'reflexion')).toBe(false);
  });

  it('rejects a revision that does not follow a critique', () => {
    // revision from `thinking` (not `critiquing`) trips a ThinkChainStateError.
    const chain = [node({ kind: 'analysis' }), node({ kind: 'revision' })];
    expect(validateChain(chain, 'linear')).toBe(false);
  });

  it('validates each branch independently (branch-aware)', () => {
    const chain = [
      node({ kind: 'analysis' }), // shared lead-up (main)
      node({ kind: 'analysis', branchId: 'A', branchFromThought: 1 }),
      node({ kind: 'analysis', branchId: 'B', branchFromThought: 1 }),
    ];
    expect(validateChain(chain, 'linear')).toBe(true);
  });

  it('accepts a tot chain of scored branches', () => {
    const chain = [
      node({ kind: 'analysis' }),
      node({ kind: 'analysis', branchId: 'A', branchScore: 80 }),
      node({ kind: 'decision', branchId: 'B', branchScore: 40 }),
    ];
    expect(validateChain(chain, 'tot')).toBe(true);
  });

  it('accepts a graph chain ending in a merge decision', () => {
    const chain = [
      node({ kind: 'analysis', branchId: 'A' }),
      node({ kind: 'analysis', branchId: 'B' }),
      node({ kind: 'decision' }), // merge
    ];
    expect(validateChain(chain, 'graph')).toBe(true);
  });

  it('requires >=2 hypotheses for the hypothesis strategy', () => {
    const ok = [
      node({ kind: 'hypothesis' }),
      node({ kind: 'hypothesis' }),
      node({ kind: 'analysis' }),
      node({ kind: 'decision' }),
    ];
    expect(validateChain(ok, 'hypothesis')).toBe(true);
    const tooFew = [node({ kind: 'hypothesis' }), node({ kind: 'decision' })];
    expect(validateChain(tooFew, 'hypothesis')).toBe(false);
  });
});
