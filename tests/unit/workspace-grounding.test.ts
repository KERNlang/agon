// Regression coverage for the workspace-cwd-grounding fix.
//
// The bug: resolveWorkingDir() used to read the PERSISTED `active` workspace
// from ~/.agon/workspaces.json — a field a PRIOR session (in a DIFFERENT
// directory) may have set — instead of process.cwd(). Launching agon in a
// fresh project silently kept the stale pinned root, and every downstream
// consumer (project-context scan, codebase map, tool exec cwd, engine
// dispatch cwd) pointed at the wrong repo.
//
// The fix: an in-memory, per-process `sessionRootState` override
// (setSessionRoot / resolveWorkingDir) that is set explicitly at CLI launch
// (to process.cwd()) or by /workspace switch, and is NEVER implicitly derived
// from — or written back to — the persisted `active` field. Hermetic via
// AGON_HOME redirection (same pattern as tests/unit/adapter-helpers.test.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addWorkspace,
  resolveWorkingDir,
  setSessionRoot,
  _resetSessionRootForTests,
  scanProjectContext,
  snapshotPath,
} from '@kernlang/agon-core';
import type { HandlerContext, Dispatch } from '../../packages/cli/src/handlers/types.js';
import { handleWorkspace } from '../../packages/cli/src/generated/handlers/info.js';
import { createEagerToolContext } from '../../packages/cli/src/generated/cesar/tools.js';

const savedAgonHome = process.env.AGON_HOME;
let agonHome: string;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agon-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function workspacesJsonPath(): string {
  return join(agonHome, 'workspaces.json');
}

function readWorkspacesJsonRaw(): string | null {
  try { return readFileSync(workspacesJsonPath(), 'utf-8'); } catch { return null; }
}

beforeEach(() => {
  agonHome = mkdtempSync(join(tmpdir(), 'agon-ws-grounding-home-'));
  process.env.AGON_HOME = agonHome;
  _resetSessionRootForTests();
});

afterEach(() => {
  _resetSessionRootForTests();
  if (savedAgonHome === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = savedAgonHome;
  rmSync(agonHome, { recursive: true, force: true });
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveWorkingDir grounding', () => {
  it('returns process.cwd() when no sessionRoot has been set', () => {
    expect(resolveWorkingDir()).toBe(process.cwd());
  });

  it('returns the session root after setSessionRoot()', () => {
    const dir = makeTempDir('root');
    setSessionRoot(dir);
    expect(resolveWorkingDir()).toBe(dir);
  });

  it('NEVER falls back to the persisted `active` workspace, even when one is set to a different directory', () => {
    const staleDir = makeTempDir('stale-active');
    // Simulate a PRIOR session's bookmark: workspaces.json with `active` pointing
    // at a directory that has nothing to do with this process's cwd.
    mkdirSync(join(agonHome), { recursive: true });
    writeFileSync(workspacesJsonPath(), JSON.stringify({
      workspaces: [{ id: 'stale', path: staleDir, name: 'stale-active', isKern: false, addedAt: Date.now() }],
      active: 'stale',
    }, null, 2));

    // No setSessionRoot() call — grounding must ignore the persisted active
    // entirely and fall back to process.cwd(), NOT staleDir.
    expect(resolveWorkingDir()).toBe(process.cwd());
    expect(resolveWorkingDir()).not.toBe(staleDir);
  });
});

describe('launch flow does not write workspaces.json', () => {
  it('setSessionRoot(process.cwd()) in a fresh directory leaves a pre-existing workspaces.json byte-identical', () => {
    // Register a fake prior workspace (simulates a previous, unrelated session
    // having bookmarked some other repo).
    const priorDir = makeTempDir('prior-workspace');
    addWorkspace(priorDir);
    const before = readWorkspacesJsonRaw();
    expect(before).not.toBeNull();

    // Simulate launching agon in a brand-new directory that was NEVER
    // registered as a workspace.
    const freshDir = makeTempDir('fresh-launch-dir');
    setSessionRoot(freshDir);

    const after = readWorkspacesJsonRaw();
    expect(after).toBe(before);
    expect(resolveWorkingDir()).toBe(freshDir);
  });

  it('a launch in an ephemeral/ungrounded directory does not create workspaces.json at all', () => {
    expect(existsSync(workspacesJsonPath())).toBe(false);
    const freshDir = makeTempDir('ci-ephemeral');
    setSessionRoot(freshDir);
    expect(existsSync(workspacesJsonPath())).toBe(false);
    expect(resolveWorkingDir()).toBe(freshDir);
  });
});

describe('/workspace switch updates grounding', () => {
  function fakeDispatch(): { calls: any[]; dispatch: Dispatch } {
    const calls: any[] = [];
    return { calls, dispatch: ((event: any) => { calls.push(event); }) as Dispatch };
  }

  it('resolveWorkingDir() returns the switched-to path after /workspace switch', () => {
    const dirA = makeTempDir('workspace-a');
    const dirB = makeTempDir('workspace-b');
    setSessionRoot(dirA);
    addWorkspace(dirA);
    addWorkspace(dirB);
    expect(resolveWorkingDir()).toBe(dirA);

    const { dispatch, calls } = fakeDispatch();
    const ctx = { cesarSession: null } as unknown as HandlerContext;
    handleWorkspace('switch', dispatch, ctx, dirB);

    expect(resolveWorkingDir()).toBe(dirB);
    expect(calls.some((e) => e.type === 'success' && String(e.message).includes(dirB))).toBe(true);
  });

  it('an unknown workspace id/path does not move grounding', () => {
    const dirA = makeTempDir('workspace-known');
    setSessionRoot(dirA);
    addWorkspace(dirA);

    const { dispatch, calls } = fakeDispatch();
    const ctx = { cesarSession: null } as unknown as HandlerContext;
    handleWorkspace('switch', dispatch, ctx, '/nonexistent/not-a-real-workspace');

    expect(resolveWorkingDir()).toBe(dirA);
    expect(calls.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('project brief discovery follows the session root', () => {
  it('scanProjectContext(resolveWorkingDir()) picks up the brief for the CURRENTLY grounded directory', () => {
    const dirA = makeTempDir('brief-a');
    writeFileSync(join(dirA, 'CLAUDE.md'), 'PROJECT-A instructions');
    const dirB = makeTempDir('brief-b');
    // NOTE: the project-brief cascade (context-scanner.kern PROJECT_BRIEF_FILES)
    // recognizes AGENT.md (singular), not AGENTS.md — using the actual supported
    // filename here.
    writeFileSync(join(dirB, 'AGENT.md'), 'PROJECT-B instructions');

    setSessionRoot(dirA);
    const ctxA = scanProjectContext(resolveWorkingDir());
    expect(ctxA).toContain('PROJECT-A instructions');
    expect(ctxA).not.toContain('PROJECT-B instructions');

    setSessionRoot(dirB);
    const ctxB = scanProjectContext(resolveWorkingDir());
    expect(ctxB).toContain('PROJECT-B instructions');
    expect(ctxB).not.toContain('PROJECT-A instructions');
  });
});

describe('engine/tool dispatch cwd follows the session root', () => {
  it('createEagerToolContext (the Cesar tool-exec boundary) receives the session-scoped cwd, not a stale one', () => {
    const dirA = makeTempDir('dispatch-a');
    const dirB = makeTempDir('dispatch-b');

    setSessionRoot(dirA);
    const ctxA = createEagerToolContext({} as any, {} as any, new AbortController().signal, (() => {}) as any);
    expect(ctxA.cwd).toBe(dirA);

    // Simulate a mid-session /workspace switch — the NEXT tool-context build
    // must follow the new root, not the one captured at session start.
    setSessionRoot(dirB);
    const ctxB = createEagerToolContext({} as any, {} as any, new AbortController().signal, (() => {}) as any);
    expect(ctxB.cwd).toBe(dirB);
    expect(ctxB.cwd).not.toBe(dirA);
  });
});

describe('snapshotPath — plan snapshots without a matching bookmark', () => {
  // With session-scoped grounding, NO bookmark matching the grounded cwd is the
  // COMMON case (launch no longer registers workspaces), so handleBuild/handleForge
  // fall back to snapshotPath(cwd). That fallback must capture the REAL repo
  // state — a hardcoded { headSha: 'unknown', dirty: false } placeholder loses
  // what the plan was created against and misleads dirty-tree safety checks.
  function git(dir: string, args: string[]): string {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
  }

  it('captures the real HEAD sha, branch, and clean dirty flag from a git repo', () => {
    const repo = makeTempDir('snap-repo');
    git(repo, ['init', '-b', 'snap-main']);
    git(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init']);
    const expectedSha = git(repo, ['rev-parse', 'HEAD']);

    const snap = snapshotPath(repo);
    expect(snap.id).toBe('cwd');
    expect(snap.path).toBe(repo);
    expect(snap.headSha).toBe(expectedSha);
    expect(snap.headSha).not.toBe('unknown');
    expect(snap.branch).toBe('snap-main');
    expect(snap.dirty).toBe(false);
  });

  it('reports dirty: true for a repo with uncommitted changes', () => {
    const repo = makeTempDir('snap-dirty');
    git(repo, ['init', '-b', 'main']);
    git(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init']);
    writeFileSync(join(repo, 'uncommitted.txt'), 'dirty tree');

    const snap = snapshotPath(repo);
    expect(snap.dirty).toBe(true);
    expect(snap.headSha).not.toBe('unknown');
  });

  it('degrades gracefully to unknown/false placeholders for a non-git directory', () => {
    const plainDir = makeTempDir('snap-plain');
    const snap = snapshotPath(plainDir);
    expect(snap.id).toBe('cwd');
    expect(snap.path).toBe(plainDir);
    expect(snap.headSha).toBe('unknown');
    expect(snap.branch).toBe('unknown');
    expect(snap.dirty).toBe(false);
  });
});
