// Unit tests for Council — the all-engines roundtable mode.
// Covers Glicko-informed role assignment (Contrarian = top critique-rated, rest by
// global rating, priority-order trim/pad), the pure prompt builders, confidence
// parsing, and the runCouncil contract (refuse <2, N==2 degrade, advisor-failure
// tolerance, chairman-verdict gating). No paid engine dispatch needed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GlickoRating, RatingRecord } from '@agon/core';
import {
  DEFAULT_COUNCIL_ROLES,
  roleGuidance,
  assignCouncilRoles,
  buildCouncilBriefPrompt,
  buildRolePrompt,
  buildCritiquePrompt,
  buildChairmanPrompt,
  parseCouncilConfidence,
  runCouncil,
} from '@agon/forge';

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
  byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: {} },
  byTaskClass: {},
  engineMeta: {},
  lastUpdated: new Date().toISOString(),
  ...over,
});

describe('DEFAULT_COUNCIL_ROLES', () => {
  it('is the priority-ordered role set (risk-first, upside last)', () => {
    expect([...DEFAULT_COUNCIL_ROLES]).toEqual([
      'Contrarian', 'First-Principles', 'Red-Team', 'Outsider', 'Expansionist',
    ]);
  });
});

describe('roleGuidance', () => {
  it('gives in-character instructions for known roles', () => {
    expect(roleGuidance('Contrarian')).toContain('CONTRARIAN');
    expect(roleGuidance('Red-Team')).toContain('pre-mortem');
    expect(roleGuidance('First-Principles')).toContain('fundamental');
    expect(roleGuidance('Expansionist')).toContain('upside');
  });
  it('falls back to a generic brief for a custom role', () => {
    expect(roleGuidance('Historian')).toContain('Historian');
  });
});

describe('assignCouncilRoles', () => {
  it('gives the Contrarian seat to the top CRITIQUE-rated advisor', () => {
    // b leads critique (the proven critic); a leads global. Contrarian must be b.
    const r = ratings({
      global: { a: rating(1600) },
      byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: { a: rating(1500), b: rating(1800) } },
    });
    const seats = assignCouncilRoles(['a', 'b', 'c'], r, [...DEFAULT_COUNCIL_ROLES]);
    expect(seats).toEqual([
      { engineId: 'b', role: 'Contrarian' },
      { engineId: 'a', role: 'First-Principles' },
      { engineId: 'c', role: 'Red-Team' },
    ]);
  });

  it('trims to the advisor count, dropping the lowest-priority roles', () => {
    const r = ratings({ byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: { a: rating(1800) } } });
    const seats = assignCouncilRoles(['a', 'b'], r, [...DEFAULT_COUNCIL_ROLES]);
    expect(seats.map((s) => s.role)).toEqual(['Contrarian', 'First-Principles']);
    expect(seats[0].engineId).toBe('a'); // top critic
  });

  it('pads with generic Advisor N roles when advisors outnumber roles', () => {
    const r = ratings({ byMode: { forge: {}, brainstorm: {}, tribunal: {}, critique: { a: rating(1800) } } });
    const seats = assignCouncilRoles(['a', 'b', 'c'], r, ['Solo']);
    expect(seats.map((s) => s.role)).toEqual(['Solo', 'Advisor 2', 'Advisor 3']);
  });

  it('returns [] for no advisors', () => {
    expect(assignCouncilRoles([], ratings(), [...DEFAULT_COUNCIL_ROLES])).toEqual([]);
  });

  it('seats every advisor exactly once even with no ratings', () => {
    const seats = assignCouncilRoles(['a', 'b', 'c'], ratings(), [...DEFAULT_COUNCIL_ROLES]);
    expect(seats.map((s) => s.engineId).sort()).toEqual(['a', 'b', 'c']);
    expect(seats.map((s) => s.role)).toEqual(['Contrarian', 'First-Principles', 'Red-Team']);
  });
});

describe('buildCouncilBriefPrompt', () => {
  it('embeds the question and the six brief sections, and forbids recommending yet', () => {
    const p = buildCouncilBriefPrompt('Adopt event sourcing?');
    expect(p).toContain('Adopt event sourcing?');
    expect(p).toContain('DECISION');
    expect(p).toContain('OPTIONS');
    expect(p).toContain('STAKES & REVERSIBILITY');
    expect(p).toContain('WHAT WOULD CHANGE THE ANSWER');
    expect(p).toContain('Do NOT recommend an option yet');
  });
});

describe('buildRolePrompt', () => {
  it('embeds the role guidance, the brief, and the Position line', () => {
    const p = buildRolePrompt({ role: 'Contrarian', brief: 'BRIEF-XYZ' });
    expect(p).toContain('CONTRARIAN');
    expect(p).toContain('BRIEF-XYZ');
    expect(p).toContain('Position:');
  });
});

describe('buildCritiquePrompt', () => {
  it('embeds the target role + response and the four structured questions, not a ranking', () => {
    const p = buildCritiquePrompt({ critiqueRole: 'Red-Team', brief: 'B', targetRole: 'Expansionist', targetResponse: 'TARGET-RESP' });
    expect(p).toContain('Red-Team');
    expect(p).toContain('Expansionist');
    expect(p).toContain('TARGET-RESP');
    expect(p).toContain('BIGGEST BLIND SPOT');
    expect(p).toContain('MOST FRAGILE ASSUMPTION');
    expect(p).toContain('BEST RIVAL OPTION');
  });
});

describe('buildChairmanPrompt', () => {
  it('embeds positions, critiques, and demands confidence + kill-switch + anti-laundering', () => {
    const p = buildChairmanPrompt({
      brief: 'B',
      seats: [
        { role: 'Contrarian', response: 'RESP-A', critique: 'CRIT-A', critiquedRole: 'Red-Team' },
        { role: 'Red-Team', response: 'RESP-B', critique: '', critiquedRole: 'Contrarian' },
      ],
    });
    expect(p).toContain('RESP-A');
    expect(p).toContain('CRIT-A');
    expect(p).toContain('Confidence: X%');
    expect(p).toContain('KILL-SWITCH');
    expect(p).toContain('HOW THE CRITIQUES CHANGED THIS');
  });

  it('renders "(none)" when no critiques are present', () => {
    const p = buildChairmanPrompt({ brief: 'B', seats: [{ role: 'Contrarian', response: 'R', critique: '', critiquedRole: '' }] });
    expect(p).toContain('(none)');
  });
});

describe('parseCouncilConfidence', () => {
  it('prefers an explicit Confidence marker', () => {
    expect(parseCouncilConfidence('Confidence: 72%\n## Recommendation')).toBe(72);
    expect(parseCouncilConfidence('Confidence ~ 40 %')).toBe(40);
  });
  it('falls back to the first percentage, and is null when out of range or missing', () => {
    expect(parseCouncilConfidence('I am 55% sure')).toBe(55);
    expect(parseCouncilConfidence('no number')).toBeNull();
    expect(parseCouncilConfidence('999% certain')).toBeNull();
  });
});

describe('runCouncil — contract', () => {
  const registry = { get: (id: string) => ({ id }), list: () => [] } as any;
  const okStdout = 'Confidence: 72%\n## Recommendation\nDo the thing.\nKILL-SWITCH: if X then reverse.';
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', durationMs: 1, timedOut: false });
  const fail = () => ({ exitCode: 1, stdout: '', stderr: 'boom', durationMs: 1, timedOut: false });
  const adapter = (route: (prompt: string) => any) => ({ dispatch: async ({ prompt }: { prompt: string }) => route(prompt) }) as any;
  const base = (over: Record<string, unknown>) => ({ question: 'Should we ship?', timeout: 30, registry, cwd: tmpdir(), ...over } as any);

  let home: string;
  let outDir: string;
  const savedHome = process.env.AGON_HOME;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agon-council-home-'));
    outDir = mkdtempSync(join(tmpdir(), 'agon-council-out-'));
    process.env.AGON_HOME = home;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it('refuses a council of fewer than 2 engines', async () => {
    const res = await runCouncil(base({ engines: ['solo'], outputDir: outDir, adapter: adapter(() => ok(okStdout)) }));
    expect(res.ok).toBe(false);
    expect(res.degraded).toBe(true);
    expect(res.verdict).toContain('at least 2 engines');
    expect(res.seats).toEqual([]);
  });

  it('runs a 3-engine council: N-1 advisors, chair excluded, verdict + confidence parsed', async () => {
    const res = await runCouncil(base({ engines: ['a', 'b', 'c'], outputDir: outDir, adapter: adapter(() => ok(okStdout)) }));
    expect(res.ok).toBe(true);
    expect(res.confidence).toBe(72);
    expect(res.seats).toHaveLength(2); // 3 engines -> 2 advisors + 1 chair
    expect(res.seats.map((s) => s.engineId)).not.toContain(res.chairmanId);
    expect(res.degraded).toBe(false);
  });

  it('N==2: both engines advise and a separate engine chairs, flagged degraded', async () => {
    const res = await runCouncil(base({ engines: ['a', 'b'], outputDir: outDir, adapter: adapter(() => ok(okStdout)) }));
    expect(res.ok).toBe(true);
    expect(res.degraded).toBe(true);
    expect(res.chairmanReason).toBe('cesar');
    expect(res.seats).toHaveLength(2);
    expect(res.warnings.some((w) => /thin|2 engines|indicative/i.test(w))).toBe(true);
  });

  it('tolerates one advisor failing — warns but still returns a chairman verdict', async () => {
    const res = await runCouncil(base({
      engines: ['a', 'b', 'c'],
      outputDir: outDir,
      adapter: adapter((p) => (p.includes('CONTRARIAN') ? fail() : ok(okStdout))),
    }));
    expect(res.ok).toBe(true);
    const contrarian = res.seats.find((s) => s.role === 'Contrarian');
    expect(contrarian?.response).toBe('(no response)');
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('ok:false only when the verdict fails on EVERY engine (failover exhausted)', async () => {
    // Route by prompt, so the verdict fails for the chair AND every failover candidate.
    const res = await runCouncil(base({
      engines: ['a', 'b', 'c'],
      outputDir: outDir,
      adapter: adapter((p) => (p.includes('Synthesize the advisors') ? fail() : ok(okStdout))),
    }));
    expect(res.ok).toBe(false);
  });

  it('fails the chair over to an advisor when the seated chair cannot produce the verdict', async () => {
    // Only the seated chair (forced 'a') fails the verdict; advisor 'b' can synthesize.
    const routed = (engineId: string, prompt: string) =>
      prompt.includes('Synthesize the advisors') && engineId === 'a' ? fail() : ok(okStdout);
    const byEngine = { dispatch: async ({ engine, prompt }: { engine: { id: string }; prompt: string }) => routed(engine.id, prompt) } as any;
    const res = await runCouncil(base({ engines: ['a', 'b', 'c'], chairman: 'a', outputDir: outDir, adapter: byEngine }));
    expect(res.ok).toBe(true);
    expect(res.confidence).toBe(72);
    expect(res.warnings.some((w) => /stepped in as acting chair/i.test(w))).toBe(true);
    expect(res.chairmanId).toBe('a'); // seated chair preserved for the record
    expect(res.actingChairmanId).not.toBe('a'); // an advisor actually produced the verdict
    expect(['b', 'c']).toContain(res.actingChairmanId);
    expect(res.degraded).toBe(true); // ran without its seated chair
  });

  it('fails the chair over for the BRIEF too, not just the verdict', async () => {
    // Seated chair 'a' fails everything; an advisor must frame the brief AND synthesize.
    const routed = (engineId: string) => (engineId === 'a' ? fail() : ok(okStdout));
    const byEngine = { dispatch: async ({ engine }: { engine: { id: string } }) => routed(engine.id) } as any;
    const res = await runCouncil(base({ engines: ['a', 'b', 'c'], chairman: 'a', outputDir: outDir, adapter: byEngine }));
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => /returned no brief/i.test(w))).toBe(true);
    expect(res.chairmanId).toBe('a');
    expect(res.actingChairmanId).not.toBe('a');
  });

  it('honors a forced chairman', async () => {
    const res = await runCouncil(base({ engines: ['a', 'b', 'c'], chairman: 'b', outputDir: outDir, adapter: adapter(() => ok(okStdout)) }));
    expect(res.chairmanId).toBe('b');
    expect(res.chairmanReason).toBe('forced');
    expect(res.seats.map((s) => s.engineId)).not.toContain('b');
  });

  it('honors a forced chairman even on a 2-engine council (not overridden by the N==2 cesar fallback)', async () => {
    const res = await runCouncil(base({ engines: ['a', 'b'], chairman: 'a', outputDir: outDir, adapter: adapter(() => ok(okStdout)) }));
    expect(res.chairmanId).toBe('a');
    expect(res.chairmanReason).toBe('forced');
    expect(res.seats.map((s) => s.engineId)).toEqual(['b']); // a chairs, b is the lone advisor
    expect(res.degraded).toBe(true); // thin panel warned
  });
});
