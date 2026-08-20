import { describe, expect, it } from 'vitest';

import {
  runNaturalize,
  buildNaturalizePrompt,
  wordDiffStats,
  type NaturalizeOptions,
} from '../../packages/forge/src/naturalize.js';

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

describe('naturalize — min-change threshold', () => {
  it('accepts immediately when the rewrite meets the threshold', async () => {
    const result = await runNaturalize(makeOpts({ minChange: 0.3 }));
    expect(result.ok).toBe(true);
    expect(result.minChangeMet).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('refuses to emit when the rewrite stays too close to the original', async () => {
    const opts = makeOpts({
      input: 'alpha beta gamma delta epsilon zeta eta theta',
      minChange: 0.9,
      maxAttempts: 2,
    });
    let calls = 0;
    opts.adapter = {
      dispatch: async () => {
        calls += 1;
        // near-identical "rewrite" — 12.5% change, always below 90%
        return { exitCode: 0, timedOut: false, stdout: 'alpha beta gamma delta epsilon zeta eta OMEGA', stderr: '' };
      },
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(calls).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.minChangeMet).toBe(false);
    expect(result.output).toBe('');
    expect(result.error).toContain('refusing to emit');
    expect(result.error).toContain('statistical watermark could persist');
  });

  it('retries with a stronger brief after a weak first attempt, then succeeds', async () => {
    const opts = makeOpts({
      input: 'alpha beta gamma delta',
      minChange: 0.5,
      maxAttempts: 2,
    });
    const prompts: string[] = [];
    opts.adapter = {
      dispatch: async (req: { prompt: string }) => {
        prompts.push(req.prompt);
        const weak = prompts.length === 1;
        return {
          exitCode: 0,
          timedOut: false,
          stdout: weak ? 'alpha beta gamma CHANGED' : 'completely different words entirely',
          stderr: '',
        };
      },
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.minChangeMet).toBe(true);
    // the retry brief carries the stronger re-lexicalization instruction
    expect(prompts[1]).toContain('kept too much of the original wording');
    expect(prompts[0]).not.toContain('kept too much of the original wording');
  });

  it('minChangeMet is undefined when no threshold is set', async () => {
    const result = await runNaturalize(makeOpts());
    expect(result.minChangeMet).toBeUndefined();
    expect(result.attempts).toBe(1);
  });

  it('dispatch failure without min-change does NOT silently retry (attempts=1, single spend)', async () => {
    const opts = makeOpts(); // no minChange
    let calls = 0;
    opts.adapter = {
      dispatch: async () => {
        calls += 1;
        return { exitCode: 1, timedOut: false, stdout: '', stderr: 'engine down' };
      },
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('engine down');
  });

  it('engine failures across all attempts surface the last error', async () => {
    const opts = makeOpts({ minChange: 0.5, maxAttempts: 3 });
    let calls = 0;
    opts.adapter = {
      dispatch: async () => {
        calls += 1;
        return { exitCode: 1, timedOut: false, stdout: '', stderr: 'engine down' };
      },
    } as unknown as NaturalizeOptions['adapter'];
    const result = await runNaturalize(opts);
    expect(calls).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('engine down');
  });
});
