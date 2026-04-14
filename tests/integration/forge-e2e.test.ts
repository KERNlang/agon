import { describe, it, expect, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { DispatchOptions, DispatchResult, EngineAdapter, EngineDefinition } from '../../packages/core/src/types.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function createRepo(label: string): string {
  const repoDir = join(tmpdir(), `agon-forge-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init']);
  git(repoDir, ['config', 'user.name', 'Agon Test']);
  git(repoDir, ['config', 'user.email', 'agon@example.com']);
  writeFileSync(join(repoDir, 'README.md'), '# Forge E2E\n');
  writeFileSync(join(repoDir, '.agon.json'), JSON.stringify({
    forgeAutoAcceptScore: 101,
    forgeEnableSynthesis: false,
    forgeRequireBaselineCheck: false,
    ratingsEnabled: false,
  }, null, 2) + '\n');
  git(repoDir, ['add', '.']);
  git(repoDir, ['commit', '-m', 'initial']);
  return repoDir;
}

function createFakeNpx(): { binDir: string; originalPath: string } {
  const binDir = join(tmpdir(), `agon-fake-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(binDir, { recursive: true });
  const npxPath = join(binDir, 'npx');
  writeFileSync(npxPath, '#!/bin/sh\nexit 0\n');
  chmodSync(npxPath, 0o755);
  const originalPath = process.env.PATH ?? '';
  process.env.PATH = `${binDir}:${originalPath}`;
  return { binDir, originalPath };
}

function makeEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: true,
    tier: 'user',
    binary: 'sh',
    timeout: 30,
    exec: { args: [] },
    review: { args: [] },
  } as EngineDefinition;
}

function createDeterministicAdapter(): EngineAdapter {
  const dispatch = async (options: DispatchOptions): Promise<DispatchResult> => {
    const content = options.engine.id === 'winner'
      ? 'export function hello() { return "world"; }\n'
      : 'export function hello() { return "nope"; }\n';
    writeFileSync(join(options.cwd, 'generated.ts'), content);
    return {
      exitCode: 0,
      stdout: `engine ${options.engine.id} wrote generated.ts`,
      stderr: '',
      durationMs: 1,
      timedOut: false,
    };
  };

  return {
    dispatch,
    isAvailable: async () => true,
    getVersion: async () => 'test',
  };
}

describe('Forge E2E', () => {
  it('runs the real forge loop and persists the winning manifest and patch', async () => {
    const agonHome = setupTestAgonHome('forge-e2e');
    const repoDir = createRepo('repo');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('loser'));
      registry.register(makeEngine('winner'));

      const manifest = await runForge({
        task: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['loser', 'winner'],
        starter: 'loser',
      }, registry, createDeterministicAdapter());

      expect(manifest.winner).toBe('winner');
      expect(manifest.enginesDispatched).toBe(2);
      expect(Object.keys(manifest.results).sort()).toEqual(['loser', 'winner']);
      expect(manifest.results.loser?.pass).toBe(false);
      expect(manifest.results.winner?.pass).toBe(true);

      const winnerPatchPath = manifest.patches.winner;
      expect(winnerPatchPath).toBeTruthy();
      expect(existsSync(winnerPatchPath!)).toBe(true);
      expect(readFileSync(winnerPatchPath!, 'utf-8')).toContain('return "world"');

      const manifestPath = join(forgeDir, 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      expect(readFileSync(manifestPath, 'utf-8')).toContain('"winner": "winner"');

      const historyPath = agonHomePath('runs', `${manifest.forgeId}.json`);
      expect(existsSync(historyPath)).toBe(true);
      expect(readFileSync(historyPath, 'utf-8')).toContain('"winner": "winner"');
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });
});
