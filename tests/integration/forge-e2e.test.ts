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

function makeApiEngine(id: string): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: false,
    tier: 'user',
    timeout: 30,
    api: {
      baseUrl: 'https://example.invalid/v1',
      apiKeyEnv: 'AGON_TEST_FORGE_API_KEY',
      model: id,
      format: 'openai',
    },
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

  it('routes API-only forge engines through the tool-using agent loop', async () => {
    const agonHome = setupTestAgonHome('forge-api-agent');
    const repoDir = createRepo('api-agent');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    const previousApiKey = process.env.AGON_TEST_FORGE_API_KEY;
    process.env.AGON_TEST_FORGE_API_KEY = 'test-key';

    const dispatch = vi.fn(async (): Promise<DispatchResult> => {
      throw new Error('plain dispatch must not handle API-only forge engines');
    });
    const dispatchAgent = vi.fn(async (options: DispatchOptions) => {
      writeFileSync(join(options.cwd, 'generated.ts'), 'export function hello() { return "world"; }\n');
      return {
        exitCode: 0,
        stdout: 'agent edited generated.ts',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        diff: '',
        diffLines: 0,
        filesChanged: 1,
      };
    });

    const adapter: EngineAdapter = {
      dispatch,
      dispatchAgent,
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeApiEngine('api-coder'));

      const manifest = await runForge({
        task: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['api-coder'],
        starter: 'api-coder',
      }, registry, adapter);

      expect(dispatch).not.toHaveBeenCalled();
      expect(dispatchAgent).toHaveBeenCalledOnce();
      expect(manifest.winner).toBe('api-coder');
      expect(manifest.results['api-coder']?.pass).toBe(true);
      expect(readFileSync(manifest.patches['api-coder']!, 'utf-8')).toContain('generated.ts');
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      if (previousApiKey === undefined) delete process.env.AGON_TEST_FORGE_API_KEY;
      else process.env.AGON_TEST_FORGE_API_KEY = previousApiKey;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('captures patch changes generated by the fitness command', async () => {
    const agonHome = setupTestAgonHome('forge-post-fitness-patch');
    const repoDir = createRepo('post-fitness-patch');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        writeFileSync(join(options.cwd, 'source.kern'), 'fn name=hello returns=string expr={{ return "world"; }}\n');
        return { exitCode: 0, stdout: 'wrote source.kern', stderr: '', durationMs: 1, timedOut: false };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('generator'));

      const manifest = await runForge({
        task: 'Create source.kern and generated output',
        fitnessCmd: `node -e "require('fs').writeFileSync('generated.ts', 'export const generated = true;\\\\n')" && test -f generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['generator'],
        starter: 'generator',
      }, registry, adapter);

      const patch = readFileSync(manifest.patches.generator!, 'utf-8');
      expect(manifest.winner).toBe('generator');
      expect(patch).toContain('source.kern');
      expect(patch).toContain('generated.ts');
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('continues to challengers when the starter dispatch fails', async () => {
    const agonHome = setupTestAgonHome('forge-starter-fails');
    const repoDir = createRepo('starter-fails');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    const events: any[] = [];

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.engine.id === 'starter') throw new Error('starter unavailable');
        writeFileSync(join(options.cwd, 'generated.ts'), 'export const value = "world";\n');
        return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, timedOut: false };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('starter'));
      registry.register(makeEngine('winner'));

      const manifest = await runForge({
        task: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['starter', 'winner'],
        starter: 'starter',
      }, registry, adapter, (event) => events.push(event));

      expect(manifest.winner).toBe('winner');
      expect(manifest.results.starter?.pass).toBe(false);
      expect(manifest.results.winner?.pass).toBe(true);
      expect(events.some((e) => e.type === 'engine:failed' && e.engineId === 'starter')).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('retries a failed starter on a fallback engine outside the forge roster', async () => {
    const agonHome = setupTestAgonHome('forge-starter-fallback');
    const repoDir = createRepo('starter-fallback');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    const events: any[] = [];

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.engine.id === 'starter') throw new Error('starter unavailable');
        writeFileSync(join(options.cwd, 'generated.ts'), 'export const value = "world";\n');
        return { exitCode: 0, stdout: `ok from ${options.engine.id}`, stderr: '', durationMs: 1, timedOut: false };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('starter'));
      registry.register(makeEngine('backup'));

      const manifest = await runForge({
        task: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['starter'],
        starter: 'starter',
      }, registry, adapter, (event) => events.push(event));

      expect(manifest.winner).toBe('backup');
      expect(manifest.results.starter?.pass).toBe(false);
      expect(manifest.results.backup?.pass).toBe(true);
      expect(events.some((e) => e.type === 'engine:fallback' && e.data?.to === 'backup')).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('continues followers when the peek scout fails', async () => {
    const agonHome = setupTestAgonHome('forge-scout-fails');
    const repoDir = createRepo('scout-fails');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.engine.id === 'scout') throw new Error('scout crashed');
        const content = options.engine.id === 'winner'
          ? 'export const value = "world";\n'
          : 'export const value = "nope";\n';
        writeFileSync(join(options.cwd, 'generated.ts'), content);
        return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, timedOut: false };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('starter'));
      registry.register(makeEngine('scout'));
      registry.register(makeEngine('winner'));

      const manifest = await runForge({
        task: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['starter', 'scout', 'winner'],
        starter: 'starter',
      }, registry, adapter);

      expect(manifest.winner).toBe('winner');
      expect(manifest.results.scout?.pass).toBe(false);
      expect(manifest.results.winner?.pass).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('bases forge worktrees on dirty tracked changes', async () => {
    const agonHome = setupTestAgonHome('forge-dirty-base');
    const repoDir = createRepo('dirty-base');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();

    writeFileSync(join(repoDir, 'source.txt'), 'old\n');
    git(repoDir, ['add', 'source.txt']);
    git(repoDir, ['commit', '-m', 'add source']);
    writeFileSync(join(repoDir, 'source.txt'), 'dirty\n');

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        const source = readFileSync(join(options.cwd, 'source.txt'), 'utf-8');
        writeFileSync(join(options.cwd, 'seen.txt'), source);
        return { exitCode: 0, stdout: source, stderr: '', durationMs: 1, timedOut: false };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('reader'));

      const manifest = await runForge({
        task: 'Copy source.txt to seen.txt',
        fitnessCmd: 'grep -q dirty seen.txt',
        cwd: repoDir,
        forgeDir,
        engines: ['reader'],
        starter: 'reader',
      }, registry, adapter);

      expect(manifest.winner).toBe('reader');
      expect(manifest.results.reader?.pass).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('persists a patch artifact for the winning team forge submission', async () => {
    const agonHome = setupTestAgonHome('team-forge-patch');
    const repoDir = createRepo('team-forge');
    const forgeDir = join(tmpdir(), `agon-team-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.mode === 'review') {
          return { exitCode: 0, stdout: 'APPROVED', stderr: '', durationMs: 1, timedOut: false };
        }
        const content = options.engine.id === 'winner'
          ? 'export const value = "world";\n'
          : 'export const value = "nope";\n';
        writeFileSync(join(options.cwd, 'team.ts'), content);
        return { exitCode: 0, stdout: 'implemented', stderr: '', durationMs: 1, timedOut: false };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runTeamForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('loser'));
      registry.register(makeEngine('winner'));

      const result = await runTeamForge({
        task: 'Create team.ts that returns world',
        fitnessCmd: `grep -q '"world"' team.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['loser', 'winner'],
        membersPerSide: 1,
        composeMode: 'explicit',
        explicitTeams: [['winner'], ['loser']],
        maxReviewLoops: 0,
      }, registry, adapter);

      expect(result.winnerTeamId).toBeTruthy();
      const winnerOutput = result.submissions[result.winnerTeamId!].finalOutput as any;
      expect(winnerOutput.patchPath).toBeTruthy();
      expect(existsSync(winnerOutput.patchPath)).toBe(true);
      expect(readFileSync(winnerOutput.patchPath, 'utf-8')).toContain('team.ts');
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('returns brainstorm drafts when final synthesis dispatch fails', async () => {
    const agonHome = setupTestAgonHome('brainstorm-fallback');
    const outputDir = join(tmpdir(), `agon-brainstorm-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });
    let calls = 0;

    const adapter: EngineAdapter = {
      dispatch: async (): Promise<DispatchResult> => {
        calls++;
        if (calls > 1) throw new Error('synthesis failed');
        return {
          exitCode: 0,
          stdout: JSON.stringify({ approach: 'Use a queue', reasoning: 'It decouples work', confidence: 80 }),
          stderr: '',
          durationMs: 1,
          timedOut: false,
        };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runBrainstorm } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('thinker'));

      const result = await runBrainstorm({
        question: 'How should jobs run?',
        engines: ['thinker'],
        registry,
        adapter,
        timeout: 5,
        outputDir,
      });

      expect(result.winner).toBe('thinker');
      expect(result.response).toContain('Brainstorm synthesis failed');
      expect(result.bids[0].engineId).toBe('thinker');
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
