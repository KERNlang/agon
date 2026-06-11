import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';

import { withFileLock } from '../../packages/core/src/generated/blocks/file-lock.js';

// ── Generic cross-process file lock contract ─────────────────────────────
// Pins the primitive that serializes every shared-~/.agon read-modify-write
// (ratings.json, team-elo.json, config.json, prune stamp): O_EXCL acquire,
// pid-liveness + TTL stale reclaim via rename-away, owner-checked release.

describe('withFileLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agon-file-lock-'));
    lockPath = join(dir, 'state.json.lock');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs work and removes the lock afterwards', () => {
    let ran = false;
    withFileLock(lockPath, () => {
      ran = true;
      expect(existsSync(lockPath)).toBe(true);
    });
    expect(ran).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('creates missing parent directories for the lock', () => {
    const nested = join(dir, 'a', 'b', 'c.lock');
    withFileLock(nested, () => {});
    expect(existsSync(nested)).toBe(false);
    expect(existsSync(join(dir, 'a', 'b'))).toBe(true);
  });

  it('releases the lock when work throws', () => {
    expect(() => withFileLock(lockPath, () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('times out against a LIVE same-host holder', () => {
    // A holder record with OUR pid is maximally alive.
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid, uuid: 'other', hostname: hostname(), acquiredAt: new Date().toISOString(),
    }), { flag: 'wx' });
    expect(() => withFileLock(lockPath, () => {}, { timeoutMs: 80 })).toThrow(/file lock timeout/);
    expect(existsSync(lockPath)).toBe(true); // never steals a live lock
  });

  it('reclaims a same-host lock whose pid is dead', () => {
    writeFileSync(lockPath, JSON.stringify({
      pid: 2 ** 30, uuid: 'dead', hostname: hostname(), acquiredAt: new Date().toISOString(),
    }), { flag: 'wx' });
    let ran = false;
    withFileLock(lockPath, () => { ran = true; }, { timeoutMs: 500 });
    expect(ran).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('reclaims a cross-host lock only after the TTL', () => {
    const foreign = (ageMs: number) => JSON.stringify({
      pid: 1, uuid: 'remote', hostname: 'some-other-host',
      acquiredAt: new Date(Date.now() - ageMs).toISOString(),
    });
    // Fresh foreign lock: honored → timeout.
    writeFileSync(lockPath, foreign(0), { flag: 'wx' });
    expect(() => withFileLock(lockPath, () => {}, { timeoutMs: 80, staleMs: 10_000 })).toThrow(/file lock timeout/);
    // Expired foreign lock: reclaimed.
    let ran = false;
    writeFileSync(lockPath, foreign(60_000));
    withFileLock(lockPath, () => { ran = true; }, { timeoutMs: 500, staleMs: 10_000 });
    expect(ran).toBe(true);
  });

  it('honors a timeout smaller than one sleep slice (never spins forever)', () => {
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid, uuid: 'other', hostname: hostname(), acquiredAt: new Date().toISOString(),
    }), { flag: 'wx' });
    const start = Date.now();
    expect(() => withFileLock(lockPath, () => {}, { timeoutMs: 1 })).toThrow(/file lock timeout/);
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it('treats a corrupt lock file as stale', () => {
    writeFileSync(lockPath, 'not json at all', { flag: 'wx' });
    let ran = false;
    withFileLock(lockPath, () => { ran = true; }, { timeoutMs: 500 });
    expect(ran).toBe(true);
  });

  it('release is owner-checked: never unlinks a lock it no longer owns', () => {
    const usurper = JSON.stringify({
      pid: process.pid, uuid: 'usurper', hostname: hostname(), acquiredAt: new Date().toISOString(),
    });
    withFileLock(lockPath, () => {
      // Simulate a mid-work stale-reclaim by another process.
      writeFileSync(lockPath, usurper);
    });
    expect(existsSync(lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, 'utf-8')).uuid).toBe('usurper');
  });

  // The discriminating multi-process oracle: N child processes each do K
  // locked read-increment-write cycles on one counter file. Without the lock
  // this loses updates almost every run; with it the count is exact.
  const distEntry = resolve(__dirname, '../../packages/core/dist/index.js');
  it.skipIf(!existsSync(distEntry))('serializes RMW across real processes (no lost updates)', async () => {
    const counterPath = join(dir, 'counter.txt');
    writeFileSync(counterPath, '0');
    const CHILDREN = 4;
    const ITERS = 25;
    const script = `
      const { withFileLock } = await import(${JSON.stringify('file://' + distEntry)});
      const { readFileSync, writeFileSync } = await import('node:fs');
      for (let i = 0; i < ${ITERS}; i++) {
        withFileLock(${JSON.stringify(lockPath)}, () => {
          const n = parseInt(readFileSync(${JSON.stringify(counterPath)}, 'utf-8'), 10);
          writeFileSync(${JSON.stringify(counterPath)}, String(n + 1));
        }, { timeoutMs: 30000 });
      }
    `;
    await Promise.all(Array.from({ length: CHILDREN }, () => new Promise<void>((resolvePromise, rejectPromise) => {
      execFile(process.execPath, ['--input-type=module', '-e', script], { timeout: 60_000 }, (err, _stdout, stderr) => {
        if (err) rejectPromise(new Error(`child failed: ${err.message}\n${stderr}`));
        else resolvePromise();
      });
    })));
    expect(readFileSync(counterPath, 'utf-8')).toBe(String(CHILDREN * ITERS));
  }, 90_000);
});
