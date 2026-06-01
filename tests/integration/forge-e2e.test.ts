import { describe, it, expect, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Forge E2E', () => {
  it('links dependencies into external worktrees while preserving workspace packages', async () => {
    const repoDir = createRepo('worktree-node-modules');
    const worktreePath = join(tmpdir(), `agon-forge-worktree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const kernModuleDir = join(repoDir, 'node_modules', '@kernlang', 'core');
    const agonScopeDir = join(repoDir, 'node_modules', '@agon');
    const agonPackageDir = join(repoDir, 'packages', 'core');

    writeFileSync(join(repoDir, '.gitignore'), 'node_modules/\npackages/*/dist/\n');
    mkdirSync(agonPackageDir, { recursive: true });
    writeFileSync(join(agonPackageDir, 'package.json'), JSON.stringify({
      name: '@kernlang/agon-core',
      version: '0.0.0-test',
      exports: { '.': './dist/index.js' },
    }) + '\n');
    git(repoDir, ['add', '.gitignore']);
    git(repoDir, ['add', 'packages/core/package.json']);
    git(repoDir, ['commit', '-m', 'ignore node modules']);
    mkdirSync(join(agonPackageDir, 'dist'), { recursive: true });
    writeFileSync(join(agonPackageDir, 'dist', 'index.js'), 'export const hydrated = true;\n');
    mkdirSync(kernModuleDir, { recursive: true });
    writeFileSync(join(kernModuleDir, 'package.json'), JSON.stringify({ name: '@kernlang/core', version: '0.0.0-test' }) + '\n');
    mkdirSync(agonScopeDir, { recursive: true });
    symlinkSync('../../packages/core', join(agonScopeDir, 'core'), 'dir');

    try {
      vi.resetModules();
      const { worktreeCreate, headSha } = await import('../../packages/core/src/index.js');
      worktreeCreate(repoDir, worktreePath, headSha(repoDir));

      const linkedNodeModules = join(worktreePath, 'node_modules');
      const linkedKernScope = join(linkedNodeModules, '@kernlang');
      const linkedAgonCore = join(linkedNodeModules, '@agon', 'core');
      const hydratedDist = join(worktreePath, 'packages', 'core', 'dist', 'index.js');
      expect(existsSync(linkedNodeModules)).toBe(true);
      expect(lstatSync(linkedNodeModules).isDirectory()).toBe(true);
      expect(lstatSync(linkedKernScope).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkedKernScope)).toBe(join(repoDir, 'node_modules', '@kernlang'));
      expect(lstatSync(linkedAgonCore).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkedAgonCore)).toBe(join(worktreePath, 'packages', 'core'));
      expect(existsSync(hydratedDist)).toBe(true);
      expect(lstatSync(join(worktreePath, 'packages', 'core', 'dist')).isSymbolicLink()).toBe(false);
      expect(readFileSync(hydratedDist, 'utf-8')).toContain('hydrated');
    } finally {
      try { git(repoDir, ['worktree', 'remove', worktreePath, '--force']); } catch { /* best effort */ }
      try { git(repoDir, ['worktree', 'prune']); } catch { /* best effort */ }
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

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

  it('persists an initial manifest before dispatch work', async () => {
    const agonHome = setupTestAgonHome('forge-initial-manifest');
    const repoDir = createRepo('initial-manifest');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('starter'));

      const manifest = await runForge({
        task: 'Dry-run manifest probe',
        fitnessCmd: 'true',
        cwd: repoDir,
        forgeDir,
        engines: ['starter'],
        starter: 'starter',
        dryRun: true,
      }, registry, createDeterministicAdapter());

      const manifestPath = join(forgeDir, 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      const saved = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(saved.forgeId).toBe(manifest.forgeId);
      expect(saved.engines).toEqual(['starter']);
      expect(saved.enginesDispatched).toBe(0);
      expect(saved.dispatchLog).toEqual([]);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('still dispatches engines when the baseline fitness already passes', async () => {
    const agonHome = setupTestAgonHome('forge-baseline-pass-dispatch');
    const repoDir = createRepo('baseline-pass-dispatch');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();

    writeFileSync(join(repoDir, '.agon.json'), JSON.stringify({
      forgeAutoAcceptScore: 101,
      forgeEnableSynthesis: false,
      forgeRequireBaselineCheck: true,
      ratingsEnabled: false,
    }, null, 2) + '\n');

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('loser'));
      registry.register(makeEngine('winner'));

      const manifest = await runForge({
        task: 'Improve generated output even though the broad fitness already passes',
        fitnessCmd: 'true',
        cwd: repoDir,
        forgeDir,
        engines: ['loser', 'winner'],
        starter: 'loser',
      }, registry, createDeterministicAdapter());

      expect(manifest.baselinePasses).toBe(true);
      expect(manifest.alreadySatisfied).not.toBe(true);
      expect(manifest.enginesDispatched).toBeGreaterThan(0);
      expect(Object.keys(manifest.results).length).toBeGreaterThan(0);
      const saved = JSON.parse(readFileSync(join(forgeDir, 'manifest.json'), 'utf-8'));
      expect(saved.baselinePasses).toBe(true);
      expect(saved.enginesDispatched).toBeGreaterThan(0);
    } finally {
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      cleanupTestAgonHome(agonHome);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('persists completed stage2 engine results while slower engines are still running', async () => {
    const agonHome = setupTestAgonHome('forge-partial-stage2-manifest');
    const repoDir = createRepo('partial-stage2-manifest');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('fast'));
      registry.register(makeEngine('slow'));
      const adapter: EngineAdapter = {
        dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
          if (options.engine.id === 'slow') await slowGate;
          writeFileSync(join(options.cwd, 'generated.ts'), `export const engine = "${options.engine.id}";\n`);
          return { exitCode: 0, stdout: `${options.engine.id} done`, stderr: '', durationMs: 1, timedOut: false };
        },
        isAvailable: async () => true,
        getVersion: async () => 'test',
      };

      const forgePromise = runForge({
        task: 'write generated file',
        fitnessCmd: 'test -f generated.ts',
        cwd: repoDir,
        forgeDir,
        engines: ['fast', 'slow'],
      }, registry, adapter);

      let partial: any = null;
      for (let i = 0; i < 40; i++) {
        if (existsSync(join(forgeDir, 'manifest.json'))) {
          partial = JSON.parse(readFileSync(join(forgeDir, 'manifest.json'), 'utf-8'));
          if (partial.results?.fast) break;
        }
        await sleep(50);
      }

      expect(partial?.results?.fast?.pass).toBe(true);
      expect(partial?.enginesDispatched).toBeGreaterThanOrEqual(1);

      releaseSlow();
      const manifest = await forgePromise;
      expect(manifest.results.fast.pass).toBe(true);
      expect(manifest.results.slow.pass).toBe(true);
    } finally {
      releaseSlow?.();
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      cleanupTestAgonHome(agonHome);
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('surfaces synthesis completion when critics return no structured critiques', async () => {
    const agonHome = setupTestAgonHome('forge-synthesis-no-critiques');
    const repoDir = createRepo('synthesis-no-critiques');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    writeFileSync(join(repoDir, '.agon.json'), JSON.stringify({
      forgeAutoAcceptScore: 101,
      forgeClearWinnerSpread: 8,
      forgeEnableSynthesis: true,
      forgeRequireBaselineCheck: false,
      ratingsEnabled: false,
    }, null, 2) + '\n');
    git(repoDir, ['add', '.agon.json']);
    git(repoDir, ['commit', '-m', 'enable synthesis']);

    const events: any[] = [];
    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        if (options.mode === 'review') {
          return { exitCode: 0, stdout: 'No obvious issues.', stderr: '', durationMs: 1, timedOut: false };
        }
        writeFileSync(join(options.cwd, 'generated.ts'), `export const engine = "${options.engine.id}";\n`);
        return { exitCode: 0, stdout: `${options.engine.id} done`, stderr: '', durationMs: 1, timedOut: false };
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    try {
      vi.resetModules();
      const { EngineRegistry } = await import('../../packages/core/src/index.js');
      const { runForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('alpha'));
      registry.register(makeEngine('beta'));

      const manifest = await runForge({
        task: 'write generated file',
        fitnessCmd: 'test -f generated.ts',
        cwd: repoDir,
        forgeDir,
        engines: ['alpha', 'beta'],
      }, registry, adapter, (event: any) => events.push(event));

      expect(manifest.closeCall).toBe(true);
      expect(manifest.synthesis?.reason).toBe('no-structured-critiques');
      expect(manifest.synthesis?.pass).toBe(true);
      expect(manifest.synthesis?.score).toBe(manifest.results[manifest.winner!]?.score);
      expect(manifest.synthesis?.patchPath).toBe(manifest.patches[manifest.winner!]);
      expect(events.some((event) => event.type === 'synthesis:start')).toBe(true);
      expect(events.some((event) => event.type === 'synthesis:done' && event.data?.reason === 'no-structured-critiques')).toBe(true);

      const sidechainPath = JSON.parse(readFileSync(join(forgeDir, 'result.json'), 'utf-8')).logs.sidechain;
      const sidechain = readFileSync(sidechainPath, 'utf-8');
      expect(sidechain).toContain('"type":"synthesis:start"');
      expect(sidechain).toContain('"reason":"no-structured-critiques"');
    } finally {
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      cleanupTestAgonHome(agonHome);
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
    const modes: Array<{ engineId: string; mode: string }> = [];

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        modes.push({ engineId: options.engine.id, mode: options.mode });
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
      expect(events.some((e) => e.type === 'stage1:start')).toBe(false);
      expect(events.filter((e) => e.type === 'engine:worktree').map((e) => e.engineId).sort()).toEqual(['starter', 'winner']);
      expect(modes.map((entry) => `${entry.engineId}:${entry.mode}`).sort()).toEqual(['starter:exec', 'winner:exec']);
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('does not retry a failed starter on an engine outside the active forge roster', async () => {
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

      expect(manifest.winner).toBe(null);
      expect(manifest.results.starter?.pass).toBe(false);
      expect(manifest.results.backup).toBeUndefined();
      expect(events.some((e) => e.type === 'engine:fallback' && e.data?.to === 'backup')).toBe(false);
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('continues challengers when one stage2 engine fails', async () => {
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

  it('clears engine pid when a stage2 dispatch throws after spawning', async () => {
    const agonHome = setupTestAgonHome('forge-pid-clear-on-dispatch-error');
    const repoDir = createRepo('pid-clear-on-dispatch-error');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    const events: any[] = [];

    const adapter: EngineAdapter = {
      dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
        options.onSpawn?.(4242);
        if (options.engine.id === 'broken') throw new Error('engine crashed after spawn');
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
      registry.register(makeEngine('broken'));
      registry.register(makeEngine('winner'));

      const manifest = await runForge({
        task: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['broken', 'winner'],
        starter: 'broken',
      }, registry, adapter, (event) => events.push(event));

      expect(manifest.winner).toBe('winner');
      const pidIndex = events.findIndex((e) => e.type === 'engine:pid' && e.engineId === 'broken');
      const clearIndex = events.findIndex((e) => e.type === 'engine:pid-clear' && e.engineId === 'broken');
      expect(pidIndex).toBeGreaterThanOrEqual(0);
      expect(clearIndex).toBeGreaterThan(pidIndex);
      expect(events.some((e) => e.type === 'engine:failed' && e.engineId === 'broken')).toBe(true);
    } finally {
      cleanupTestAgonHome(agonHome);
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('reports a missing worktree as a clear fitness failure', async () => {
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const missingWorktree = join(tmpdir(), `agon-missing-worktree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(forgeDir, { recursive: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runFitness } = await import('../../packages/forge/src/index.js');
      const result = await runFitness({
        engineId: 'missing',
        worktreePath: missingWorktree,
        fitnessCmd: 'true',
        timeout: 1,
        forgeDir,
      });

      expect(result.pass).toBe(false);
      expect(result.score).toBe(0);
      expect(result.diffLines).toBe(0);
      expect(result.filesChanged).toBe(0);
      expect(result.patchPath).toBeTruthy();
      expect(readFileSync(result.patchPath!, 'utf-8')).toBe('');
      expect(result.fitnessLogPath).toBeTruthy();
      expect(readFileSync(result.fitnessLogPath!, 'utf-8')).toContain('Worktree missing before fitness');
    } finally {
      warnSpy.mockRestore();
      rmSync(forgeDir, { recursive: true, force: true });
      rmSync(missingWorktree, { recursive: true, force: true });
    }
  });

  it('fails no-op forge candidates even when the fitness command passes', async () => {
    const repoDir = createRepo('noop-fitness');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    mkdirSync(forgeDir, { recursive: true });

    try {
      vi.resetModules();
      const { runFitness } = await import('../../packages/forge/src/index.js');
      const candidate = await runFitness({
        engineId: 'noop',
        worktreePath: repoDir,
        fitnessCmd: 'true',
        timeout: 1,
        forgeDir,
      });
      const baseline = await runFitness({
        engineId: 'baseline',
        worktreePath: repoDir,
        fitnessCmd: 'true',
        timeout: 1,
        forgeDir,
      });

      expect(candidate.pass).toBe(false);
      expect(candidate.score).toBe(0);
      expect(candidate.diffLines).toBe(0);
      expect(readFileSync(candidate.fitnessLogPath!, 'utf-8')).toContain('Diff gate: failed - no candidate changes');
      expect(baseline.pass).toBe(true);
      expect(readFileSync(baseline.fitnessLogPath!, 'utf-8')).toContain('Diff gate: not required for baseline');
    } finally {
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });

  it('scores a timed-out engine when it left a valid candidate diff', async () => {
    const repoDir = createRepo('timeout-harvest');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(forgeDir, { recursive: true });

    try {
      vi.resetModules();
      const { EngineRegistry, headSha } = await import('../../packages/core/src/index.js');
      const { runStage2 } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('slow-writer'));
      const adapter: EngineAdapter = {
        dispatch: async (options: DispatchOptions): Promise<DispatchResult> => {
          writeFileSync(join(options.cwd, 'generated.ts'), 'export function hello() { return "world"; }\n');
          return {
            exitCode: 124,
            stdout: 'wrote generated.ts before timeout',
            stderr: 'Turn timed out',
            durationMs: 1,
            timedOut: true,
          };
        },
        isAvailable: async () => true,
        getVersion: async () => 'test',
      };

      const stage = await runStage2({
        challengers: ['slow-writer'],
        forgePrompt: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        config: {
          forgeTimeout: 1,
          forgeFitnessTimeout: 1,
          forgeAutoAcceptScore: 101,
        } as any,
        registry,
        adapter,
        cwd: repoDir,
        baseSha: headSha(repoDir),
        forgeDir,
        existingResults: new Map(),
        worktrees: [],
      });

      const result = stage.engineResults.get('slow-writer');
      expect(result?.pass).toBe(true);
      expect(result?.diffLines).toBeGreaterThan(0);
      expect(readFileSync(result!.patchPath!, 'utf-8')).toContain('return "world"');
      expect(result?.dispatchStdout).toContain('harvesting candidate worktree');
    } finally {
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

  it('routes API-only team forge implementers through the tool-using agent loop', async () => {
    const agonHome = setupTestAgonHome('team-forge-api-agent');
    const repoDir = createRepo('team-forge-api-agent');
    const forgeDir = join(tmpdir(), `agon-team-forge-api-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    const previousApiKey = process.env.AGON_TEST_FORGE_API_KEY;
    process.env.AGON_TEST_FORGE_API_KEY = 'test-key';

    const dispatch = vi.fn(async (options: DispatchOptions): Promise<DispatchResult> => {
      if (options.mode !== 'review') {
        throw new Error('plain dispatch must not implement API-only team forge work');
      }
      return { exitCode: 0, stdout: 'Plan: write team.ts', stderr: '', durationMs: 1, timedOut: false };
    });
    const dispatchAgent = vi.fn(async (options: DispatchOptions) => {
      const content = options.engine.id === 'api-winner'
        ? 'export const value = "world";\n'
        : 'export const value = "nope";\n';
      writeFileSync(join(options.cwd, 'team.ts'), content);
      return {
        exitCode: 0,
        stdout: 'agent implemented team.ts',
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
      const { runTeamForge } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeApiEngine('api-winner'));
      registry.register(makeApiEngine('api-loser'));

      const result = await runTeamForge({
        task: 'Create team.ts that returns world',
        fitnessCmd: `grep -q '"world"' team.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['api-winner', 'api-loser'],
        membersPerSide: 1,
        composeMode: 'explicit',
        explicitTeams: [['api-winner'], ['api-loser']],
        maxReviewLoops: 0,
      }, registry, adapter);

      expect(dispatch).toHaveBeenCalled();
      expect(dispatch.mock.calls.every(([options]) => options.mode === 'review')).toBe(true);
      expect(dispatchAgent).toHaveBeenCalledTimes(2);
      expect(result.winnerTeamId).toBeTruthy();
      const winnerOutput = result.submissions[result.winnerTeamId!].finalOutput as any;
      expect(winnerOutput.pass).toBe(true);
      expect(readFileSync(winnerOutput.patchPath, 'utf-8')).toContain('team.ts');
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

  it('does not rank empty brainstorm replies as usable drafts', async () => {
    const agonHome = setupTestAgonHome('brainstorm-empty-draft');
    const outputDir = join(tmpdir(), `agon-brainstorm-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });

    const adapter: EngineAdapter = {
      dispatch: async (options): Promise<DispatchResult> => {
        if (options.prompt.includes('Multiple AI engines analyzed this')) {
          return { exitCode: 0, stdout: 'synthesized answer', stderr: '', durationMs: 1, timedOut: false };
        }
        if (options.engine.id === 'empty') {
          return { exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false };
        }
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
      registry.register(makeEngine('empty'));
      registry.register(makeEngine('solid'));

      const result = await runBrainstorm({
        question: 'How should jobs run?',
        engines: ['empty', 'solid'],
        registry,
        adapter,
        timeout: 5,
        outputDir,
      });

      expect(result.winner).toBe('solid');
      expect(result.response).toBe('synthesized answer');
      expect(result.bids.find((b) => b.engineId === 'empty')?.confidence).toBe(0);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('falls back to debate text when tribunal summary engine returns empty output', async () => {
    const agonHome = setupTestAgonHome('tribunal-empty-summary');
    const outputDir = join(tmpdir(), `agon-tribunal-empty-summary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });
    const callsByEngine = new Map<string, number>();

    const adapter: EngineAdapter = {
      dispatch: async (options): Promise<DispatchResult> => {
        const calls = (callsByEngine.get(options.engine.id) ?? 0) + 1;
        callsByEngine.set(options.engine.id, calls);
        if (options.engine.id === 'empty-summary' && calls > 1) {
          return { exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false };
        }
        return {
          exitCode: 0,
          stdout: `${options.engine.id} argues that the deterministic path should ship first.`,
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
      const { runTribunal } = await import('../../packages/forge/src/index.js');
      const registry = new EngineRegistry();
      registry.register(makeEngine('empty-summary'));
      registry.register(makeEngine('arguer'));

      const result = await runTribunal({
        question: 'Should we ship narrative reviews first?',
        engines: ['empty-summary', 'arguer'],
        rounds: 1,
        registry,
        adapter,
        timeout: 5,
        outputDir,
      });

      expect(result.summary).toContain('**empty-summary');
      expect(result.summary).toContain('deterministic path should ship first');
      expect(result.rounds[0].positions).toHaveLength(2);
    } finally {
      cleanupTestAgonHome(agonHome);
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('runs multiline node -e fitness checks that contain markdown fences', async () => {
    const repoDir = createRepo('node-e-markdown-fence');
    const forgeDir = join(tmpdir(), `agon-forge-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeNpx = createFakeNpx();
    mkdirSync(forgeDir, { recursive: true });

    try {
      writeFileSync(join(repoDir, 'README.md'), [
        '# Agon',
        '',
        '```bash',
        'agon forge "fix it"',
        '```',
        '',
      ].join('\n'));

      vi.resetModules();
      const { runFitness } = await import('../../packages/forge/src/index.js');
      const result = await runFitness({
        engineId: 'candidate',
        worktreePath: repoDir,
        fitnessCmd: 'node -e "\n'
          + "const fs = require('fs');\n"
          + "const content = fs.readFileSync('README.md', 'utf8');\n"
          + "if (!content.includes('```bash')) process.exit(1);\n"
          + 'console.log("Score: 100");\n'
          + '"',
        timeout: 1,
        forgeDir,
      });

      expect(result.pass).toBe(true);
      expect(readFileSync(result.fitnessLogPath!, 'utf-8')).toContain('Score: 100');
    } finally {
      process.env.PATH = fakeNpx.originalPath;
      rmSync(fakeNpx.binDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(forgeDir, { recursive: true, force: true });
    }
  });
});
