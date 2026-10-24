import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRatings } from '@kernlang/agon-core';
import type { GlickoRating, RatingRecord } from '@kernlang/agon-core';
import { ratingsCommand } from '../../packages/cli/src/commands/ratings.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const ACTIVE = '2026-09-01T00:00:00.000Z';

const rating = (mu: number, phi: number, wins = 7, losses = 3): GlickoRating => ({ mu, phi, sigma: 0.06, wins, losses, lastActive: ACTIVE });

const meta = (identity: string) => ({ firstSeen: ACTIVE, lastActive: ACTIVE, matchCount: 10, derivedFrom: null, versions: [], identity });

const seededRecord = (): RatingRecord => ({
  global: { agy: rating(1800, 50), codex: rating(1600, 60) },
  byMode: {
    forge: { agy: rating(1550, 90) },
    brainstorm: { codex: rating(1520, 80) },
    tribunal: { agy: rating(1900, 40, 114, 1), codex: rating(1500, 70) },
    critique: { agy: rating(1950, 35, 99, 1), codex: rating(1480, 90) },
  },
  byTaskClass: { bugfix: { agy: rating(1700, 60) } },
  engineMeta: { agy: meta('cli:1.0.0'), codex: meta('gpt-x') } as unknown as RatingRecord['engineMeta'],
  lastUpdated: ACTIVE,
});

describe('agon ratings reset', () => {
  let home: string;
  let original: string;
  let logs: string[];
  const file = () => join(home, 'ratings.json');
  const backups = () => readdirSync(home).filter((name) => name.startsWith('ratings.json.bak-'));
  const reset = (args: Record<string, unknown>) => (ratingsCommand as any).subCommands.reset.run({ args });
  const stored = (): RatingRecord => JSON.parse(readFileSync(file(), 'utf-8'));

  beforeEach(() => {
    home = setupTestAgonHome('ratings-reset');
    original = JSON.stringify(seededRecord(), null, 2) + '\n';
    writeFileSync(file(), original);
    logs = [];
    const capture = (...parts: unknown[]) => { logs.push(parts.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    cleanupTestAgonHome(home);
  });

  it('AC-10 without --apply prints the per-engine entries it would reset and writes nothing', () => {
    reset({ modes: 'critique,tribunal' });
    const out = logs.join('\n');
    for (const needle of ['critique', 'tribunal', 'agy', 'codex', '1950', '99-1']) expect(out).toContain(needle);
    expect(readFileSync(file(), 'utf-8')).toBe(original);
    expect(backups()).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it('AC-10 through the CLI parser: reset without --apply writes nothing; with --apply it writes', async () => {
    await runCommand(ratingsCommand, { rawArgs: ['reset', '--modes', 'critique,tribunal'] });
    expect(readFileSync(file(), 'utf-8')).toBe(original);
    expect(backups()).toEqual([]);
    await runCommand(ratingsCommand, { rawArgs: ['reset', '--modes', 'critique,tribunal', '--apply'] });
    expect(backups()).toHaveLength(1);
    expect(stored().byMode.critique.agy).toMatchObject({ mu: 1500, wins: 0, losses: 0 });
  });

  it('AC-10 --apply writes the backup first, resets those byMode entries, and leaves every other scope byte-identical', () => {
    reset({ modes: 'critique,tribunal', apply: true });
    expect(backups()).toHaveLength(1);
    expect(readFileSync(join(home, backups()[0]), 'utf-8')).toBe(original);

    const before = seededRecord();
    const after = stored();
    for (const mode of ['tribunal', 'critique'] as const) {
      for (const id of ['agy', 'codex']) {
        expect(after.byMode[mode][id]).toMatchObject({ mu: 1500, phi: 350, sigma: 0.06, wins: 0, losses: 0 });
      }
      expect(Object.keys(after.byMode[mode]).sort()).toEqual(['agy', 'codex']);
    }
    expect(JSON.stringify(after.global)).toBe(JSON.stringify(before.global));
    expect(JSON.stringify(after.byMode.forge)).toBe(JSON.stringify(before.byMode.forge));
    expect(JSON.stringify(after.byMode.brainstorm)).toBe(JSON.stringify(before.byMode.brainstorm));
    expect(JSON.stringify(after.byTaskClass)).toBe(JSON.stringify(before.byTaskClass));
    expect(JSON.stringify(after.engineMeta)).toBe(JSON.stringify(before.engineMeta));
    expect(process.exitCode).toBeUndefined();
  });

  it('AC-10 --engines limits the reset to the named engines', () => {
    reset({ modes: 'critique', engines: 'agy', apply: true });
    const after = stored();
    expect(after.byMode.critique.agy).toMatchObject({ mu: 1500, phi: 350, wins: 0, losses: 0 });
    expect(after.byMode.critique.codex).toEqual(seededRecord().byMode.critique.codex);
    expect(after.byMode.tribunal).toEqual(seededRecord().byMode.tribunal);
  });

  it('AC-10 an unknown mode exits 1 and writes nothing', () => {
    reset({ modes: 'critic', apply: true });
    expect(process.exitCode).toBe(1);
    expect(logs.join('\n')).toContain('critic');
    expect(readFileSync(file(), 'utf-8')).toBe(original);
    expect(backups()).toEqual([]);
  });

  it('AC-10 an unknown engine is reported and nothing is written', () => {
    reset({ modes: 'critique', engines: 'agy,nope', apply: true });
    expect(process.exitCode).toBe(1);
    expect(logs.join('\n')).toContain('nope');
    expect(readFileSync(file(), 'utf-8')).toBe(original);
    expect(backups()).toEqual([]);
  });

  it('AC-10 resetRatings is pure: it returns the reset record and leaves its input untouched', () => {
    const input = seededRecord();
    const plan = resetRatings(input, ['critique'], ['agy']);
    expect(input).toEqual(seededRecord());
    expect(plan.unknownModes).toEqual([]);
    expect(plan.unknownEngines).toEqual([]);
    expect(plan.entries.map((e) => `${e.mode}:${e.engineId}`)).toEqual(['critique:agy']);
    expect(plan.record.byMode.critique.agy).toMatchObject({ mu: 1500, phi: 350, wins: 0, losses: 0 });
    expect(plan.record.byMode.critique.codex).toEqual(input.byMode.critique.codex);
    expect(existsSync(file())).toBe(true);
  });
});
