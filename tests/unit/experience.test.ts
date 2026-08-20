import { describe, expect, it } from 'vitest';
import {
  buildExperienceBlock,
  episodesFromRunRecords,
  experienceRetrievalOptions,
  retrieveExperience,
  scoreExperienceSimilarity,
  summarizeIntentForEpisode,
  tokenizeExperienceText,
  type ExperienceEpisode,
} from '../../packages/cli/src/cesar/experience.js';

const episode = (overrides: Partial<ExperienceEpisode> = {}): ExperienceEpisode => ({
  mode: 'forge',
  taskType: 'bugfix',
  intentSummary: 'fix the CSV parser crash on quoted fields',
  winner: 'codex',
  success: true,
  durationMs: 240_000,
  timestamp: 1000,
  projectKey: '/repo/a',
  ...overrides,
});

describe('summarizeIntentForEpisode', () => {
  it('collapses whitespace and caps at 160 chars', () => {
    expect(summarizeIntentForEpisode('  fix   the\n\nparser  ')).toBe('fix the parser');
    const long = 'x'.repeat(400);
    const out = summarizeIntentForEpisode(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty for trivial intents so they never become episodes', () => {
    expect(summarizeIntentForEpisode('')).toBe('');
    expect(summarizeIntentForEpisode('fix')).toBe('');
    expect(summarizeIntentForEpisode(undefined as unknown as string)).toBe('');
  });

  it('strips control characters', () => {
    expect(summarizeIntentForEpisode('fix\u0000the\u001bparser thing')).toBe('fix the parser thing');
  });
});

describe('tokenize + similarity', () => {
  it('drops stopwords and short tokens', () => {
    const t = tokenizeExperienceText('Add the new CSV parser for the app');
    expect(t.has('csv')).toBe(true);
    expect(t.has('parser')).toBe(true);
    expect(t.has('the')).toBe(false);
    expect(t.has('add')).toBe(false);
  });

  it('scores related prompts above unrelated ones', () => {
    const related = scoreExperienceSimilarity('fix the CSV parser crash', 'CSV parser crash on quoted fields');
    const unrelated = scoreExperienceSimilarity('fix the CSV parser crash', 'design a login page in React');
    expect(related).toBeGreaterThan(unrelated);
    expect(related).toBeGreaterThan(0.2);
    expect(unrelated).toBeLessThan(0.1);
  });

  it('empty inputs score zero', () => {
    expect(scoreExperienceSimilarity('', 'anything')).toBe(0);
  });
});

describe('experienceRetrievalOptions', () => {
  it('resolves defaults, treating 0 as unset (DEFAULT_AGON_CONFIG emits optional numbers as 0)', () => {
    const opts = experienceRetrievalOptions({ cesarExperienceMinSimilarity: 0, cesarExperienceMinEpisodes: 0, cesarExperienceTopK: 0, cesarExperienceWindow: 0 });
    expect(opts.minSimilarity).toBe(0.2);
    expect(opts.minEpisodes).toBe(3);
    expect(opts.topK).toBe(3);
    expect(opts.window).toBe(200);
  });

  it('honors explicit overrides and caps similarity at 1', () => {
    const opts = experienceRetrievalOptions({ cesarExperienceMinSimilarity: 5, cesarExperienceMinEpisodes: 2, cesarExperienceTopK: 1, cesarExperienceWindow: 10 });
    expect(opts.minSimilarity).toBe(1);
    expect(opts.minEpisodes).toBe(2);
    expect(opts.topK).toBe(1);
    expect(opts.window).toBe(10);
  });
});

describe('episodesFromRunRecords', () => {
  it('keeps only records that stored an intentSummary', () => {
    const eps = episodesFromRunRecords([
      { mode: 'forge', taskType: 'bugfix', intentSummary: 'fix the parser', winner: 'codex', success: true, durationMs: 100, timestamp: 5 },
      { mode: 'review', taskType: 'other' }, // pre-field legacy record
      null,
    ]);
    expect(eps).toHaveLength(1);
    expect(eps[0].mode).toBe('forge');
  });

  it('scopes to the requesting project — other repos never leak, unscoped legacy records fail closed', () => {
    const records = [
      { mode: 'forge', intentSummary: 'fix the parser here', projectKey: '/repo/a', timestamp: 1 },
      { mode: 'forge', intentSummary: 'fix the parser elsewhere', projectKey: '/repo/b', timestamp: 2 },
      { mode: 'forge', intentSummary: 'fix the parser nowhere', timestamp: 3 }, // no projectKey
    ];
    const scoped = episodesFromRunRecords(records, '/repo/a');
    expect(scoped).toHaveLength(1);
    expect(scoped[0].intentSummary).toBe('fix the parser here');
    // Unscoped query keeps everything (callers opt in to scoping).
    expect(episodesFromRunRecords(records)).toHaveLength(3);
  });
});

describe('retrieveExperience — the min-N evidence gate', () => {
  const opts = { minSimilarity: 0.2, minEpisodes: 3, topK: 2, window: 200 };
  const prompt = 'fix the CSV parser crash on quoted fields';

  it('returns nothing below the min-N support threshold, even with strong matches', () => {
    const eps = [episode(), episode({ timestamp: 2000 })];
    expect(retrieveExperience(prompt, eps, opts)).toHaveLength(0);
  });

  it('returns top-K when enough episodes clear the similarity gate, newest first on ties', () => {
    const eps = [
      episode({ timestamp: 1 }),
      episode({ timestamp: 2 }),
      episode({ timestamp: 3 }),
      episode({ intentSummary: 'design a login page in React', timestamp: 4 }),
    ];
    const matches = retrieveExperience(prompt, eps, opts);
    expect(matches).toHaveLength(2);
    expect(matches[0].episode.timestamp).toBe(3);
    expect(matches.every((m) => m.similarity >= 0.2)).toBe(true);
  });

  it('unrelated episodes never surface', () => {
    const eps = [1, 2, 3, 4].map((i) => episode({ intentSummary: 'design a login page in React', timestamp: i }));
    expect(retrieveExperience(prompt, eps, opts)).toHaveLength(0);
  });
});

describe('buildExperienceBlock', () => {
  it('renders advisory framing with mode, winner, outcome', () => {
    const block = buildExperienceBlock([{ episode: episode(), similarity: 0.42 }]);
    expect(block).toContain('[EXPERIENCE]');
    expect(block).toContain('evidence, not authority');
    expect(block).toContain('mode=forge');
    expect(block).toContain('codex');
    expect(block).toContain('succeeded');
    expect(block).toContain('own merits');
  });

  it('returns null for no matches', () => {
    expect(buildExperienceBlock([])).toBeNull();
  });
});
