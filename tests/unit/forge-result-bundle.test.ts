import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildForgeCleanupCommand,
  completeMissingForgeResults,
  writeForgeResultBundle,
} from '../../packages/forge/src/generated/forge.js';

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('forge result bundle helpers', () => {
  it('builds a cleanup command with safe quoting', () => {
    expect(buildForgeCleanupCommand('/repo/root', '/tmp/forge run')).toBe("for wt in '/tmp/forge run'/wt-* '/tmp/forge run'/synth-worktree; do [ -e \"$wt\" ] && git -C /repo/root worktree remove --force \"$wt\"; done; git -C /repo/root worktree prune; rm -rf '/tmp/forge run'");
  });

  it('writes an inspectable result bundle for completed and failed engines', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'agon-forge-bundle-'));
    const manifest = {
      forgeId: 'forge-test',
      forgeDir: tempDir,
      task: 'fix login',
      fitnessCmd: 'npm test',
      timestamp: new Date().toISOString(),
      engines: ['claude', 'codex'],
      results: {
        claude: {
          engineId: 'claude',
          pass: true,
          score: 91,
          diffLines: 12,
          filesChanged: 1,
          durationSec: 4,
          lintWarnings: 0,
          styleScore: 100,
          patchPath: join(tempDir, 'claude.diff'),
          worktreePath: join(tempDir, 'wt-claude'),
          fitnessLogPath: join(tempDir, 'claude-fitness.txt'),
        },
        codex: {
          engineId: 'codex',
          pass: false,
          score: 0,
          diffLines: 0,
          filesChanged: 0,
          durationSec: 2,
          lintWarnings: 0,
          styleScore: 100,
        },
      },
      patches: { claude: join(tempDir, 'claude.diff') },
      winner: 'claude',
      closeCall: false,
      stage1Accepted: false,
      baselinePasses: false,
      starter: 'claude',
      enginesDispatched: 2,
    } as any;

    const bundlePath = writeForgeResultBundle(
      manifest,
      [{ engineId: 'claude', path: join(tempDir, 'wt-claude'), repoRoot: '/repo/root' }],
      { task: 'fix login', fitnessCmd: 'npm test', cwd: '/repo/root', forgeDir: tempDir } as any,
      '/repo/root',
      'abc123',
      join(tempDir, 'forge.jsonl'),
    );

    const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8'));
    expect(bundle.status).toBe('completed');
    expect(bundle.winner).toBe('claude');
    expect(bundle.failedEngines).toEqual(['codex']);
    expect(bundle.exactFitnessCommand).toBe('npm test');
    expect(bundle.cleanupCommand).toContain('worktree prune');
    expect(bundle.worktrees[0]).toMatchObject({ cleanupPlanned: true, cleanupMode: 'best-effort-after-bundle' });
    expect(bundle.worktrees[0]).not.toHaveProperty('removedAfterRun');
    expect(manifest.resultBundlePath).toBe(bundlePath);
  });

  it('marks selected engines without output as terminal failed results', () => {
    const manifest = {
      forgeId: 'forge-test',
      forgeDir: '/tmp/forge-test',
      task: 'fix cli',
      fitnessCmd: 'npm test',
      timestamp: new Date().toISOString(),
      engines: ['claude', 'codex', 'gemini'],
      results: {
        codex: {
          engineId: 'codex',
          pass: true,
          score: 90,
          diffLines: 4,
          filesChanged: 1,
          durationSec: 3,
          lintWarnings: 0,
          styleScore: 100,
        },
      },
      patches: {},
      winner: 'codex',
      closeCall: false,
      stage1Accepted: false,
      baselinePasses: false,
      starter: 'parallel',
      enginesDispatched: 1,
    } as any;

    completeMissingForgeResults(manifest, manifest.engines, 'aborted');

    expect(manifest.enginesDispatched).toBe(3);
    expect(manifest.results.codex.pass).toBe(true);
    expect(manifest.results.claude).toMatchObject({
      engineId: 'claude',
      pass: false,
      score: 0,
      dispatchStdout: 'ERROR: aborted',
    });
    expect(manifest.results.gemini.pass).toBe(false);
  });
});
