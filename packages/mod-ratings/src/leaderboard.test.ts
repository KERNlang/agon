import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { runRatings } from './implementation.js';

let home: string;
let previous: string | undefined;
const rating = { mu: 1800, phi: 40, sigma: 0.06, wins: 9, losses: 1, lastActive: '' };
const context = (): InvocationContext => ({ invocationId: 'lb', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
const services = { receipts: { record: async () => 'receipt' } } as unknown as ModServices;

beforeEach(() => {
  previous = process.env.AGON_HOME;
  home = mkdtempSync(join(tmpdir(), 'mod-ratings-lb-'));
  process.env.AGON_HOME = home;
  writeFileSync(join(home, 'ratings.json'), JSON.stringify({ global: { a: rating }, byMode: {}, byTaskClass: {}, engineMeta: {}, lastUpdated: '' }));
});
afterEach(() => {
  if (previous === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

it('bare ratings prints a readable table by default and JSON only with --json', async () => {
  const text = await runRatings({}, context(), services);
  expect(text.stdout).toContain('Global Leaderboard');
  expect(text.stdout).toMatch(/1\.\s+a \*\s+1800/);
  expect(text.stdout?.trimStart().startsWith('{')).toBe(false);
  const json = await runRatings({ json: true }, context(), services);
  expect(JSON.parse(json.stdout ?? '').ratings[0]).toMatchObject({ engine: 'a', rating: 1800 });
});
