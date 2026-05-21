// Contract for phase 2: a `writeProvenanceReport` core helper that builds a
// provenance ledger from a ForgeManifest and writes the report file(s).
//
// Assertions are deliberately mutation-grade: they pin the winner/rejected
// roles, acceptance mechanisms, autonomy level, format branching, and return
// paths — so flipping a boolean / `===` / `||` / `return` in the provenance
// logic breaks at least one expectation (goal's mutation-witness demands this).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeProvenanceReport } from '@agon/core';
import type { ForgeManifest } from '@agon/core';

const fixture: ForgeManifest = {
  forgeId: 'test-forge-provenance-1',
  forgeDir: '/tmp/forge-x',
  task: 'add a thing\nwith a multiline prompt',
  fitnessCmd: 'npm test',
  timestamp: '2026-05-21T00:00:00.000Z',
  engines: ['claude', 'codex'],
  results: {
    codex: { engineId: 'codex', pass: true, score: 90, diffLines: 10, filesChanged: 1, durationSec: 5, lintWarnings: 0, styleScore: 1 },
    claude: { engineId: 'claude', pass: false, score: 0, diffLines: 0, filesChanged: 0, durationSec: 3, lintWarnings: 0, styleScore: 0 },
  },
  patches: {},
  winner: 'codex',
  closeCall: false,
  stage1Accepted: true,
  baselinePasses: false,
  starter: 'cli',
  enginesDispatched: 2,
};

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('writeProvenanceReport', () => {
  it('writes a Markdown statement that names the winner and pins roles', () => {
    const dir = freshDir('prov-md-');
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(fixture));

    const out = writeProvenanceReport(fixture, manifestPath, dir, 'md');

    expect(out.endsWith('provenance.md')).toBe(true);
    expect(existsSync(out)).toBe(true);
    const md = readFileSync(out, 'utf-8');
    expect(md).toContain('AI Contribution Statement');
    // Winner row: codex must be the accepted winner via the autonomous gate.
    expect(md).toContain('| codex | winner | yes | autonomous-gate');
    // Loser row: claude must be rejected / not accepted.
    expect(md).toContain('| claude | rejected | no | not-accepted');
    expect(md).toContain('AI-SELECTED');
    expect(md).toContain('What the AI did NOT do');
    // multiline prompt collapsed to a single Scope line (no raw newline break)
    expect(md).not.toContain('add a thing\nwith a multiline prompt');
  });

  it('writes a JSON ledger with correct per-engine attribution', () => {
    const dir = freshDir('prov-json-');
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(fixture));

    const out = writeProvenanceReport(fixture, manifestPath, dir, 'json');

    expect(out.endsWith('provenance.json')).toBe(true);
    expect(existsSync(out)).toBe(true);
    const led = JSON.parse(readFileSync(out, 'utf-8'));
    expect(led.kind).toBe('forge');
    expect(led.winner).toBe('codex');
    expect(led.runId).toBe('test-forge-provenance-1');
    expect(led.autonomyLevel).toBe('autonomous-selection');
    expect(led.synthesisBlended).toBe(false);
    expect(Array.isArray(led.aiDidNot)).toBe(true);
    expect(led.aiDidNot.length).toBeGreaterThanOrEqual(2);

    const codex = led.contributions.find((c: { engineId: string }) => c.engineId === 'codex');
    const claude = led.contributions.find((c: { engineId: string }) => c.engineId === 'claude');
    expect(codex.role).toBe('winner');
    expect(codex.accepted).toBe(true);
    expect(codex.acceptanceMechanism).toBe('autonomous-gate');
    expect(claude.role).toBe('rejected');
    expect(claude.accepted).toBe(false);
  });

  it("writes BOTH files when format is 'both' and returns the md path", () => {
    const dir = freshDir('prov-both-');
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(fixture));

    const out = writeProvenanceReport(fixture, manifestPath, dir, 'both');

    expect(out.endsWith('provenance.md')).toBe(true);
    expect(existsSync(join(dir, 'provenance.md'))).toBe(true);
    expect(existsSync(join(dir, 'provenance.json'))).toBe(true);
  });
});
