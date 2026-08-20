// Pins the Cesar mutate reflex (packages/cli/src/cesar/mutate-reflex.ts):
// which turns earn the one-line "/mutate?" nudge, and which lens the changed
// paths earn. Veto-first, like the delegation reflex — a false positive costs
// the user attention on every turn, so the rule must stay quiet by default.
import { describe, it, expect } from 'vitest';
import {
  assessMutateReflex, buildMutateSuggestionLine, mutateLensForPaths, mutatedPathFromToolArgs,
} from '../../packages/cli/src/cesar/mutate-reflex.js';

const assess = (over: Partial<{ input: string; response: string; paths: string[] }> = {}) =>
  assessMutateReflex({ input: '', response: '', paths: [], ...over });

describe('assessMutateReflex — a green suite is not a strong suite', () => {
  it('suggests a mechanical run when the turn CLAIMS the tests pass', () => {
    for (const response of [
      'Done — all tests pass now, and the typecheck is clean.',
      'The suite is green after that change; nothing else to do.',
      'I added tests for the new branch and everything is green.',
      'All 42 tests passing, gate is green.',
    ]) {
      const r = assess({ response });
      expect(r.decision, response).toBe('suggest');
      expect(r.trigger).toBe('test-claim');
      expect(r.command).toBe('/mutate');
    }
  });

  it('suggests when the USER questions whether the tests are real', () => {
    for (const input of [
      'are these tests real?',
      'are my tests good enough?',
      'would the tests actually catch a regression here?',
      'how strong are my tests?',
    ]) {
      const r = assess({ input });
      expect(r.decision, input).toBe('suggest');
      expect(r.trigger).toBe('test-doubt');
    }
  });

  it('stays silent on an ordinary turn — no claim, no doubt', () => {
    const r = assess({ input: 'rename the helper', response: 'Renamed it in three files.' });
    expect(r.decision).toBe('none');
    expect(r.vetoes).toContain('no-test-claim-or-doubt');
    expect(buildMutateSuggestionLine(r)).toBeNull();
  });

  it('stays silent when mutation is already in the conversation', () => {
    expect(assess({ response: 'All tests pass. Mutation score 91% — 2 survivor(s).' }).vetoes)
      .toContain('mutation-already-in-conversation');
    expect(assess({ input: '/mutate src/a.ts', response: 'all tests pass' }).vetoes)
      .toContain('mutation-already-in-conversation');
  });

  it('does not fire on a truncated turn that merely says "tests pass"', () => {
    expect(assess({ response: 'tests pass' }).vetoes).toContain('response-too-short');
  });

  it('upgrades to --semantic --lens when the turn WROTE high-risk paths', () => {
    const r = assess({
      response: 'All tests pass after the session-token change.',
      paths: ['packages/api/src/auth/session.ts', 'README.md'],
    });
    expect(r.command).toBe('/mutate --semantic --lens security');
    expect(r.lens).toBe('security');
    expect(r.reasons).toContain('changed paths look security-sensitive');
  });

  it('keeps the bare mechanical suggestion for ordinary paths', () => {
    const r = assess({ response: 'All tests pass.', paths: ['src/ui/button.tsx', 'docs/readme.md'] });
    expect(r.command).toBe('/mutate');
    expect(r.lens).toBeUndefined();
  });
});

describe('mutateLensForPaths — the lens comes from review\'s own sensitive-path evidence', () => {
  it('maps each high-risk family to its lens, security first', () => {
    expect(mutateLensForPaths(['src/auth/login.ts'])).toBe('security');
    expect(mutateLensForPaths(['src/sessions/store.ts'])).toBe('security');
    expect(mutateLensForPaths(['src/rate-limit/quota.ts', 'src/db/migrations/001.sql'])).toBe('ratelimit');
    expect(mutateLensForPaths(['prisma/migrations/001_init.sql'])).toBe('privacy');
    // Both auth and persistence in one diff: security outranks.
    expect(mutateLensForPaths(['src/db/users.ts', 'src/auth/token.ts'])).toBe('security');
  });

  it('falls back to security for a sensitive path with no family of its own', () => {
    expect(mutateLensForPaths(['src/protocols/wire.ts'])).toBe('security');
    expect(mutateLensForPaths(['deploy/release.ts'])).toBe('security');
  });

  it('is null for ordinary and empty path sets', () => {
    expect(mutateLensForPaths([])).toBeNull();
    expect(mutateLensForPaths(['src/ui/button.tsx', 'README.md'])).toBeNull();
  });
});

describe('buildMutateSuggestionLine — one dim in-flow line, never a modal', () => {
  it('names the exact command the user would type', () => {
    const line = buildMutateSuggestionLine(assess({ response: 'All tests pass now.' }))!;
    expect(line).toContain('/mutate');
    expect(line).toContain('green tests are not the same as strong tests');
    expect(line.startsWith('\x1b[2m')).toBe(true);
    expect(line.endsWith('\x1b[0m')).toBe(true);
  });

  it('uses the doubt wording when the user asked the question', () => {
    expect(buildMutateSuggestionLine(assess({ input: 'are these tests real?' }))!)
      .toContain('passing tests only prove they are green');
  });
});

describe('mutatedPathFromToolArgs', () => {
  it('reads the path a write tool touched, and nothing else', () => {
    expect(mutatedPathFromToolArgs('Edit', { file_path: 'src/a.ts' })).toBe('src/a.ts');
    expect(mutatedPathFromToolArgs('Write', { path: ' src/b.ts ' })).toBe('src/b.ts');
    expect(mutatedPathFromToolArgs('Bash', { command: 'ls' })).toBeNull();
    expect(mutatedPathFromToolArgs('Edit', undefined)).toBeNull();
  });
});
