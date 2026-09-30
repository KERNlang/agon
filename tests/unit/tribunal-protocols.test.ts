import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineRegistry } from '@kernlang/agon-core';
import type { DispatchOptions, DispatchResult, EngineAdapter, EngineDefinition } from '../../packages/core/src/models/types.js';
import { runTribunal } from '@kernlang/agon-forge';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

function makeEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: true,
    tier: 'user',
    binary: 'sh',
    timeout: 30,
    exec: { args: [] },
    review: { args: [] },
  } as EngineDefinition;
}

const JUDGE_KEY_ENV = 'AGON_TEST_TRIBUNAL_API_KEY';

function makeApiEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: false,
    tier: 'user',
    timeout: 30,
    exec: { args: [] },
    review: { args: [] },
    api: { baseUrl: 'https://api.example.test/v1', apiKeyEnv: JUDGE_KEY_ENV, model: `${id}-model` },
  } as EngineDefinition;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('tribunal execution protocols', () => {
  let agonHome: string | undefined;
  let outputDir: string | undefined;

  afterEach(() => {
    cleanupTestAgonHome(agonHome);
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    agonHome = undefined;
    outputDir = undefined;
  });

  async function run(protocol: 'parallel' | 'chained' | 'hybrid', rounds: number) {
    agonHome = setupTestAgonHome(`tribunal-protocol-${protocol}`);
    outputDir = join(tmpdir(), `agon-tribunal-protocol-${protocol}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });

    const registry = new EngineRegistry();
    const engineIds = ['alpha', 'beta', 'gamma'];
    for (const id of engineIds) registry.register(makeEngine(id));

    const prompts: Array<{ engineId: string; round: number; prompt: string }> = [];
    const activeByRound = new Map<number, number>();
    const maxActiveByRound = new Map<number, number>();
    const controller = new AbortController();
    let summarySignal: AbortSignal | undefined;

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.systemPrompt?.includes('synthesizing a debate')) {
          summarySignal = options.signal;
          return { exitCode: 0, stdout: 'summary', stderr: '', durationMs: 1, timedOut: false };
        }
        if (options.systemPrompt?.includes('impartial judge')) {
          return { exitCode: 0, stdout: 'no ranking', stderr: '', durationMs: 1, timedOut: false };
        }

        const round = Number(options.prompt.match(/## ROUND\n(\d+) of/)?.[1] ?? 0);
        prompts.push({ engineId: options.engine.id, round, prompt: options.prompt });
        const active = (activeByRound.get(round) ?? 0) + 1;
        activeByRound.set(round, active);
        maxActiveByRound.set(round, Math.max(maxActiveByRound.get(round) ?? 0, active));
        await sleep(20);
        activeByRound.set(round, active - 1);
        return {
          exitCode: 0,
          stdout: `argument-${options.engine.id}-round-${round}`,
          stderr: '',
          durationMs: 20,
          timedOut: false,
        };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    const result = await runTribunal({
      question: 'How should the protocol execute?',
      engines: engineIds,
      rounds,
      mode: 'adversarial',
      protocol,
      registry,
      adapter,
      timeout: 5,
      outputDir,
      signal: controller.signal,
    });

    return { result, prompts, maxActiveByRound, summarySignal, signal: controller.signal };
  }

  it('parallel starts every seat together without current-round context', async () => {
    const { result, prompts, maxActiveByRound, summarySignal, signal } = await run('parallel', 1);

    expect(result.protocol).toBe('parallel');
    expect(maxActiveByRound.get(1)).toBe(3);
    expect(prompts).toHaveLength(3);
    expect(prompts.every((entry) => !entry.prompt.includes('EARLIER ARGUMENTS THIS ROUND'))).toBe(true);
    expect(summarySignal).toBe(signal);
  });

  it('chained dispatches one seat at a time and passes earlier arguments forward', async () => {
    const { result, prompts, maxActiveByRound } = await run('chained', 1);

    expect(result.protocol).toBe('chained');
    expect(maxActiveByRound.get(1)).toBe(1);
    expect(prompts[0].prompt).not.toContain('EARLIER ARGUMENTS THIS ROUND');
    expect(prompts[1].prompt).toContain('argument-alpha-round-1');
    expect(prompts[2].prompt).toContain('argument-alpha-round-1');
    expect(prompts[2].prompt).toContain('argument-beta-round-1');
  });

  it('hybrid runs round one in parallel and chains later rounds', async () => {
    const { result, prompts, maxActiveByRound } = await run('hybrid', 2);

    expect(result.protocol).toBe('hybrid');
    expect(maxActiveByRound.get(1)).toBe(3);
    expect(maxActiveByRound.get(2)).toBe(1);

    const betaRoundOne = prompts.find((entry) => entry.engineId === 'beta' && entry.round === 1);
    const betaRoundTwo = prompts.find((entry) => entry.engineId === 'beta' && entry.round === 2);
    expect(betaRoundOne?.prompt).not.toContain('EARLIER ARGUMENTS THIS ROUND');
    expect(betaRoundTwo?.prompt).toContain('PREVIOUS ARGUMENTS');
    expect(betaRoundTwo?.prompt).toContain('argument-alpha-round-2');
  });
});

type JudgeReply = DispatchResult | 'hang';

interface JudgedRun {
  seats: Record<string, string | null>;
  others?: Array<Partial<EngineDefinition> & { id: string }>;
  config?: Record<string, unknown>;
  judge?: (judgeId: string, shown: Record<string, string>, options: DispatchOptions) => JudgeReply | Promise<JudgeReply>;
  seed?: string;
  rng?: () => number;
  signal?: AbortSignal;
  settleMs?: number;
  judgePool?: string[];
  defs?: Record<string, Partial<EngineDefinition>>;
}

const reply = (stdout: string, exitCode = 0): DispatchResult => ({ exitCode, stdout, stderr: exitCode ? 'judge failed' : '', durationMs: 1, timedOut: false });

const shownIn = (prompt: string): Record<string, string> => {
  const shown: Record<string, string> = {};
  for (const m of prompt.matchAll(/---BEGIN POSITION (P\d+) \(assigned role: [^\n]*\) [0-9a-f]+---\n(\S+)/g)) shown[m[1]] = m[2];
  return shown;
};

const rankBy = (order: string[]) => (_judge: string, shown: Record<string, string>) => {
  const labelOf = Object.fromEntries(Object.entries(shown).map(([label, marker]) => [marker, label]));
  return reply(`Reasoning.\nRANK: ${order.filter((m) => labelOf[m]).map((m) => labelOf[m]).join(' > ')}`);
};

describe('tribunal judged ratings', () => {
  let agonHome: string | undefined;
  let outputDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    cleanupTestAgonHome(agonHome);
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    agonHome = undefined;
    outputDir = undefined;
  });

  async function runJudged(setup: JudgedRun) {
    agonHome = setupTestAgonHome('tribunal-judged');
    outputDir = join(tmpdir(), `agon-tribunal-judged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(agonHome, 'config.json'), JSON.stringify({ ratingJudging: 'on', ...setup.config }));
    if (setup.seed !== undefined) writeFileSync(join(agonHome, 'ratings.json'), setup.seed);

    vi.stubEnv(JUDGE_KEY_ENV, 'test-key');
    const registry = new EngineRegistry();
    const engineIds = Object.keys(setup.seats);
    for (const id of engineIds) registry.register({ ...makeApiEngine(id), ...setup.defs?.[id] } as EngineDefinition);
    for (const other of setup.others ?? []) registry.register({ ...makeApiEngine(other.id), ...other } as EngineDefinition);

    const judgeCalls: string[] = [];
    const judgeOutputDirs: string[] = [];
    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.systemPrompt?.includes('synthesizing a debate')) return reply('summary');
        if (options.systemPrompt?.includes('impartial judge')) {
          judgeCalls.push(options.engine.id);
          judgeOutputDirs.push(options.outputDir);
          const answer = await (setup.judge ?? (() => reply('prose only')))(options.engine.id, shownIn(options.prompt), options);
          return answer === 'hang' ? new Promise<DispatchResult>(() => {}) : answer;
        }
        const out = setup.seats[options.engine.id];
        if (out === null) return reply('', 1);
        return { ...reply(out), identity: `model-${options.engine.id}` } as DispatchResult;
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    const result = await runTribunal({
      question: 'Should we ship the release?', engines: engineIds, rounds: 1, mode: 'adversarial', protocol: 'parallel',
      registry, adapter, timeout: 5, outputDir, signal: setup.signal, rng: setup.rng, judgePool: setup.judgePool,
    } as Parameters<typeof runTribunal>[0]);

    if (setup.settleMs) await sleep(setup.settleMs);
    const ratingsFile = join(agonHome, 'ratings.json');
    const ballotsFile = join(outputDir, 'ballots.json');
    return {
      result,
      judgeCalls,
      judgeOutputDirs,
      ratingsText: existsSync(ratingsFile) ? readFileSync(ratingsFile, 'utf-8') : null,
      ratings: existsSync(ratingsFile) ? JSON.parse(readFileSync(ratingsFile, 'utf-8')) : null,
      ballots: existsSync(ballotsFile) ? JSON.parse(readFileSync(ballotsFile, 'utf-8')) : null,
    };
  }

  const record = (mode: string, ratings: any, id: string) => {
    const r = ratings?.byMode?.[mode]?.[id];
    return r ? `${r.wins}-${r.losses}` : 'none';
  };

  const SEED = JSON.stringify({ global: { zeta: { mu: 1600, phi: 80, sigma: 0.06, wins: 3, losses: 1, lastActive: '2026-09-01T00:00:00.000Z' } }, byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} }, byTaskClass: {}, engineMeta: {}, lastUpdated: '2026-09-01T00:00:00.000Z' }, null, 2) + '\n';

  it('a failed seat is on no ballot, casts none and stays unrated; responders are ranked by the judges', async () => {
    const run = await runJudged({ seats: { alpha: 'MA argues well', beta: 'MB argues', gamma: null, delta: 'MD argues' }, judge: rankBy(['MA', 'MB', 'MD']) });
    expect(run.judgeCalls.sort()).toEqual(['alpha', 'beta', 'delta']);
    expect(run.ballots.ballots.flatMap((b: any) => Object.values(b.labelMap))).not.toContain('gamma');
    for (const mode of ['tribunal', 'critique']) {
      expect([record(mode, run.ratings, 'alpha'), record(mode, run.ratings, 'beta'), record(mode, run.ratings, 'delta')]).toEqual(['2-0', '1-1', '0-2']);
      expect(run.ratings.byMode[mode].gamma).toBeUndefined();
    }
    expect(run.ratings.global.gamma).toBeUndefined();
    expect(run.ratings.engineMeta.alpha.identity).toBe('model-alpha');
  });

  it('notes the dispatch identities once per run: a changed model is pending after one run, not confirmed', async () => {
    const seed = JSON.stringify({ global: {}, byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} }, byTaskClass: {}, engineMeta: { alpha: { firstSeen: '', lastActive: '', matchCount: 3, derivedFrom: null, versions: [], identity: 'model-old' } }, lastUpdated: '' });
    const run = await runJudged({ seats: { alpha: 'MA argues', beta: 'MB argues', gamma: 'MC argues' }, seed, judge: rankBy(['MA', 'MB', 'MC']) });
    expect(run.ratings.engineMeta.alpha).toMatchObject({ identity: 'model-old', pendingIdentity: 'model-alpha', pendingCount: 1, versions: [] });
  });

  it('writes no rating at all when only one seat responded', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: null, gamma: null }, judge: rankBy(['MA']) });
    expect(run.ratings?.global ?? {}).toEqual({});
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
  });

  it('AC-3 a 6000-char position ranked last on every ballot loses to an 800-char position ranked first', async () => {
    const run = await runJudged({
      seats: { alpha: `MLONG ${'L'.repeat(6000)}`, beta: `MSHORT ${'S'.repeat(800)}`, gamma: `MMID ${'M'.repeat(300)}` },
      judge: rankBy(['MSHORT', 'MMID', 'MLONG']),
    });
    for (const mode of ['tribunal', 'critique']) {
      expect([record(mode, run.ratings, 'alpha'), record(mode, run.ratings, 'beta'), record(mode, run.ratings, 'gamma')]).toEqual(['0-2', '2-0', '1-1']);
    }
    expect(run.ratings.byMode.tribunal.beta.mu).toBeGreaterThan(run.ratings.byMode.tribunal.alpha.mu);
  });

  it('AC-3 identical judged means skip the pair whatever the lengths (2500 vs 150 chars)', async () => {
    const shown = (judge: string) => ({ alpha: ['MB', 'MC'], beta: ['MA', 'MC'], gamma: ['MA', 'MB'] })[judge]!;
    const run = await runJudged({
      seats: { alpha: `MA ${'A'.repeat(2500)}`, beta: `MB ${'B'.repeat(150)}`, gamma: 'MC short' },
      judge: (judge, labels) => {
        const labelOf = Object.fromEntries(Object.entries(labels).map(([l, m]) => [m, l]));
        const [x, y] = shown(judge).map((m) => labelOf[m]);
        return reply(judge === 'gamma' ? `RANK: ${x} = ${y}` : `RANK: ${x} > ${y}`);
      },
    });
    expect([record('tribunal', run.ratings, 'alpha'), record('tribunal', run.ratings, 'beta'), record('tribunal', run.ratings, 'gamma')]).toEqual(['1-0', '1-0', '0-2']);
  });

  it('AC-4 two positions: the judge is a non-participant even when cesarEngine argued, and it ranks both', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }], config: { cesarEngine: 'alpha' }, judgePool: ['alpha', 'beta', 'delta'],
      judge: rankBy(['MB', 'MA']), rng: () => 0.5,
    });
    expect(run.judgeCalls).toEqual(['delta']);
    expect(run.ballots.ballots[0]).toMatchObject({ judge: 'delta', valid: true });
    expect([record('tribunal', run.ratings, 'beta'), record('tribunal', run.ratings, 'alpha')]).toEqual(['1-0', '0-1']);
    expect(run.ratings.byMode.tribunal.delta).toBeUndefined();
  });

  it('AC-4 draws the judge uniformly from the eligible non-participants with the injected rng', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }, { id: 'epsilon' }], judgePool: ['alpha', 'beta', 'delta', 'epsilon'], judge: rankBy(['MA', 'MB']), rng: () => 0.6 });
    expect(run.judgeCalls).toEqual(['epsilon']);
  });

  it('AC-4 hidden or removed engines are not judges: no judge, no write, ratings.json byte-identical', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'hid' }, { id: 'gone' }], judgePool: ['alpha', 'beta', 'hid', 'gone'],
      config: { hiddenEngines: ['hid'], removedEngines: ['gone'] }, seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0,
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-impartial-judge', summary: { dispatched: 0 } });
  });

  it('AC-4 a non-participant sharing a derivedFrom lineage with a participant is not eligible', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'alpha2', derivedFrom: 'alpha' }], judgePool: ['alpha', 'beta', 'alpha2'], seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0,
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
  });

  it('AC-4 a failing judge writes nothing: ratings.json byte-identical', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }], judgePool: ['alpha', 'beta', 'delta'], seed: SEED, judge: () => reply('', 2), rng: () => 0 });
    expect(run.judgeCalls).toEqual(['delta']);
    expect(run.ratingsText).toBe(SEED);
  });

  it('B2 an explicit selection of two engines sends the debate to no other engine: no judge, no write, note no-impartial-judge', async () => {
    const run = await runJudged({ seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }], seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0 });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-impartial-judge', summary: { dispatched: 0 } });
  });

  it('B2 the impartial judge comes from the run roster, never from an active engine outside it', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, others: [{ id: 'delta' }, { id: 'outsider' }], judgePool: ['alpha', 'beta', 'delta'],
      judge: rankBy(['MA', 'MB']), rng: () => 0.99,
    });
    expect(run.judgeCalls).toEqual(['delta']);
  });

  it('B1 a participant with a CLI binary casts no peer ballot but is still ranked by the text-only judges', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA argues', beta: 'MB argues', gamma: 'MC argues' }, defs: { gamma: { binary: 'sh' } },
      judge: rankBy(['MA', 'MB', 'MC']),
    });
    expect(run.judgeCalls.sort()).toEqual(['alpha', 'beta']);
    expect(run.ballots.ineligibleJudges).toEqual({ gamma: 'not-text-only' });
    expect(run.ballots.ballots.flatMap((b: any) => Object.values(b.labelMap))).toContain('gamma');
    expect(record('tribunal', run.ratings, 'gamma')).toBe('0-2');
  });

  it('B1 a write-capable or CLI engine is never the impartial judge; with none left nothing is rated and ballots.json says why', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB' }, judgePool: ['alpha', 'beta', 'yolo', 'cli'], seed: SEED, judge: rankBy(['MA', 'MB']), rng: () => 0,
      others: [{ id: 'yolo', exec: { args: ['--yolo', '{prompt}'] } }, { id: 'cli', binary: 'sh' }],
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-text-only-judge', summary: { dispatched: 0 }, ineligibleJudges: { yolo: 'write-capable', cli: 'not-text-only' } });
  });

  it('B1 when no responding participant can judge text-only, no ballot is dispatched, nothing is rated and ballots.json carries the note', async () => {
    const run = await runJudged({
      seats: { alpha: 'MA', beta: 'MB', gamma: 'MC' }, defs: { alpha: { binary: 'sh' }, beta: { binary: 'sh' }, gamma: { binary: 'sh' } },
      seed: SEED, judge: rankBy(['MA', 'MB', 'MC']),
    });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ratingsText).toBe(SEED);
    expect(run.ballots).toMatchObject({ note: 'no-text-only-judge', summary: { dispatched: 0 } });
  });

  it('ratingBallotMaxChars caps the position characters each judge is sent and ballots.json records which labels were cut', async () => {
    const seen: string[] = [];
    const run = await runJudged({
      seats: { alpha: `MA ${'a'.repeat(900)}`, beta: `MB ${'b'.repeat(900)}`, gamma: 'MC short' }, config: { ratingBallotMaxChars: 400 },
      judge: (judge, shown, options) => { seen.push(options.prompt); return rankBy(['MA', 'MB', 'MC'])(judge, shown); },
    });
    expect(run.ballots.ballots.find((b: any) => b.judge === 'gamma').truncated.sort()).toEqual(['P1', 'P2']);
    expect(run.ballots.ballots.find((b: any) => b.judge === 'alpha').truncated).toHaveLength(1);
    for (const prompt of seen) expect(prompt.length).toBeLessThan(2000);
    expect(run.ballots.positionChars.alpha).toBe(903);
  });

  it('an invalid ratingBallotMaxChars falls back to the default cap, which leaves ordinary positions whole', async () => {
    const run = await runJudged({
      seats: { alpha: `MA ${'a'.repeat(900)}`, beta: `MB ${'b'.repeat(900)}`, gamma: 'MC short' }, config: { ratingBallotMaxChars: -5 },
      judge: rankBy(['MA', 'MB', 'MC']),
    });
    expect(run.ballots.ballots.map((b: any) => b.truncated)).toEqual([[], [], []]);
  });

  const threeSeats = { alpha: `MA ${'a'.repeat(300)}`, beta: `MB ${'b'.repeat(200)}`, gamma: `MC ${'c'.repeat(100)}` };
  const unchangedOutput = (result: any) => {
    expect(result.summary).toBe('summary');
    expect(result.positions.map((p: any) => p.arguments)).toEqual([[threeSeats.alpha], [threeSeats.beta], [threeSeats.gamma]]);
    expect(result.panelHealth).toMatchObject({ degraded: false, notes: [] });
  };

  it('AC-6 judges exiting non-zero leave the output unchanged and write no rating', async () => {
    const run = await runJudged({ seats: threeSeats, judge: () => reply('RANK: P1 > P2', 1) });
    unchangedOutput(run.result);
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ballots.ballots.map((b: any) => b.reason)).toEqual(['error', 'error', 'error']);
  });

  it('AC-6 judges hanging past ratingJudgeTimeoutSec time out; the run completes with no rating write', async () => {
    const started = Date.now();
    const run = await runJudged({ seats: threeSeats, config: { ratingJudgeTimeoutSec: 1 }, judge: () => 'hang' });
    expect(Date.now() - started).toBeLessThan(10_000);
    unchangedOutput(run.result);
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ballots.summary).toMatchObject({ dispatched: 3, valid: 0, timedOut: 3 });
  });

  it('AC-6 ratingJudging off dispatches no ballot and writes no tribunal or critique rating', async () => {
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'off' }, judge: rankBy(['MA', 'MB', 'MC']) });
    unchangedOutput(run.result);
    expect(run.judgeCalls).toEqual([]);
    expect(run.ballots).toBeNull();
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ratings?.byMode?.critique ?? {}).toEqual({});
  });

  it('an invalid ratingJudging value behaves as off: no ballot, no ballots.json, no rating', async () => {
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'shdow' }, judge: rankBy(['MA', 'MB', 'MC']) });
    expect(run.judgeCalls).toEqual([]);
    expect(run.ballots).toBeNull();
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
  });

  it('AC-6 shadow dispatches and records the ballots but writes no tribunal or critique rating', async () => {
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'shadow' }, judge: rankBy(['MA', 'MB', 'MC']) });
    unchangedOutput(run.result);
    expect(run.judgeCalls.sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(new Set(run.judgeOutputDirs)).toEqual(new Set([join(outputDir!, 'ballots')]));
    expect(run.ballots).toMatchObject({ judging: 'shadow', summary: { dispatched: 3, valid: 3, timedOut: 0 } });
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
    expect(run.ratings?.byMode?.critique ?? {}).toEqual({});
  });

  it('AC-12 prose-only judges: ballots.json records every ballot as invalid no-rank and the summary line is printed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = await runJudged({ seats: threeSeats, config: { ratingJudging: 'shadow' }, judge: () => reply('P1 was strongest overall.') });
    expect(run.ballots.ballots).toHaveLength(3);
    for (const ballot of run.ballots.ballots) {
      expect(ballot).toMatchObject({ valid: false, reason: 'no-rank', rankLine: null });
      expect(Object.keys(ballot.labelMap).sort()).toEqual(['P1', 'P2']);
    }
    expect(run.ballots.summary).toMatchObject({ dispatched: 3, valid: 0, timedOut: 0 });
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('ballots: 0/3 valid, 0 timed out'))).toHaveLength(1);
  });

  it('AC-12 a run aborted mid-ballots keeps a partial ballots.json with the ballots completed so far', async () => {
    const controller = new AbortController();
    const run = await runJudged({
      seats: threeSeats, signal: controller.signal, settleMs: 100,
      judge: (judge, shown, options) => {
        if (judge === 'alpha') {
          setTimeout(() => controller.abort(), 30);
          return rankBy(['MB', 'MC'])(judge, shown);
        }
        return new Promise<DispatchResult>((resolve) => options.signal?.addEventListener('abort', () => resolve(reply('', 130)), { once: true }));
      },
    });
    expect(run.ballots.ballots).toEqual([expect.objectContaining({ judge: 'alpha', valid: true })]);
    expect(run.ballots.summary).toMatchObject({ dispatched: 3, valid: 1, aborted: true });
    expect(run.ratings?.byMode?.tribunal ?? {}).toEqual({});
  });
});
