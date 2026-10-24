import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { runRatings } from './implementation.js';

let home: string;
let previous: string | undefined;
let original: string;
const rating = { mu: 1800, phi: 40, sigma: 0.06, wins: 9, losses: 1, lastActive: '' };
const context = (): InvocationContext => ({ invocationId: 'reset', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} });
const services = (check = vi.fn(async () => 'allow')) => ({ permissions: { check } }) as unknown as ModServices;

beforeEach(() => {
  previous = process.env.AGON_HOME;
  home = mkdtempSync(join(tmpdir(), 'mod-ratings-reset-'));
  process.env.AGON_HOME = home;
  original = JSON.stringify({ global: { a: rating }, byMode: { tribunal: { a: rating } }, byTaskClass: {}, engineMeta: {}, lastUpdated: '' });
  writeFileSync(join(home, 'ratings.json'), original);
});
afterEach(() => {
  if (previous === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

it('previews without a permission request or any write', async () => {
  const check = vi.fn(async () => 'deny');
  const result = await runRatings({ action: 'reset', modes: 'tribunal' }, context(), services(check));
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('DRY RUN');
  expect(result.stdout).toContain('1800\t40\t9-1');
  expect(check).not.toHaveBeenCalled();
  expect(readdirSync(home)).toEqual(['ratings.json']);
  expect(readFileSync(join(home, 'ratings.json'), 'utf8')).toBe(original);
});

it('backs up original bytes and changes only selected ratings', async () => {
  const result = await runRatings({ action: 'reset', modes: 'tribunal', apply: true }, context(), services());
  expect(result.exitCode).toBe(0);
  const backup = readdirSync(home).find(name => name.startsWith('ratings.json.bak-'))!;
  expect(readFileSync(join(home, backup), 'utf8')).toBe(original);
  const saved = JSON.parse(readFileSync(join(home, 'ratings.json'), 'utf8'));
  expect(saved.byMode.tribunal.a).toMatchObject({ mu: 1500, wins: 0, losses: 0 });
  expect(saved.global.a).toEqual(rating);
});

it.each(['denied', 'cancelled', 'stale', 'root-changed'] as const)('does not write after %s authorization', async reason => {
  const controller = new AbortController();
  let stale = false;
  const ctx = { ...context(), signal: controller.signal, assertCurrent() { if (stale) throw new Error('stale generation'); } };
  const check = vi.fn(async () => {
    if (reason === 'cancelled') controller.abort(new Error('cancelled'));
    if (reason === 'stale') stale = true;
    if (reason === 'root-changed') process.env.AGON_HOME = join(home, 'other');
    return reason === 'denied' ? 'deny' : 'allow';
  });
  const result = runRatings({ action: 'reset', modes: 'tribunal', apply: true }, ctx, services(check));
  if (reason === 'cancelled' || reason === 'stale') await expect(result).rejects.toThrow();
  else expect((await result).exitCode).toBe(1);
  expect(readFileSync(join(home, 'ratings.json'), 'utf8')).toBe(original);
  expect(readdirSync(home)).toEqual(['ratings.json']);
});
