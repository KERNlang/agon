import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModServices } from '@kernlang/agon-mod-api';
import { runRatings } from '../../packages/mod-ratings/src/implementation.js';
import { purgeRatingsStore } from '../../packages/mod-ratings/src/maintenance.js';
import * as forgeOwner from '@kernlang/agon-mod-forge';

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

it.each(['vanished', 'blocked'])('reports real run moves and preserves recovery when a run is %s', change => {
  const home = fixture();
  const before = readFileSync(join(home, 'ratings.json'), 'utf8');
  const keep = ['active', 'disabled', 'filtered', 'renamed', 'cli-kept'];
  const invoke = () => purgeRatingsStore({ registryIds: keep, dryRun: false }, {
    path: (...parts: string[]) => join(home, ...parts),
    load: () => JSON.parse(readFileSync(join(home, 'ratings.json'), 'utf8')),
    save: record => {
      writeFileSync(join(home, 'ratings.json'), JSON.stringify(record));
      if (change === 'vanished') rmSync(join(home, 'runs', 'fake.json'));
      else {
        const backup = readdirSync(home).find(name => name.startsWith('purge-backup-'))!;
        mkdirSync(join(home, backup, 'runs', 'fake.json'), { recursive: true });
      }
    },
  });
  if (change === 'blocked') expect(invoke).toThrow(/stopped while moving fake.json.*backups/);
  else expect(invoke().report.runsPurged).toEqual([]);
  const backup = readdirSync(home).find(name => name.startsWith('purge-backup-'))!;
  expect(readFileSync(join(home, backup, 'ratings.json'), 'utf8')).toBe(before);
  expect(existsSync(join(home, 'runs', 'active.json'))).toBe(true);
});

it('keeps malformed and mixed runs, unknown JSON fields, and byte-exact backups through the mod', async () => {
  const home = fixture();
  const path = join(home, 'ratings.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.extra = { retained: ['custom field'] };
  stored.engineMeta.active = { derivedFrom: 'fake', versions: ['fake', 'older-real'], extra: 'retained' };
  writeFileSync(path, JSON.stringify(stored));
  writeFileSync(join(home, 'runs', 'mixed.json'), JSON.stringify({ engines: ['active', 'fake'] }));
  writeFileSync(join(home, 'runs', 'broken.json'), '{');
  writeFileSync(join(home, 'runs', 'other.json'), JSON.stringify({ steps: [] }));
  const before = readFileSync(path, 'utf8');
  const host = services(async () => ['active', 'disabled', 'filtered', 'renamed', 'cli-kept']);
  const preview = await runRatings({ action: 'purge-unknown' }, context, host);
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(preview.result).toMatchObject({ runsPurged: [{ file: 'fake.json', engines: ['fake'], valid: true }] });
  const result = await runRatings({ action: 'purge-unknown', apply: true }, context, host);
  const report = result.result as { backupDir: string };
  expect(readFileSync(join(report.backupDir, 'ratings.json'), 'utf8')).toBe(before);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ extra: stored.extra,
    engineMeta: { active: { derivedFrom: null, versions: ['older-real'], extra: 'retained' } } });
  for (const name of ['mixed.json', 'broken.json', 'other.json']) expect(existsSync(join(home, 'runs', name))).toBe(true);
  const again = await runRatings({ action: 'purge-unknown', apply: true }, context, host);
  expect(again.result).toMatchObject({ ratingsUnknown: [], ratingsRemoved: [], runsPurged: [] });
});

it('does not overwrite an earlier recovery snapshot when two purges share a timestamp', async () => {
  const home = fixture();
  const before = readFileSync(join(home, 'ratings.json'), 'utf8');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T00:00:00.000Z'));
  try {
    const first = await runRatings({ action: 'purge-unknown', apply: true }, context,
      services(async () => ['active', 'disabled', 'filtered', 'renamed', 'cli-kept']));
    const firstBackup = (first.result as { backupDir: string }).backupDir;
    const second = await runRatings({ action: 'purge-unknown', apply: true }, context, services(async () => ['active']));
    const secondBackup = (second.result as { backupDir: string }).backupDir;
    expect(readFileSync(join(firstBackup, 'ratings.json'), 'utf8')).toBe(before);
    expect(secondBackup).not.toBe(firstBackup);
  } finally { vi.useRealTimers(); }
});

it('keeps a run that gains a protected engine after the initial scan', () => {
  const home = fixture();
  const result = purgeRatingsStore({ registryIds: ['active', 'disabled', 'filtered', 'renamed', 'cli-kept'], dryRun: false }, {
    path: (...parts: string[]) => join(home, ...parts),
    load: () => JSON.parse(readFileSync(join(home, 'ratings.json'), 'utf8')),
    save: record => {
      writeFileSync(join(home, 'ratings.json'), JSON.stringify(record));
      writeFileSync(join(home, 'runs', 'fake.json'), JSON.stringify({ engines: ['fake', 'active'] }));
    },
  });
  expect(result.report.runsPurged).toEqual([]);
  expect(existsSync(join(home, 'runs', 'fake.json'))).toBe(true);
});

it('publishes Forge history only inside the same per-manifest lock used by purge', () => {
  const home = fixture();
  const forgeDir = join(home, 'forge');
  mkdirSync(forgeDir);
  const history = join(home, 'runs', 'fake.json');
  const before = readFileSync(history, 'utf8');
  let writeHistory: (() => void) | undefined;
  const store = forgeOwner.createForgeManifestStore({
    runsDir: join(home, 'runs'),
    withFileLock: (path: string, write: () => void) => {
      expect(path).toBe(history + '.lock');
      writeHistory = write;
    },
  });
  expect(writeHistory).toBeUndefined();
  const manifest: forgeOwner.ForgeManifest = {
    forgeId: 'fake', forgeDir, engines: ['active'], task: 'protect history',
    fitnessCmd: 'true', timestamp: '2026-01-01T00:00:00.000Z',
    results: {}, patches: {}, winner: null, closeCall: false,
    stage1Accepted: false, baselinePasses: false, starter: 'active', enginesDispatched: 0,
  };
  expect(store.writeManifest(manifest)).toBe(join(forgeDir, 'manifest.json'));
  expect(forgeOwner.readManifest(forgeDir)).toEqual(manifest);
  expect(readFileSync(history, 'utf8')).toBe(before);
  expect(writeHistory).toBeTypeOf('function');
  writeHistory!();
  expect(JSON.parse(readFileSync(history, 'utf8')).engines).toEqual(['active']);
  const published = readFileSync(history, 'utf8');
  expect(store.updateManifest(forgeDir, { status: 'completed' })).toEqual({ ...manifest, status: 'completed' });
  expect(readFileSync(history, 'utf8')).toBe(published);
  writeHistory!();
  expect(JSON.parse(readFileSync(history, 'utf8')).status).toBe('completed');
  expect(existsSync(history + '.tmp')).toBe(false);
  expect(existsSync(join(forgeDir, 'manifest.json.tmp'))).toBe(false);
});

it('retains the first moved run and original ratings if a later run move fails', () => {
  const home = fixture();
  const before = readFileSync(join(home, 'ratings.json'), 'utf8');
  writeFileSync(join(home, 'runs', 'extra.json'), JSON.stringify({ engines: ['fake'] }));
  const candidates = readdirSync(join(home, 'runs')).filter(name => ['fake.json', 'extra.json'].includes(name));
  const invoke = () => purgeRatingsStore({ registryIds: ['active', 'disabled', 'filtered', 'renamed', 'cli-kept'], dryRun: false }, {
    path: (...parts: string[]) => join(home, ...parts),
    load: () => JSON.parse(readFileSync(join(home, 'ratings.json'), 'utf8')),
    save: record => {
      writeFileSync(join(home, 'ratings.json'), JSON.stringify(record));
      const backup = readdirSync(home).find(name => name.startsWith('purge-backup-'))!;
      mkdirSync(join(home, backup, 'runs', candidates[1]), { recursive: true });
    },
  });
  expect(invoke).toThrow(/Earlier changes have backups/);
  const backup = join(home, readdirSync(home).find(name => name.startsWith('purge-backup-'))!);
  expect(readFileSync(join(backup, 'ratings.json'), 'utf8')).toBe(before);
  expect(JSON.parse(readFileSync(join(backup, 'runs', candidates[0]), 'utf8')).engines).toEqual(['fake']);
  expect(existsSync(join(home, 'runs', candidates[1]))).toBe(true);
});

it('does not move history when the ratings codec fails after backup', () => {
  const home = fixture();
  const before = readFileSync(join(home, 'ratings.json'), 'utf8');
  expect(() => purgeRatingsStore({ registryIds: ['active'], dryRun: false }, {
    path: (...parts: string[]) => join(home, ...parts),
    load: () => JSON.parse(before),
    save: () => { throw new Error('fixture codec failure'); },
  })).toThrow('fixture codec failure');
  const backup = join(home, readdirSync(home).find(name => name.startsWith('purge-backup-'))!);
  expect(readFileSync(join(backup, 'ratings.json'), 'utf8')).toBe(before);
  expect(readFileSync(join(home, 'ratings.json'), 'utf8')).toBe(before);
  expect(existsSync(join(home, 'runs', 'fake.json'))).toBe(true);
});

it('does not invoke the writer or move runs when copying the ratings backup fails', () => {
  const home = fixture();
  const path = join(home, 'ratings.json');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  rmSync(path);
  mkdirSync(path);
  const save = vi.fn();
  expect(() => purgeRatingsStore({ registryIds: ['active'], dryRun: false }, {
    path: (...parts: string[]) => join(home, ...parts), load: () => record, save,
  })).toThrow();
  expect(save).not.toHaveBeenCalled();
  expect(existsSync(join(home, 'runs', 'fake.json'))).toBe(true);
});
