import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coAuthorTrailer, appendCoAuthor } from '../../packages/core/src/git.js';
import { loadConfig } from '../../packages/core/src/config.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

describe('coAuthorTrailer', () => {
  it('returns empty string when commitCoAuthor is unset', () => {
    expect(coAuthorTrailer({})).toBe('');
  });

  it('returns empty string when commitCoAuthor is blank/whitespace', () => {
    expect(coAuthorTrailer({ commitCoAuthor: '' })).toBe('');
    expect(coAuthorTrailer({ commitCoAuthor: '   ' })).toBe('');
  });

  it('returns a leading-blank-line Co-Authored-By paragraph when set', () => {
    const id = 'Cesar (agon) <12345+cesar-agon@users.noreply.github.com>';
    expect(coAuthorTrailer({ commitCoAuthor: id })).toBe(`\n\nCo-Authored-By: ${id}`);
  });

  it('trims surrounding whitespace from the configured value', () => {
    expect(coAuthorTrailer({ commitCoAuthor: '  Cesar <x@y.z>  ' })).toBe('\n\nCo-Authored-By: Cesar <x@y.z>');
  });
});

describe('appendCoAuthor (paragraph-aware join)', () => {
  const id = 'agon (KERN) <noreply@kernlang.dev>';
  const trailer = `Co-Authored-By: ${id}`;

  it('returns the message unchanged when commitCoAuthor is blank/unset', () => {
    expect(appendCoAuthor('feat: do thing', {})).toBe('feat: do thing');
    expect(appendCoAuthor('feat: do thing', { commitCoAuthor: '' })).toBe('feat: do thing');
    expect(appendCoAuthor('feat: do thing', { commitCoAuthor: '   ' })).toBe('feat: do thing');
  });

  it('appends a NEW paragraph (blank-line separated) for a plain message', () => {
    const out = appendCoAuthor('feat: do thing', { commitCoAuthor: id });
    expect(out).toBe(`feat: do thing\n\n${trailer}`);
    // Exactly ONE blank-line separator before the trailer block.
    expect(out.split('\n\n')).toHaveLength(2);
  });

  it('appends a new paragraph when the body has multiple paragraphs but no trailing trailer block', () => {
    const msg = 'feat: do thing\n\nThis explains the change in prose.';
    const out = appendCoAuthor(msg, { commitCoAuthor: id });
    expect(out).toBe(`${msg}\n\n${trailer}`);
  });

  it('JOINS into the final paragraph (single \\n) when the message already ends in a trailer block', () => {
    const msg = 'feat: do thing\n\nSigned-off-by: User <u@x.z>';
    const out = appendCoAuthor(msg, { commitCoAuthor: id });
    // Joined with a single newline so both trailers live in ONE final paragraph.
    expect(out).toBe(`${msg}\n${trailer}`);
    // The trailer block (after the last blank-line separator) must contain BOTH
    // trailers, i.e. there is exactly one blank-line separator in the whole message.
    const paragraphs = out.split(/\n\s*\n/);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[paragraphs.length - 1]).toBe(`Signed-off-by: User <u@x.z>\n${trailer}`);
  });

  it('joins into a final paragraph that is a MULTI-LINE trailer block', () => {
    const msg = 'fix: bug\n\nReviewed-by: A <a@x.z>\nCo-Authored-By: B <b@x.z>';
    const out = appendCoAuthor(msg, { commitCoAuthor: id });
    expect(out).toBe(`${msg}\n${trailer}`);
    expect(out.split(/\n\s*\n/)).toHaveLength(2);
  });

  it('joins when the message already ends in the legacy autoCredit Agon AI line (proves the orphaning bug is fixed)', () => {
    // This mirrors the /commit handler shape when autoCredit applies AND a
    // commitCoAuthor identity is also set. The handler now SKIPS autoCredit when
    // commitCoAuthor is active (inspection-verified at commit.kern), but even if
    // both were present, appendCoAuthor keeps them in one trailer paragraph
    // rather than orphaning the autoCredit line.
    const msg = 'feat: do thing\n\nCo-authored-by: Agon AI <agon@local>';
    const out = appendCoAuthor(msg, { commitCoAuthor: id });
    expect(out).toBe(`${msg}\n${trailer}`);
    expect(out.split(/\n\s*\n/)).toHaveLength(2);
  });

  it('treats a prose-ending message as non-trailer (new paragraph), guarding the regex', () => {
    // "Note: this is prose" — first line matches /^[A-Za-z][A-Za-z-]*: / but
    // is followed by a non-trailer line, so the block is NOT all-trailers.
    const msg = 'feat: do thing\n\nNote: this is prose\nand more prose here';
    const out = appendCoAuthor(msg, { commitCoAuthor: id });
    expect(out).toBe(`${msg}\n\n${trailer}`);
  });
});

// Integration: prove the opt-OUT model end-to-end through loadConfig's
// global/project merge feeding coAuthorTrailer. This is the real contract that
// matters now that the trailer is ON by default — a unit test on coAuthorTrailer
// alone can't show that an explicit "" in a config layer overrides the default.
describe('commitCoAuthor default-on opt-out (loadConfig + coAuthorTrailer)', () => {
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    homeDir = setupTestAgonHome('coauthor');
    projectDir = join(tmpdir(), `agon-coauthor-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTestAgonHome(homeDir);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('DEFAULT (no config anywhere): trailer is present with the KERN identity', () => {
    const config = loadConfig(projectDir);
    expect(config.commitCoAuthor).toBe('agon (KERN) <noreply@kernlang.dev>');
    expect(coAuthorTrailer(config)).toBe('\n\nCo-Authored-By: agon (KERN) <noreply@kernlang.dev>');
  });

  it('project config "" overrides the default to OFF (no trailer)', () => {
    writeFileSync(join(projectDir, '.agon.json'), JSON.stringify({ commitCoAuthor: '' }));
    const config = loadConfig(projectDir);
    expect(config.commitCoAuthor).toBe('');
    expect(coAuthorTrailer(config)).toBe('');
  });

  it('global config "" overrides the default to OFF (no trailer)', () => {
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ commitCoAuthor: '' }));
    const config = loadConfig(projectDir);
    expect(config.commitCoAuthor).toBe('');
    expect(coAuthorTrailer(config)).toBe('');
  });

  it('local private config "" overrides the default to OFF (no trailer)', () => {
    writeFileSync(join(projectDir, '.agon.local.json'), JSON.stringify({ commitCoAuthor: '' }));
    const config = loadConfig(projectDir);
    expect(config.commitCoAuthor).toBe('');
    expect(coAuthorTrailer(config)).toBe('');
  });

  it('project config custom value wins over the default', () => {
    const custom = 'Cesar (agon) <99+cesar@users.noreply.github.com>';
    writeFileSync(join(projectDir, '.agon.json'), JSON.stringify({ commitCoAuthor: custom }));
    const config = loadConfig(projectDir);
    expect(config.commitCoAuthor).toBe(custom);
    expect(coAuthorTrailer(config)).toBe(`\n\nCo-Authored-By: ${custom}`);
  });

  it('project "" overrides a non-empty global value (closest layer wins, empties not skipped)', () => {
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ commitCoAuthor: 'Global <g@x.z>' }));
    writeFileSync(join(projectDir, '.agon.json'), JSON.stringify({ commitCoAuthor: '' }));
    const config = loadConfig(projectDir);
    expect(config.commitCoAuthor).toBe('');
    expect(coAuthorTrailer(config)).toBe('');
  });
});
