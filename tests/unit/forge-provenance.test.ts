// Contract (test-first) for phase 2: a `writeProvenanceReport` core helper that
// builds a provenance ledger from a ForgeManifest and writes the report file(s)
// to a directory — the reusable core that `forge --provenance` will call.
//
// This test is RED until @agon/core exports `writeProvenanceReport`.
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

describe('writeProvenanceReport', () => {
  it('writes a Markdown AI-contribution statement into the output dir and returns its path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-report-'));
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(fixture));

    const out = writeProvenanceReport(fixture, manifestPath, dir, 'md');

    expect(typeof out).toBe('string');
    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, 'utf-8');
    expect(content).toContain('AI Contribution Statement');
    expect(content).toContain('codex'); // the winner is named
  });

  it('writes a JSON ledger when format is json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-report-json-'));
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(fixture));

    const out = writeProvenanceReport(fixture, manifestPath, dir, 'json');

    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, 'utf-8'));
    expect(parsed.kind).toBe('forge');
    expect(parsed.winner).toBe('codex');
    expect(parsed.runId).toBe('test-forge-provenance-1');
  });
});
