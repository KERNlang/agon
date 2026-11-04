import { describe, expect, it } from 'vitest';
import { applyTtyDefaults } from '../../packages/cli/src/lazy-commands.js';
import { formatForgeText } from '../../packages/mod-forge/src/report.js';
import { FIRST_PARTY_SURFACE_CATALOG } from '../../packages/mod-kernel/src/generated/first-party-surface-catalog.js';

const projection = { ttyDefaults: { format: 'text' } };

describe('terminal output defaults', () => {
  it('keeps JSON for piped callers so scripts parsing stdout do not break', () => {
    expect(applyTtyDefaults({ format: 'json' }, [], projection, false)).toEqual({ format: 'json' });
  });

  it('uses text in a terminal when no format was passed', () => {
    expect(applyTtyDefaults({ format: 'json' }, ['uncommitted'], projection, true)).toEqual({ format: 'text' });
  });

  it.each([[['--format', 'json']], [['--format=sarif']]])('never overrides an explicit %j in a terminal', (rawArgs) => {
    const input = { format: rawArgs.join('').includes('sarif') ? 'sarif' : 'json' };
    expect(applyTtyDefaults(input, rawArgs, projection, true)).toEqual(input);
  });
});

describe('forge text output', () => {
  it('names the winner, its patch and the run for a human reading the terminal', () => {
    const text = formatForgeText({
      status: 'winner', task: 'fix median', fitness: 'node test.js', baseline: { exitCode: 1 }, winner: 'claude', requested: 2,
      candidates: [
        { engineId: 'claude', pass: true, status: 'passed', score: 100, diffLines: 5, filesChanged: 1, durationMs: 2000, patchPath: '/run/claude.diff' },
        { engineId: 'codex', pass: false, status: 'failed', score: 0, diffLines: 0, filesChanged: 0 },
      ],
      skippedEngines: [{ engineId: 'agy', reason: 'unhealthy' }], runDir: '/run',
    });
    expect(text).toContain('warning: baseline fails');
    expect(text).toContain('Winner: claude');
    expect(text).toContain('Patch: /run/claude.diff');
    expect(text).toContain('skipped agy: unhealthy');
    expect(text).toContain('AGON_RUN: /run');
    expect(text).toContain('AGON_SUMMARY: 1/2 passed');
  });
});

describe('fresh-install help', () => {
  it('describes every top-level command instead of repeating its name', () => {
    const blank = FIRST_PARTY_SURFACE_CATALOG
      .filter(entry => entry.surface === 'cli' && !entry.publicId.includes(' ') && entry.description === entry.publicId)
      .map(entry => entry.publicId);
    expect(blank).toEqual([]);
  });
});
