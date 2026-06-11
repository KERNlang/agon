// normalizeGitHubRemote + prefilledPrUrl — the no-gh PR path. After a push,
// agon prints a GitHub compare URL with ?quick_pull=1&title=&body= so the
// human clicks it and the PR form is already filled.

import { describe, expect, it } from 'vitest';

import { normalizeGitHubRemote, prefilledPrUrl } from '../../packages/core/src/git.js';

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
});
