// Unit tests for Nero — the adversarial self-challenge mode.
// Covers the rating-based critic selection (discipline -> global -> random, with
// author exclusion) and the pure prompt/verdict/confidence helpers. No paid
// engine dispatch needed.
import { describe, it, expect } from 'vitest';
import { rankEnginesByRating, pickTopRatedEngine, seedSuccessorRating, seedEnginesFromLineage } from '@agon/core';
import type { GlickoRating, RatingRecord } from '@agon/core';
import { buildNeroPrompt, parseNeroVerdict, parseNeroConfidence, runNero, rankNeroCritics } from '@agon/forge';

const rating = (mu: number, phi = 50): GlickoRating => ({
  mu,
  phi,
  sigma: 0.06,
  wins: 5,
  losses: 1,
  lastActive: new Date().toISOString(),
});

const ratings = (over: Partial<RatingRecord> = {}): RatingRecord => ({
  global: {},
  byMode: { forge: {}, brainstorm: {}, tribunal: {} },
  byTaskClass: {},
  engineMeta: {},
  lastUpdated: new Date().toISOString(),
  ...over,
});

describe('rankEnginesByRating', () => {
  it('ranks rated engines by confidence floor (mu - 2*phi), highest first', () => {
    const r = ratings({ global: { a: rating(1500), b: rating(1700), c: rating(1600) } });
    expect(rankEnginesByRating(['a', 'b', 'c'], r)).toEqual(['b', 'c', 'a']);
  });

  it('omits engines with no rating record so the caller can fall back', () => {
    const r = ratings({ global: { a: rating(1600) } });
    expect(rankEnginesByRating(['a', 'b', 'c'], r)).toEqual(['a']);
  });

  it('uses the discipline scope when mode is given (tribunal != global)', () => {
    const r = ratings({
      global: { a: rating(1900), b: rating(1500) },
      byMode: { forge: {}, brainstorm: {}, tribunal: { a: rating(1500), b: rating(1800) } },
    });
    // a is the best builder globally, but b is the best critic in tribunal
    expect(rankEnginesByRating(['a', 'b'], r, 'tribunal')).toEqual(['b', 'a']);
    expect(rankEnginesByRating(['a', 'b'], r)).toEqual(['a', 'b']);
  });

  it('breaks ties on mu, then engine id', () => {
    // same floor: higher phi means lower mu pairing — force equal floor, different mu
    const r = ratings({ global: { a: { ...rating(1600, 50) }, b: { ...rating(1600, 50) } } });
    expect(rankEnginesByRating(['b', 'a'], r)).toEqual(['a', 'b']);
  });
});

describe('pickTopRatedEngine', () => {
  it('picks the top discipline-rated engine for an adversarial role', () => {
    const r = ratings({
      global: { a: rating(1900) },
      byMode: { forge: {}, brainstorm: {}, tribunal: { a: rating(1500), b: rating(1800) } },
    });
    const pick = pickTopRatedEngine(['a', 'b'], r, { mode: 'tribunal' });
    expect(pick).toEqual({ engineId: 'b', reason: 'top-rated', scope: 'tribunal' });
  });

  it('falls back to the global rating when the discipline has no data', () => {
    const r = ratings({ global: { a: rating(1500), b: rating(1700) } });
    const pick = pickTopRatedEngine(['a', 'b'], r, { mode: 'tribunal' });
    expect(pick).toEqual({ engineId: 'b', reason: 'top-rated', scope: 'global' });
  });

  it('falls back to a random engine when NO engine has any rating yet', () => {
    const r = ratings();
    // injected rng -> deterministic: 0.6 * 3 = 1.8 -> index 1
    const pick = pickTopRatedEngine(['a', 'b', 'c'], r, { mode: 'tribunal', rng: () => 0.6 });
    expect(pick).toEqual({ engineId: 'b', reason: 'random', scope: null });
  });

  it('excludes the author so Nero never grades its own homework', () => {
    const r = ratings({ global: { author: rating(1900), critic: rating(1600) } });
    const pick = pickTopRatedEngine(['author', 'critic'], r, { exclude: ['author'] });
    expect(pick).toEqual({ engineId: 'critic', reason: 'top-rated', scope: 'global' });
  });

  it('ignores exclude when it would empty the pool', () => {
    const r = ratings({ global: { solo: rating(1600) } });
    const pick = pickTopRatedEngine(['solo'], r, { exclude: ['solo'] });
    expect(pick.engineId).toBe('solo');
  });

  it('returns reason=none for an empty pool', () => {
    expect(pickTopRatedEngine([], ratings())).toEqual({ engineId: '', reason: 'none', scope: null });
  });
});

describe('buildNeroPrompt', () => {
  it('embeds the decision, reasoning, confidence, focus and the three frameworks', () => {
    const p = buildNeroPrompt({
      decision: 'Cache tokens in Redis',
      reasoning: 'Redis is fast and shared',
      confidence: 80,
      focus: 'invalidation',
    });
    expect(p).toContain('Cache tokens in Redis');
    expect(p).toContain('Redis is fast and shared');
    expect(p).toContain("AUTHOR'S CONFIDENCE: 80%");
    expect(p).toContain('invalidation');
    expect(p).toContain('INVERSION');
    expect(p).toContain('PRE-MORTEM');
    expect(p).toContain('SECOND-ORDER');
    expect(p).toContain('VERDICT: FLAWED');
  });

  it('omits optional sections when not provided', () => {
    const p = buildNeroPrompt({ decision: 'Ship it' });
    expect(p).toContain('Ship it');
    expect(p).not.toContain('STATED REASONING');
    expect(p).not.toContain("AUTHOR'S CONFIDENCE");
    expect(p).not.toContain('FOCUS:');
  });
});

describe('parseNeroVerdict', () => {
  it('extracts each verdict', () => {
    expect(parseNeroVerdict('… VERDICT: FLAWED')).toBe('flawed');
    expect(parseNeroVerdict('VERDICT: PROCEED WITH CAUTION')).toBe('proceed-with-caution');
    expect(parseNeroVerdict('blah\nVERDICT: SOUND\n')).toBe('sound');
    expect(parseNeroVerdict('verdict: sound')).toBe('sound');
  });

  it('returns unknown when there is no verdict line', () => {
    expect(parseNeroVerdict('I have some concerns but no verdict.')).toBe('unknown');
  });

  it('takes the LAST verdict when the reasoning mentions one earlier', () => {
    // The prompt tells the critic to END with the verdict; a stray "VERDICT:" in
    // the analysis must not win over the final conclusion.
    const text = 'In legal terms a VERDICT: FLAWED would mean X.\n\n## Challenge 1\n…\n\nVERDICT: SOUND';
    expect(parseNeroVerdict(text)).toBe('sound');
  });
});

describe('parseNeroConfidence', () => {
  it('prefers an explicit Confidence marker', () => {
    expect(parseNeroConfidence('Confidence: 35%\n## Challenge 1 …')).toBe(35);
    expect(parseNeroConfidence('Confidence ~ 70 %')).toBe(70);
  });

  it('falls back to the first percentage', () => {
    expect(parseNeroConfidence('I am about 42% sure this holds.')).toBe(42);
  });

  it('returns null for out-of-range or missing values', () => {
    expect(parseNeroConfidence('no numbers here')).toBeNull();
    expect(parseNeroConfidence('999% certain')).toBeNull();
  });
});

describe('runNero — verdict-gate contract', () => {
  const registry = { get: (id: string) => ({ id }), list: () => [] } as any;
  const adapterReturning = (over: Record<string, unknown>) =>
    ({ dispatch: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, ...over }) }) as any;
  const base = { decision: 'x', engines: ['fake'], engine: 'fake', timeout: 30, outputDir: '/tmp/nero-test', cwd: '/tmp', retryBackoffMs: 0 };

  it('ok:true only on a clean exit WITH a parseable verdict', async () => {
    const res = await runNero({ ...base, registry, adapter: adapterReturning({ stdout: 'Confidence: 20%\n## Challenge 1\n…\nVERDICT: FLAWED' }) } as any);
    expect(res.ok).toBe(true);
    expect(res.verdict).toBe('flawed');
    expect(res.challengeConfidence).toBe(20);
    expect(res.reason).toBe('forced');
  });

  it('ok:false on timeout, even with partial output', async () => {
    const res = await runNero({ ...base, registry, adapter: adapterReturning({ stdout: 'partial…\nVERDICT: SOUND', timedOut: true }) } as any);
    expect(res.ok).toBe(false);
  });

  it('ok:false when the response carries no verdict line', async () => {
    const res = await runNero({ ...base, registry, adapter: adapterReturning({ stdout: 'I have concerns but never concluded' }) } as any);
    expect(res.ok).toBe(false);
    expect(res.challengeText).toContain('concerns');
  });

  it('ok:false with a stderr diagnostic on empty stdout', async () => {
    const res = await runNero({ ...base, registry, adapter: adapterReturning({ stdout: '', stderr: 'boom', exitCode: 1 }) } as any);
    expect(res.ok).toBe(false);
    expect(res.challengeText).toContain('boom');
  });

  it('ok:false (no crash) when the engine id is not in the registry', async () => {
    const throwingRegistry = { get: (id: string) => { throw new Error(`EngineNotFound: ${id}`); }, list: () => [] } as any;
    const res = await runNero({ ...base, registry: throwingRegistry, adapter: adapterReturning({ stdout: 'VERDICT: SOUND' }) } as any);
    expect(res.ok).toBe(false);
    expect(res.challengeText).toContain('EngineNotFound');
  });
});

describe('rankNeroCritics — critic cascade (down-pass order)', () => {
  it('ranks critics best→worst so a failed top critic can fall through', () => {
    const r = ratings({ global: { a: rating(1500), b: rating(1700), c: rating(1600) } });
    expect(rankNeroCritics(['a', 'b', 'c'], r).map((p) => p.engineId)).toEqual(['b', 'c', 'a']);
  });

  it('never reintroduces an excluded author, even when the pool-reset quirk fires', () => {
    // pickTopRatedEngine resets to the full list once exclude empties the pool;
    // the seen-guard must stop the cascade instead of re-surfacing the author.
    const r = ratings({ global: { author: rating(1900), a: rating(1600), b: rating(1500) } });
    const ranked = rankNeroCritics(['author', 'a', 'b'], r, { exclude: ['author'] }).map((p) => p.engineId);
    expect(ranked).toEqual(['a', 'b']);
    expect(ranked).not.toContain('author');
  });

  it('still enumerates every critic when nobody is rated yet (random tier)', () => {
    const ranked = rankNeroCritics(['a', 'b'], ratings()).map((p) => p.engineId);
    expect(ranked).toHaveLength(2);
    expect(new Set(ranked)).toEqual(new Set(['a', 'b']));
  });
});

describe('runNero — self-healing dispatch (resend + down-pass)', () => {
  const registry = { get: (id: string) => ({ id }), list: () => [] } as any;
  const VALID = 'Confidence: 50%\n## Challenge 1\n…\nVERDICT: SOUND';
  // Adapter scripted per engine id: each engine consumes its result list across
  // calls (clamping to the last entry), so we can simulate empty-then-valid etc.
  const scripted = (script: Record<string, Array<Record<string, unknown>>>) => {
    const calls: Record<string, number> = {};
    const adapter = {
      dispatch: async ({ engine }: any) => {
        const id = engine.id;
        const n = calls[id] ?? 0;
        calls[id] = n + 1;
        const seq = script[id] ?? [{}];
        const over = seq[Math.min(n, seq.length - 1)] ?? {};
        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, ...over };
      },
    } as any;
    return { adapter, calls };
  };
  const baseC = { decision: 'x', timeout: 30, outputDir: '/tmp/nero-test', cwd: '/tmp', retryBackoffMs: 0, registry };

  it('resends the SAME critic on a transient empty and accepts the retry', async () => {
    const { adapter, calls } = scripted({ a: [{ stdout: '' }, { stdout: VALID }] });
    const res = await runNero({ ...baseC, engines: ['a'], engine: 'a', adapter } as any);
    expect(res.ok).toBe(true);
    expect(res.engineId).toBe('a');
    expect(calls.a).toBe(2); // empty → resend → valid
  });

  it('down-passes to the next-best critic when the top one is unusable', async () => {
    const r = ratings({ global: { a: rating(1700), b: rating(1500) } });
    const { adapter, calls } = scripted({ a: [{ stdout: '' }], b: [{ stdout: VALID }] });
    const res = await runNero({ ...baseC, engines: ['a', 'b'], ratings: r, adapter } as any);
    expect(res.ok).toBe(true);
    expect(res.engineId).toBe('b');
    expect(calls.a).toBe(2);  // exhausted both attempts on the top critic
    expect(calls.b).toBe(1);  // then fell through to the next-best
  });

  it('reports no valid verdict when every critic fails (and lists what it tried)', async () => {
    const r = ratings({ global: { a: rating(1700), b: rating(1500) } });
    const { adapter, calls } = scripted({ a: [{ stdout: '' }], b: [{ stdout: '' }] });
    const res = await runNero({ ...baseC, engines: ['a', 'b'], ratings: r, adapter } as any);
    expect(res.ok).toBe(false);
    expect(res.challengeText).toContain('No critic produced a valid verdict');
    expect(calls.a).toBe(2); // empty is transient → both attempts
    expect(calls.b).toBe(2);
  });

  it('does NOT resend a verdict-less reply (deterministic miss) — down-passes after one dispatch', async () => {
    const r = ratings({ global: { a: rating(1700), b: rating(1500) } });
    // a returns a non-empty answer with no VERDICT line: a format mismatch, not a
    // transient blip, so a resend would waste a paid dispatch. Down-pass straight to b.
    const { adapter, calls } = scripted({ a: [{ stdout: 'lots of analysis but never concludes' }], b: [{ stdout: VALID }] });
    const res = await runNero({ ...baseC, engines: ['a', 'b'], ratings: r, adapter } as any);
    expect(res.ok).toBe(true);
    expect(res.engineId).toBe('b');
    expect(calls.a).toBe(1); // no wasted resend on the deterministic miss
    expect(calls.b).toBe(1);
  });

  it('never lets an excluded author self-grade, even as the only candidate', async () => {
    const { adapter, calls } = scripted({ author: [{ stdout: VALID }] });
    const res = await runNero({ ...baseC, engines: ['author'], exclude: ['author'], adapter } as any);
    expect(res.ok).toBe(false);
    expect(res.engineId).not.toBe('author'); // contract: no grading own homework
    expect(res.engineId).toBe('');
    expect(calls.author).toBeUndefined(); // never dispatched
  });

  it('returns an aborted result immediately when dispatch rejects with AbortError', async () => {
    const ac = new AbortController();
    const adapter = {
      dispatch: async () => {
        ac.abort();
        const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e;
      },
    } as any;
    const res = await runNero({ ...baseC, engines: ['a'], engine: 'a', adapter, signal: ac.signal } as any);
    expect(res.ok).toBe(false);
    expect(res.challengeText).toContain('aborted');
  });

  it('a forced engine retries but NEVER down-passes (manual override)', async () => {
    const { adapter, calls } = scripted({ a: [{ stdout: '' }], b: [{ stdout: VALID }] });
    const res = await runNero({ ...baseC, engines: ['a', 'b'], engine: 'a', adapter } as any);
    expect(res.ok).toBe(false);
    expect(res.engineId).toBe('a');
    expect(calls.a).toBe(2);
    expect(calls.b).toBeUndefined(); // b is a candidate but the override pinned 'a'
  });

  it('emits onStatus narration for the retry and the down-pass', async () => {
    const r = ratings({ global: { a: rating(1700), b: rating(1500) } });
    const { adapter } = scripted({ a: [{ stdout: '' }], b: [{ stdout: VALID }] });
    const msgs: string[] = [];
    await runNero({ ...baseC, engines: ['a', 'b'], ratings: r, adapter, onStatus: (m: string) => msgs.push(m) } as any);
    expect(msgs.some((m) => /retrying \(2\/2\)/.test(m))).toBe(true);
    expect(msgs.some((m) => /down-passing to b/.test(m))).toBe(true);
  });
});

describe('pickTopRatedEngine — critique→tribunal→global cascade (Nero selection)', () => {
  it('prefers the critique discipline when it has data', () => {
    const r = ratings({
      global: { a: rating(1900), b: rating(1500) },
      byMode: { forge: {}, brainstorm: {}, tribunal: { a: rating(1800), b: rating(1500) }, critique: { a: rating(1500), b: rating(1700) } },
    });
    // a leads global AND tribunal, but b is the proven critic → b wins via critique
    expect(pickTopRatedEngine(['a', 'b'], r, { modes: ['critique', 'tribunal'] })).toEqual({ engineId: 'b', reason: 'top-rated', scope: 'critique' });
  });

  it('falls back to tribunal when critique is empty', () => {
    const r = ratings({
      global: { a: rating(1900), b: rating(1500) },
      byMode: { forge: {}, brainstorm: {}, tribunal: { a: rating(1500), b: rating(1800) }, critique: {} },
    });
    expect(pickTopRatedEngine(['a', 'b'], r, { modes: ['critique', 'tribunal'] })).toEqual({ engineId: 'b', reason: 'top-rated', scope: 'tribunal' });
  });

  it('falls back to global when neither critique nor tribunal has data', () => {
    const r = ratings({ global: { a: rating(1500), b: rating(1700) } });
    expect(pickTopRatedEngine(['a', 'b'], r, { modes: ['critique', 'tribunal'] })).toEqual({ engineId: 'b', reason: 'top-rated', scope: 'global' });
  });

  it('still excludes the author across the cascade', () => {
    const r = ratings({ byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: { author: rating(1900), critic: rating(1600) } } });
    expect(pickTopRatedEngine(['author', 'critic'], r, { modes: ['critique', 'tribunal'], exclude: ['author'] })).toEqual({ engineId: 'critic', reason: 'top-rated', scope: 'critique' });
  });
});

describe('seedSuccessorRating — new-model cold-start', () => {
  const withGames = (over: Partial<GlickoRating>): GlickoRating => ({ ...rating(1500), wins: 10, losses: 5, ...over });

  it('inherits a strong predecessor mu and inflates phi (capped at 350)', () => {
    const seed = seedSuccessorRating(withGames({ mu: 1700, phi: 60 }));
    expect(seed).not.toBeNull();
    expect(seed!.mu).toBe(1700);
    expect(seed!.phi).toBe(90); // 60 * 1.5
    expect(seed!.wins).toBe(0);
    expect(seed!.losses).toBe(0);
  });

  it('caps inflated phi at DEFAULT_PHI (350)', () => {
    const seed = seedSuccessorRating(withGames({ mu: 1700, phi: 300 }));
    expect(seed!.phi).toBe(350); // min(300*1.5=450, 350)
  });

  it('low-side clamp: a below-average predecessor (mu<1500) is inherited fully, NO phi inflation', () => {
    const seed = seedSuccessorRating(withGames({ mu: 1300, phi: 80 }));
    expect(seed!.mu).toBe(1300);
    expect(seed!.phi).toBe(80); // unchanged — can't escape a bad rating by version-bumping
  });

  it('returns null when the predecessor is too green to inherit from', () => {
    expect(seedSuccessorRating({ ...rating(1800), wins: 1, losses: 1 })).toBeNull(); // 2 games < MIN_INHERIT_GAMES
  });
});

describe('seedEnginesFromLineage', () => {
  const withGames = (mu: number): GlickoRating => ({ ...rating(mu), wins: 10, losses: 3 });

  it('seeds a new engine from its rated predecessor and records provenance', () => {
    const r = ratings({ global: { 'opus-4.7': withGames(1750) } });
    const seeded = seedEnginesFromLineage(r, { 'opus-4.8': 'opus-4.7' });
    expect(seeded).toEqual(['opus-4.8']);
    expect(r.global['opus-4.8'].mu).toBe(1750);
    expect(r.engineMeta['opus-4.8'].derivedFrom).toBe('opus-4.7');
    expect(r.engineMeta['opus-4.7'].versions).toContain('opus-4.8');
  });

  it('skips engines that already have a rating, or whose predecessor is unrated', () => {
    const r = ratings({ global: { 'opus-4.7': withGames(1750), 'opus-4.8': rating(1500) } });
    expect(seedEnginesFromLineage(r, { 'opus-4.8': 'opus-4.7', 'kimi-3': 'kimi-2-missing' })).toEqual([]);
  });
});
