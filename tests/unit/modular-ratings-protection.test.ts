import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModServices } from '@kernlang/agon-mod-api';
import { runRatings } from '../../packages/mod-ratings/src/implementation.js';

const previous = process.env.AGON_HOME;
const homes: string[] = [];
afterEach(() => {
  if (previous === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = previous;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const context = { invocationId: 'ratings-protection', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'agon-ratings-protection-'));
  homes.push(home);
  process.env.AGON_HOME = home;
  mkdirSync(join(home, 'runs'));
  const global = Object.fromEntries(['active', 'disabled', 'filtered', 'renamed', 'cli-kept', 'fake'].map(id => [id, { mu: 1500, phi: 350, sigma: 0.06, wins: 1, losses: 0, lastActive: '' }]));
  writeFileSync(join(home, 'ratings.json'), JSON.stringify({ global, byMode: {}, byTaskClass: {}, engineMeta: {}, lastUpdated: '' }));
  for (const id of Object.keys(global)) writeFileSync(join(home, 'runs', `${id}.json`), JSON.stringify({ engines: [id] }));
  return home;
}
function services(protectedIds?: () => Promise<readonly string[]>) {
  return {
    receipts: { record: vi.fn(async () => 'receipt') },
    permissions: { check: vi.fn(async () => 'allow') },
    engines: { listActive: vi.fn(async () => ['active']) },
    ...(protectedIds ? { ratings: { protectedEngineIds: protectedIds } } : {}),
  } as unknown as ModServices;
}

it('protects registered inactive/filtered engines and configured keep IDs in preview and apply', async () => {
  const home = fixture();
  const host = services(async () => ['active', 'disabled', 'filtered', 'renamed']);
  const preview = await runRatings({ action: 'purge-unknown', keep: 'cli-kept' }, context, host);
  expect(preview.result).toMatchObject({ dryRun: true, ratingsUnknown: ['fake'] });
  expect(existsSync(join(home, 'runs', 'fake.json'))).toBe(true);
  const applied = await runRatings({ action: 'purge-unknown', keep: 'cli-kept', apply: true }, context, host);
  expect(applied.exitCode).toBe(0);
  const stored = JSON.parse(readFileSync(join(home, 'ratings.json'), 'utf8'));
  expect(Object.keys(stored.global).sort()).toEqual(['active', 'cli-kept', 'disabled', 'filtered', 'renamed']);
  for (const id of Object.keys(stored.global)) expect(existsSync(join(home, 'runs', `${id}.json`))).toBe(true);
  expect(existsSync(join(home, 'runs', 'fake.json'))).toBe(false);
});

it('refuses purge without an authoritative protected-engine host instead of treating every engine as unknown', async () => {
  const home = fixture();
  const before = readFileSync(join(home, 'ratings.json'), 'utf8');
  const result = await runRatings({ action: 'purge-unknown', apply: true }, context, services());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/protected.engine|registered.engine/i);
  expect(readFileSync(join(home, 'ratings.json'), 'utf8')).toBe(before);
  expect(existsSync(join(home, 'runs', 'fake.json'))).toBe(true);
});

it.each([null, 'active', [42], [''], [' active '], Array(1)])('refuses malformed protected IDs (%j) without writes', async invalid => {
  const home = fixture();
  const before = readFileSync(join(home, 'ratings.json'), 'utf8');
  const host = services(async () => invalid as unknown as string[]);
  const result = await runRatings({ action: 'purge-unknown', apply: true }, context, host);
  expect(result.exitCode).toBe(1);
  expect(host.permissions.check).not.toHaveBeenCalled();
  expect(readFileSync(join(home, 'ratings.json'), 'utf8')).toBe(before);
});

it('does not mutate after cancellation during permission checking', async () => {
  const home = fixture();
  const before = readFileSync(join(home, 'ratings.json'), 'utf8');
  const controller = new AbortController();
  const host = services(async () => ['active']);
  vi.mocked(host.permissions.check).mockImplementation(async () => { controller.abort(); return 'allow'; });
  await expect(runRatings({ action: 'purge-unknown', apply: true }, { ...context, signal: controller.signal }, host)).rejects.toThrow();
  expect(readFileSync(join(home, 'ratings.json'), 'utf8')).toBe(before);
});

it.each(['registry', 'permission'])('refuses changed storage root across the %s await', async boundary => {
  const original = fixture();
  const other = fixture();
  process.env.AGON_HOME = original;
  const before = readFileSync(join(original, 'ratings.json'), 'utf8');
  const host = services(async () => {
    if (boundary === 'registry') process.env.AGON_HOME = other;
    return ['active'];
  });
  vi.mocked(host.permissions.check).mockImplementation(async () => {
    if (boundary === 'permission') process.env.AGON_HOME = other;
    return 'allow';
  });
  const result = await runRatings({ action: 'purge-unknown', apply: true }, context, host);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toMatch(/storage|home|root/i);
  expect(readFileSync(join(original, 'ratings.json'), 'utf8')).toBe(before);
  expect(readFileSync(join(other, 'ratings.json'), 'utf8')).toBe(before);
});

it('rechecks manifests updated with a protected engine while permission was pending', async () => {
  const home = fixture();
  const host = services(async () => ['active', 'disabled', 'filtered', 'renamed', 'cli-kept']);
  vi.mocked(host.permissions.check).mockImplementation(async () => {
    writeFileSync(join(home, 'runs', 'fake.json'), JSON.stringify({ engines: ['fake', 'active'] }));
    return 'allow';
  });
  const result = await runRatings({ action: 'purge-unknown', apply: true }, context, host);
  expect(result.exitCode).toBe(0);
  expect(existsSync(join(home, 'runs', 'fake.json'))).toBe(true);
  expect(result.result).toMatchObject({ runsPurged: [] });
});
