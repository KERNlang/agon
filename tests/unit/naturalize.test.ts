import { describe, expect, it } from 'vitest';

import {
  runNaturalize,
  buildNaturalizePrompt,
  wordDiffStats,
  type NaturalizeOptions,
} from '../../packages/forge/src/generated/naturalize.js';

// ── wordDiffStats ────────────────────────────────────────────────────────────

describe('naturalize — wordDiffStats', () => {
  it('identical text → unchangedRatio 1, zero changed words', () => {
    const d = wordDiffStats('the quick brown fox', 'the quick brown fox');
    expect(d).toEqual({ wordsBefore: 4, wordsAfter: 4, changedWords: 0, unchangedRatio: 1 });
  });

  it('empty inputs → unchangedRatio 1 (nothing to change)', () => {
    expect(wordDiffStats('', '')).toEqual({ wordsBefore: 0, wordsAfter: 0, changedWords: 0, unchangedRatio: 1 });
  });

  it('total rewrite → unchangedRatio 0', () => {
    const d = wordDiffStats('alpha beta gamma', 'delta epsilon zeta');
    expect(d.changedWords).toBe(3);
    expect(d.unchangedRatio).toBe(0);
  });

  it('reordered words count as unchanged (multiset, not positional)', () => {
    const d = wordDiffStats('one two three', 'three two one');
    expect(d.unchangedRatio).toBe(1);
    expect(d.changedWords).toBe(0);
  });

  it('duplicate words use multiset subtraction — repeats matter', () => {
    const d = wordDiffStats('very very good', 'very good');
    expect(d.wordsBefore).toBe(3);
    expect(d.wordsAfter).toBe(2);
    expect(d.changedWords).toBe(1);
    expect(d.unchangedRatio).toBeCloseTo(2 / 3);
  });

  it('is case-insensitive and strips punctuation', () => {
    const d = wordDiffStats('Hello, World!', 'hello world');
    expect(d.unchangedRatio).toBe(1);
  });
});

// ── buildNaturalizePrompt ────────────────────────────────────────────────────

describe('naturalize — buildNaturalizePrompt', () => {
  it('embeds the input text between sentinels', () => {
    const prompt = buildNaturalizePrompt('Some AI-sounding text.');
    expect(prompt).toContain('Some AI-sounding text.');
    expect(prompt).toMatch(/---\nSome AI-sounding text\.\n---/);
  });

  it('carries the meaning-preservation and output-only contract', () => {
    const prompt = buildNaturalizePrompt('x');
    expect(prompt).toContain('preserving every fact');
    expect(prompt).toContain('Output ONLY the rewritten text');
  });
});

// ── runNaturalize (pure guards + mocked adapter) ────────────────────────────

function makeOpts(overrides: Partial<NaturalizeOptions> = {}): NaturalizeOptions {
  return {
    input: 'Clean input text with no hidden channels.',
    engineId: 'minimax',
    registry: {
      get: (id: string) => {
        if (id === 'minimax') return { id: 'minimax' };
        throw new Error(`unknown engine: ${id}`);
      },
    } as unknown as NaturalizeOptions['registry'],
    adapter: {
      dispatch: async () => ({
        exitCode: 0,
        timedOut: false,
        stdout: 'Rewritten natural prose without any hidden channels.',
        stderr: '',
      }),
    } as unknown as NaturalizeOptions['adapter'],
    author: undefined,
    timeout: 30,
    outputDir: '/tmp/naturalize-test',
    cwd: '/tmp',
    ...overrides,
  };
}

describe('naturalize — runNaturalize guards', () => {
  it('refuses when rewrite engine equals the author (writer ≠ rewriter)', async () => {
    const result = await runNaturalize(makeOpts({ engineId: 'claude', author: 'claude' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('writer and rewriter must differ');
  });

  it('surfaces registry errors for unknown engines', async () => {
    const result = await runNaturalize(makeOpts({ engineId: 'ghost' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown engine');
  });

  it('surfaces non-zero dispatch exit with stderr detail', async () => {
    const opts = makeOpts();
    opts.adapter = {
      dispatch: async () => ({ exitCode: 2, timedOut: false, stdout: '', stderr: 'boom' }),
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
  });

  it('surfaces dispatch timeouts', async () => {
    const opts = makeOpts();
    opts.adapter = {
      dispatch: async () => ({ exitCode: 0, timedOut: true, stdout: '', stderr: '' }),
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('surfaces dispatch exceptions instead of throwing', async () => {
    const opts = makeOpts();
    opts.adapter = {
      dispatch: async () => { throw new Error('spawn blew up'); },
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('spawn blew up');
  });

  it('rejects empty engine output', async () => {
    const opts = makeOpts();
    opts.adapter = {
      dispatch: async () => ({ exitCode: 0, timedOut: false, stdout: '   \n ', stderr: '' }),
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('empty output');
  });
});

describe('naturalize — runNaturalize happy path', () => {
  it('strips a single surrounding code fence from chatty engines', async () => {
    const opts = makeOpts();
    opts.adapter = {
      dispatch: async () => ({
        exitCode: 0,
        timedOut: false,
        stdout: '```\nFenced but clean rewrite.\n```',
        stderr: '',
      }),
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(result.ok).toBe(true);
    expect(result.output).toBe('Fenced but clean rewrite.');
  });

  it('cleans the input BEFORE dispatch and re-cleans a dirty rewrite', async () => {
    const zwsp = '\u{200B}';
    let dispatchedPrompt = '';
    const opts = makeOpts({ input: `Input${zwsp} with hidden zero-width chars.` });
    opts.adapter = {
      dispatch: async (req: { prompt: string }) => {
        dispatchedPrompt = req.prompt;
        return {
          exitCode: 0,
          timedOut: false,
          // engine re-introduces a zero-width char → deterministic fallback clean
          stdout: `Rewritten${zwsp} text.`,
          stderr: '',
        };
      },
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(dispatchedPrompt).not.toContain(zwsp);
    expect(result.ok).toBe(true);
    expect(result.rewriteCleaned).toBe(true);
    expect(result.finalClean).toBe(true);
    expect(result.output).toBe('Rewritten text.');
    expect(result.initialFindings).toBeGreaterThan(0);
  });

  it('reports word-diff stats and residual not-assessable channels', async () => {
    const result = await runNaturalize(makeOpts());
    expect(result.ok).toBe(true);
    expect(result.wordsBefore).toBeGreaterThan(0);
    expect(result.wordsAfter).toBeGreaterThan(0);
    expect(result.changedWords).toBeGreaterThan(0);
    expect(result.unchangedRatio).toBeLessThan(1);
    // honesty contract: keyed statistical watermarks always listed as residual
    expect(result.residualNotAssessable.length).toBeGreaterThan(0);
  });
});
