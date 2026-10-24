// normalizeGitHubRemote + prefilledPrUrl — the no-gh PR path. After a push,
// agon prints a GitHub compare URL with ?quick_pull=1&title=&body= so the
// human clicks it and the PR form is already filled.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as worktreeOwner from '@kernlang/agon-support-worktree';

import { normalizeGitHubRemote, prefilledPrUrl, githubRepoUrl, defaultBaseBranch } from '../../packages/core/src/blocks/git.js';

it('uses one shared owner for all GitHub PR helpers', () => {
  for (const [name, implementation] of Object.entries({ normalizeGitHubRemote, prefilledPrUrl, githubRepoUrl, defaultBaseBranch })) {
    expect(worktreeOwner).toHaveProperty(name, implementation);
  }
});

it('resolves local remote metadata and default branches without network access', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agon-pr-link-'));
  const hooks = join(cwd, 'empty-hooks');
  mkdirSync(hooks);
  const git = (...args: string[]) => execFileSync('git', [
    '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgSign=false', ...args,
  ], { cwd, stdio: 'pipe', timeout: 10_000 });
  try {
    expect(githubRepoUrl(cwd)).toBe('');
    expect(defaultBaseBranch(cwd)).toBe('main');
    git('init', '-q');
    expect(defaultBaseBranch(cwd)).toBe('main');
    expect(defaultBaseBranch(cwd, 'missing')).toBe('main');
    const configuredHooks = join(cwd, 'configured-hooks');
    mkdirSync(configuredHooks);
    writeFileSync(join(configuredHooks, 'pre-commit'), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
    git('config', 'core.hooksPath', configuredHooks);
    git('config', 'commit.gpgSign', 'true');
    git('config', 'gpg.program', join(cwd, 'missing-fixture-signer'));
    writeFileSync(join(cwd, 'file.txt'), 'fixture');
    git('add', 'file.txt');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
    git('remote', 'add', 'origin', 'https://github.com/example/one.git');
    git('remote', 'add', 'upstream', 'git@github.com:example/two.git');
    expect(githubRepoUrl(cwd)).toBe('https://github.com/example/one');
    expect(githubRepoUrl(cwd, 'upstream')).toBe('https://github.com/example/two');
    expect(githubRepoUrl(cwd, 'missing')).toBe('');
    git('remote', 'set-url', '--push', 'upstream', 'https://github.com/example/push-target.git');
    expect(githubRepoUrl(cwd, 'upstream')).toBe('https://github.com/example/push-target');
    git('update-ref', 'refs/remotes/origin/master', 'HEAD');
    expect(defaultBaseBranch(cwd)).toBe('master');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(defaultBaseBranch(cwd)).toBe('main');
    git('update-ref', 'refs/remotes/upstream/release', 'HEAD');
    git('update-ref', 'refs/remotes/upstream/main', 'HEAD');
    git('symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/release');
    expect(defaultBaseBranch(cwd, 'upstream')).toBe('release');
    expect(defaultBaseBranch(cwd)).toBe('main');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

describe('normalizeGitHubRemote', () => {
  it('normalizes scp-like ssh remotes', () => {
    expect(normalizeGitHubRemote('git@github.com:KERNlang/agon.git')).toBe('https://github.com/KERNlang/agon');
    expect(normalizeGitHubRemote('git@github.com:KERNlang/agon')).toBe('https://github.com/KERNlang/agon');
  });

  it('normalizes ssh:// remotes', () => {
    expect(normalizeGitHubRemote('ssh://git@github.com/KERNlang/agon.git')).toBe('https://github.com/KERNlang/agon');
  });

  it('normalizes http(s) remotes, stripping .git, trailing slash and userinfo', () => {
    expect(normalizeGitHubRemote('https://github.com/KERNlang/agon.git')).toBe('https://github.com/KERNlang/agon');
    expect(normalizeGitHubRemote('https://github.com/KERNlang/agon/')).toBe('https://github.com/KERNlang/agon');
    expect(normalizeGitHubRemote('https://user@github.com/KERNlang/agon.git')).toBe('https://github.com/KERNlang/agon');
  });

  it("returns '' for non-GitHub or unparseable remotes (caller skips the prefilled link)", () => {
    expect(normalizeGitHubRemote('git@gitlab.com:org/repo.git')).toBe('');
    expect(normalizeGitHubRemote('https://bitbucket.org/org/repo')).toBe('');
    expect(normalizeGitHubRemote('')).toBe('');
    expect(normalizeGitHubRemote('not a url')).toBe('');
  });
});

describe('prefilledPrUrl', () => {
  const base = { repoUrl: 'https://github.com/KERNlang/agon', base: 'main', branch: 'goal/x', title: 'feat: thing', body: '## Summary\nhello & welcome' };

  it('builds a quick_pull compare URL with encoded title and body', () => {
    const url = prefilledPrUrl(base);
    expect(url.startsWith('https://github.com/KERNlang/agon/compare/main...goal%2Fx?quick_pull=1&title=feat%3A%20thing&body=')).toBe(true);
    expect(url).toContain(encodeURIComponent('hello & welcome'));
  });

  it("returns '' when repoUrl is empty", () => {
    expect(prefilledPrUrl({ ...base, repoUrl: '' })).toBe('');
  });

  it('shrinks an oversized body until the whole URL fits under ~7.5k chars', () => {
    const url = prefilledPrUrl({ ...base, body: 'x'.repeat(50_000) });
    expect(url.length).toBeLessThanOrEqual(7500);
    expect(decodeURIComponent(url.split('&body=')[1])).toContain('truncated');
  });

  it('clamps an oversized title so the fixed URL head cannot blow the length budget', () => {
    const url = prefilledPrUrl({ ...base, title: 't'.repeat(5_000), body: 'x'.repeat(50_000) });
    expect(url.length).toBeLessThanOrEqual(7500);
  });

  it('leaves a normal-sized body untouched', () => {
    const url = prefilledPrUrl(base);
    expect(decodeURIComponent(url.split('&body=')[1])).toBe(base.body);
  });

  it('does not split a Unicode pair at the title limit', () => {
    const url = prefilledPrUrl({ ...base, title: 'x'.repeat(255) + '😀' });
    expect(new URL(url).searchParams.get('title')).toBe('x'.repeat(255));
  });

  it('truncates long Unicode bodies without a malformed URI', () => {
    const url = prefilledPrUrl({ ...base, body: '😀'.repeat(5000) });
    expect(url.length).toBeLessThanOrEqual(7500);
    const body = new URL(url).searchParams.get('body')!;
    expect(body).toMatch(/^😀+\n\n/u);
    expect(body).toContain('body truncated');
    expect(body).not.toContain('\uFFFD');
  });

  it.each(['repoUrl', 'base', 'branch'] as const)('omits an oversized link without truncating its %s identity', key => {
    const oversized = key === 'repoUrl' ? 'x'.repeat(8000) : 'é'.repeat(2000);
    expect(prefilledPrUrl({ ...base, [key]: `${base[key]}/${oversized}` })).toBe('');
  });

  it('omits the link when even the truncation note cannot fit', () => {
    const emptyLength = prefilledPrUrl({ ...base, body: '' }).length;
    const branch = base.branch + 'x'.repeat(7495 - emptyLength);
    expect(prefilledPrUrl({ ...base, branch, body: 'x'.repeat(10000) })).toBe('');
  });
});
