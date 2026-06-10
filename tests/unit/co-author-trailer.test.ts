import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coAuthorTrailer } from '../../packages/core/src/git.js';
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
