import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  acquireApplyLock, releaseApplyLock, headChanged, branchChanged,
} from '../../packages/core/src/generated/blocks/worktree-lock.js';

// ── Advisory apply-lock + HEAD-CAS contract ──────────────────────────────
// Pins the cross-session guards: a per-checkout O_EXCL lock with pid/TTL/host
// stale-reclaim, and a HEAD/branch compare-and-swap.

describe('apply-lock + HEAD-CAS', () => {
  let base: string;
  let repo: string;
  let lockPath: string;
  let head: string;
  const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'agon-lock-'));
    repo = join(base, 'repo');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q'], repo);
    git(['config', 'user.email', 'test@agon.dev'], repo);
    git(['config', 'user.name', 'Agon Test'], repo);
    writeFileSync(join(repo, 'f.txt'), 'hi');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'init'], repo);
    lockPath = join(git(['rev-parse', '--absolute-git-dir'], repo), 'agon-apply.lock');
    head = git(['rev-parse', 'HEAD'], repo);
  });

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  describe('acquire / release', () => {
    it('acquires a free lock, blocks a second live acquire, then releases', () => {
      const a = acquireApplyLock(repo, 'first');
      expect(a.acquired).toBe(true);
      expect(existsSync(lockPath)).toBe(true);

      const b = acquireApplyLock(repo, 'second');
      expect(b.acquired).toBe(false);          // our own (alive) pid still holds it
      expect(b.heldBy?.pid).toBe(process.pid);

      releaseApplyLock(repo, a.sessionUUID as string);
      expect(existsSync(lockPath)).toBe(false);

      const c = acquireApplyLock(repo, 'third');
      expect(c.acquired).toBe(true);
      releaseApplyLock(repo, c.sessionUUID as string);
    });

    it('release with a foreign sessionUUID leaves the lock intact', () => {
      const a = acquireApplyLock(repo, 'owner');
      releaseApplyLock(repo, 'not-the-owner');
      expect(existsSync(lockPath)).toBe(true);
      expect(acquireApplyLock(repo, 'x').acquired).toBe(false);
      releaseApplyLock(repo, a.sessionUUID as string);
    });
  });

  describe('stale reclaim', () => {
    const writeHolder = (info: Record<string, unknown>) => writeFileSync(lockPath, JSON.stringify(info));

    it('reclaims a lock held by a dead pid', () => {
      writeHolder({ pid: 2147483647, sessionUUID: 'dead', hostname: hostname(), action: 'old', acquiredAt: new Date().toISOString() });
      const a = acquireApplyLock(repo, 'fresh');
      expect(a.acquired).toBe(true);
      expect(a.sessionUUID).not.toBe('dead');
      releaseApplyLock(repo, a.sessionUUID as string);
    });

    it('reclaims a lock past its TTL even if the pid is alive', () => {
      const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      writeHolder({ pid: process.pid, sessionUUID: 'oldself', hostname: hostname(), action: 'old', acquiredAt: old });
      const a = acquireApplyLock(repo, 'fresh');
      expect(a.acquired).toBe(true);
      releaseApplyLock(repo, a.sessionUUID as string);
    });

    it('honors a fresh lock from another host (cannot pid-verify across hosts)', () => {
      writeHolder({ pid: 1, sessionUUID: 'remote', hostname: 'some-other-host-xyz', action: 'remote', acquiredAt: new Date().toISOString() });
      const a = acquireApplyLock(repo, 'fresh');
      expect(a.acquired).toBe(false);
      expect(a.heldBy?.hostname).toBe('some-other-host-xyz');
    });
  });

  describe('HEAD / branch compare-and-swap', () => {
    it('detects a HEAD change and ignores null/unknown baselines', () => {
      expect(headChanged(repo, head).changed).toBe(false);
      expect(headChanged(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef').changed).toBe(true);
      expect(headChanged(repo, null).changed).toBe(false);
      expect(headChanged(repo, 'unknown').changed).toBe(false);
    });

    it('detects a branch change and ignores null/unknown baselines', () => {
      const cur = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
      expect(branchChanged(repo, cur).changed).toBe(false);
      expect(branchChanged(repo, 'some-other-branch').changed).toBe(true);
      expect(branchChanged(repo, null).changed).toBe(false);
      expect(branchChanged(repo, 'unknown').changed).toBe(false);
    });
  });
});
