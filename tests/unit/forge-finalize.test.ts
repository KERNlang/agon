import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineRegistry } from '../../packages/core/src/signals/engine-registry.js';
import { runForge } from '../../packages/forge/src/forge.js';
import { createForgeWorkflow } from '@kernlang/agon-mod-forge';
import { createForgeWorkflowEffects, estimateCostCacheAware } from '@kernlang/agon-core';
import * as kernel from '@kernlang/agon-kernel';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

vi.mock('../../packages/forge/src/quality.js', () => ({
  runLint: vi.fn(async () => 0),
  runStyleCheck: vi.fn(async () => 100),
  // Test fixtures write plain .txt files; the real runSyntaxCheck would
  // return the same shape (skip-by-extension), but mocking keeps the
  // unit test independent of the tree-sitter Python sidecar install.
  runSyntaxCheck: vi.fn(() => ({ errors: 0, invalidFiles: [] })),
}));

const tempDirs: string[] = [];
// This suite checks finalize policy, not subprocess speed. Keep fitness within
// the test budget without treating full-suite scheduling delay as cancellation.
const FITNESS_TIMEOUT_SECONDS = 5;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.AGON_FINALIZE_TEST_KEY;
});

function makeRepo(): string {
  const dir = join(tmpdir(), `agon-forge-finalize-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# Finalize test\n');
  writeFileSync(join(dir, '.agon.json'), JSON.stringify({
    forgeRequireBaselineCheck: false,
    forgeEnableSynthesis: false,
    forgeDispatchTimeout: 480,
    forgeFitnessTimeout: FITNESS_TIMEOUT_SECONDS,
  }, null, 2));
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

function makeRegistry(): EngineRegistry {
  const registry = new EngineRegistry();
  for (const id of ['fast', 'slow']) {
    registry.register({
      id,
      displayName: id,
      api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
      timeout: 120,
      tier: 'user',
      schemaVersion: 3,
      isLocal: false,
      exec: { args: [] },
      review: { args: [] },
    } as any);
  }
  return registry;
}

describe('forge validate dispatch routing', () => {
  it.each([true, false])('completes Forge with Ratings available=%s', async enabled => {
    const home = setupTestAgonHome('forge-optional-ratings');
    const selected = new kernel.ModRegistry({ generation: 'forge-ratings-selection',
      activeOwners: enabled ? [{ id: 'agon.ratings', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }] : [],
    });
    try {
      process.env.AGON_FINALIZE_TEST_KEY = 'test';
      const repoDir = makeRepo();
      const effects = createForgeWorkflowEffects();
      const seedNewEnginesFromRegistry = vi.fn();
      const assignForgeRoles = vi.fn(() => new Map([
        ['fast', { role: 'lead', specialization: 'rating-derived fixture' }],
        ['slow', { role: 'challenger', specialization: 'rating-derived fixture' }],
      ]));
      const updateGlickoRanked = vi.fn();
      const buildSpecializedPrompt = vi.fn((_id: string, _task: string, prompt: string) =>
        prompt + '\nengine-defined specialization');
      const workflow = createForgeWorkflow({ ...effects,
        loadConfig: cwd => ({ ...effects.loadConfig(cwd), ratingsEnabled: true }),
        seedNewEnginesFromRegistry, assignForgeRoles, updateGlickoRanked, buildSpecializedPrompt,
      });
      const prompts: string[] = [];
      await selected.runWithInvocationScope(async () => {
        const manifest = await workflow.runForge({ task: 'write files', fitnessCmd: 'true',
          cwd: repoDir, forgeDir: join(repoDir, 'ratings-run'), engines: ['fast', 'slow'],
          healthCheckEnabled: false,
        }, makeRegistry(), {
          isAvailable: async () => true, getVersion: async () => 'fixture',
          dispatch: async ({ engine, cwd, prompt }) => {
            prompts.push(prompt);
            writeFileSync(join(cwd, `${engine.id}.txt`), 'work\n');
            return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, durationMs: 1 };
          },
        });
        expect(manifest.status).toBe('completed');
        expect(Object.values(manifest.results).every(result => result.pass)).toBe(true);
        expect(Object.keys(manifest.results).sort()).toEqual(['fast', 'slow']);
        expect(seedNewEnginesFromRegistry).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(assignForgeRoles).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(updateGlickoRanked).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(buildSpecializedPrompt).toHaveBeenCalledTimes(2);
        expect(prompts).toHaveLength(2);
        for (const prompt of prompts) {
          expect(prompt).toContain('engine-defined specialization');
          expect(prompt.includes('rating-derived fixture')).toBe(enabled);
        }
        const memory = JSON.parse(readFileSync(join(home, 'engine-memory.json'), 'utf8'));
        for (const engine of ['fast', 'slow']) {
          expect(memory.engines[engine].notes).toEqual(expect.arrayContaining([
            expect.objectContaining({ forgeId: manifest.forgeId }),
          ]));
        }
      });
    } finally {
      cleanupTestAgonHome(home);
    }
  });

  it('uses plain dispatch, not agent tools, for validate mode without required diff', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-forge-validate-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const registry = new EngineRegistry();
    registry.register({
      id: 'api-agent',
      displayName: 'api-agent',
      api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
      agent: { args: [] },
      exec: { args: [] },
      review: { args: [] },
      timeout: 120,
      tier: 'user',
      schemaVersion: 3,
      isLocal: false,
    } as any);

    const dispatch = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'VALIDATE_ROUTE_OK '.repeat(8),
      stderr: '',
      timedOut: false,
    }));
    const dispatchAgent = vi.fn(async () => {
      throw new Error('dispatchAgent should not run for validate/no-diff');
    });

    const manifest = await runForge(
      {
        task: 'validate without editing',
        fitnessCmd: 'true',
        cwd: repoDir,
        forgeDir,
        engines: ['api-agent'],
        mode: 'validate',
        requireDiff: false,
        acceptReviewOutput: true,
        baselineMayPass: true,
        healthCheckEnabled: false,
      } as any,
      registry,
      { isAvailable: async () => true, getVersion: async () => 'test', dispatch, dispatchAgent } as any,
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatchAgent).not.toHaveBeenCalled();
    expect(manifest.results['api-agent']).toMatchObject({ pass: true, status: 'no_diff_but_report' });
  });

  it('still uses agent tools for validate mode when a diff is required', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-forge-validate-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const registry = new EngineRegistry();
    registry.register({
      id: 'api-agent',
      displayName: 'api-agent',
      api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
      agent: { args: [] },
      exec: { args: [] },
      review: { args: [] },
      timeout: 120,
      tier: 'user',
      schemaVersion: 3,
      isLocal: false,
    } as any);

    const dispatch = vi.fn(async () => ({ exitCode: 0, stdout: 'plain', stderr: '', timedOut: false }));
    const dispatchAgent = vi.fn(async ({ cwd }: any) => {
      writeFileSync(join(cwd, 'agent-change.txt'), 'changed by agent\n');
      return { exitCode: 0, stdout: 'agent changed files', stderr: '', timedOut: false };
    });

    const manifest = await runForge(
      {
        task: 'validate but require a diff',
        fitnessCmd: 'test -f agent-change.txt',
        cwd: repoDir,
        forgeDir,
        engines: ['api-agent'],
        mode: 'validate',
        requireDiff: true,
        acceptReviewOutput: true,
        baselineMayPass: true,
        healthCheckEnabled: false,
      } as any,
      registry,
      { isAvailable: async () => true, getVersion: async () => 'test', dispatch, dispatchAgent } as any,
    );

    expect(dispatchAgent).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(manifest.results['api-agent']).toMatchObject({ pass: true });
  });
});

describe('forge rating write', () => {
  it('passes the identities its dispatches reported to the rating write', async () => {
    const home = setupTestAgonHome('forge-identity');
    try {
      process.env.AGON_FINALIZE_TEST_KEY = 'test';
      const repoDir = makeRepo();
      const forgeDir = join(tmpdir(), `agon-forge-identity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      tempDirs.push(forgeDir);
      mkdirSync(forgeDir, { recursive: true });
      const dispatch = vi.fn(async ({ engine }: any) => ({
        exitCode: 0, stdout: 'VALIDATE_ROUTE_OK '.repeat(8), stderr: '', timedOut: false, identity: `model-${engine.id}`,
      }));
      await runForge(
        {
          task: 'validate without editing', fitnessCmd: 'true', cwd: repoDir, forgeDir, engines: ['fast', 'slow'],
          mode: 'validate', requireDiff: false, acceptReviewOutput: true, baselineMayPass: true, healthCheckEnabled: false,
        } as any,
        makeRegistry(),
        { isAvailable: async () => true, getVersion: async () => 'test', dispatch } as any,
      );
      const stored = JSON.parse(readFileSync(join(home, 'ratings.json'), 'utf-8'));
      expect(stored.engineMeta.fast.identity).toBe('model-fast');
      expect(stored.engineMeta.slow.identity).toBe('model-slow');
    } finally {
      cleanupTestAgonHome(home);
    }
  });
});

describe('caller-driven forge finalize', () => {
  it.each([
    { engines: ['fast'], exitCode: 1 }, { engines: ['fast', 'slow'], exitCode: 1 },
    { engines: ['fast'], exitCode: 0 }, { engines: ['fast', 'slow'], exitCode: 0 },
  ])('retains usage when patch capture fails: %j', async ({ engines, exitCode }) => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(repoDir, 'capture-failure-run');
    const usage = { promptTokens: 1234, completionTokens: 56, totalTokens: 1290, source: 'sdk' as const };
    const manifest = await runForge({ task: 'write files', fitnessCmd: 'true',
      cwd: repoDir, forgeDir, engines, healthCheckEnabled: false,
    }, makeRegistry(), {
      isAvailable: async () => true, getVersion: async () => 'fixture',
      dispatch: async ({ engine, cwd }) => {
        writeFileSync(join(cwd, `${engine.id}.txt`), 'partial work\n');
        mkdirSync(join(forgeDir, `${engine.id}-patch.diff`));
        return { exitCode, stdout: 'partial response', stderr: 'transport failed',
          timedOut: false, durationMs: 1, usage };
      },
    });
    expect(manifest.winner).toBeNull();
    for (const engine of engines) {
      expect(manifest.results[engine].pass).toBe(false);
      const metrics = manifest.dispatchLog?.filter(metric => metric.engineId === engine) ?? [];
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokens).toMatchObject({ prompt: 1234, response: 56, source: 'sdk' });
      if (exitCode !== 0) {
        expect(metrics[0].error).toContain('transport failed');
        expect(metrics[0].error).toContain('patch capture failed');
      } else {
        expect(metrics[0].error).toContain('fitness failed');
      }
      expect(manifest.results[engine].patchPath).toBeUndefined();
    }
  });

  it.each(['sdk', 'cli-reported', 'estimated'] as const)('retains %s usage through the manifest and tracker', async (source) => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(repoDir, 'usage-run');
    const effects = createForgeWorkflowEffects();
    const record = vi.fn();
    const workflow = createForgeWorkflow({ ...effects, tracker: { ...effects.tracker, record,
      getStats: () => ({ totalTokens: 0, totalCostUsd: 0 }) } });
    const usage = { promptTokens: 12345, completionTokens: 789, totalTokens: 13140,
      cachedInputTokens: 10000, source };
    const manifest = await workflow.runForge({ task: 'write files', fitnessCmd: 'true',
      cwd: repoDir, forgeDir, engines: ['fast', 'slow'], healthCheckEnabled: false,
    }, makeRegistry(), {
      isAvailable: async () => true, getVersion: async () => 'fixture',
      dispatch: async ({ engine, cwd }) => {
        writeFileSync(join(cwd, `${engine.id}.txt`), 'work\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, durationMs: 1, usage };
      },
    });
    for (const engine of ['fast', 'slow']) {
      const metrics = manifest.dispatchLog?.filter(metric => metric.engineId === engine) ?? [];
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokens).toMatchObject({ prompt: 12345, response: 789,
        total: 13140, cachedInputTokens: 10000, source });
      expect(metrics[0].tokens?.costUsd).toBe(estimateCostCacheAware(engine, 12345, 789, 10000));
      expect(record).toHaveBeenCalledWith(engine, { usage });
    }
  });

  it.each([
    undefined,
    { promptTokens: -1, completionTokens: 1, totalTokens: 0, source: 'sdk' },
    { promptTokens: 1, completionTokens: NaN, totalTokens: 1, source: 'sdk' },
    { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedInputTokens: 2, source: 'sdk' },
    { promptTokens: 1, completionTokens: 1, totalTokens: 2, source: 'unknown' },
  ])('labels missing or malformed usage as estimated: %j', async (usage) => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const manifest = await runForge({ task: 'write file', fitnessCmd: 'true',
      cwd: repoDir, forgeDir: join(repoDir, 'usage-run'), engines: ['fast'], healthCheckEnabled: false,
    }, makeRegistry(), {
      isAvailable: async () => true, getVersion: async () => 'fixture',
      dispatch: async ({ cwd }) => {
        writeFileSync(join(cwd, 'work.txt'), 'work\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, durationMs: 1,
          usage: usage as any };
      },
    });
    expect(manifest.dispatchLog).toHaveLength(1);
    const tokens = manifest.dispatchLog![0].tokens!;
    expect(tokens.source).toBe('estimated');
    expect(tokens.prompt).toBeGreaterThan(0);
    expect(tokens.response).toBe(1);
    expect(tokens.total).toBe(tokens.prompt + tokens.response);
    expect(tokens.cachedInputTokens).toBeUndefined();
    expect(Number.isFinite(tokens.costUsd)).toBe(true);
  });

  it.each([['fast'], ['fast', 'slow']])('retains dispatch cost when fitness throws for %j', async (...engines) => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-fitness-throw-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    const effects = createForgeWorkflowEffects();
    const workflow = createForgeWorkflow({ ...effects, stages: { ...effects.stages,
      estimateCost: () => 0.25, fitness: { ...effects.stages.fitness,
        runSyntaxCheck: () => { throw new Error('fitness probe crashed'); } },
    } });
    const manifest = await workflow.runForge({ task: 'write files', fitnessCmd: 'true',
      cwd: repoDir, forgeDir, engines, healthCheckEnabled: false,
    }, makeRegistry(), {
      isAvailable: async () => true, getVersion: async () => 'fixture',
      dispatch: async ({ engine, cwd }) => {
        writeFileSync(join(cwd, `${engine.id}.txt`), 'partial work\n');
        return { exitCode: 0, stdout: 'paid response', stderr: '', timedOut: false, durationMs: 1 };
      },
    });
    expect(manifest.winner).toBeNull();
    for (const engine of engines) {
      expect(manifest.results[engine].pass).toBe(false);
      const metrics = manifest.dispatchLog?.filter(metric => metric.engineId === engine) ?? [];
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokens?.costUsd).toBe(0.25);
      expect(metrics[0].error).toContain('fitness probe crashed');
      expect(readFileSync(manifest.patches[engine], 'utf8')).toContain('partial work');
    }
  });

  it('retains settled dispatch costs after the real stage2 hard timeout', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(repoDir, 'timeout-run');
    const callbacks: string[] = [];
    const manifest = await runForge({
      task: 'write fast.txt', fitnessCmd: 'test -f fast.txt', cwd: repoDir, forgeDir,
      engines: ['fast', 'slow'], healthCheckEnabled: false, timeout: 1, fitnessTimeout: 1,
      onResult: engineId => { callbacks.push(engineId); return 'continue'; },
    }, makeRegistry(), {
      isAvailable: async () => true, getVersion: async () => 'fixture',
      dispatch: async ({ engine, cwd, signal }) => {
        if (engine.id === 'slow') {
          await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
          await new Promise<void>(resolve => setImmediate(resolve));
          return { exitCode: 0, stdout: 'paid partial response', stderr: '', timedOut: false, durationMs: 1 };
        }
        writeFileSync(join(cwd, 'fast.txt'), 'winner\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, durationMs: 1 };
      },
    });
    expect(manifest.winner).toBe('fast');
    expect(manifest.results.slow.pass).toBe(false);
    expect(callbacks.sort()).toEqual(['fast', 'slow']);
    const metrics = manifest.dispatchLog?.filter(metric => metric.engineId === 'slow') ?? [];
    expect(metrics).toHaveLength(1);
    expect(metrics[0].timedOut).toBe(true);
    expect(metrics[0].tokens?.response).toBeGreaterThan(0);
    expect(metrics[0].tokens?.costUsd).toBeGreaterThan(0);
    const persisted = JSON.parse(readFileSync(join(forgeDir, 'manifest.json'), 'utf8'));
    expect(persisted.dispatchLog.filter((metric: any) => metric.engineId === 'slow')).toEqual(metrics);
  });

  it('drains a cancelled candidate before reporting stage2 complete', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-forge-drain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
    let announceSlow!: () => void;
    const slowStarted = new Promise<void>(resolve => { announceSlow = resolve; });
    let announceAbort!: () => void;
    const slowAborted = new Promise<void>(resolve => { announceAbort = resolve; });
    let stageDone = false;
    let slowFinished = false;
    const invocation = runForge({
      task: 'write fast.txt', fitnessCmd: 'test -f fast.txt', cwd: repoDir, forgeDir,
      engines: ['fast', 'slow'], healthCheckEnabled: false,
      onResult: engineId => engineId === 'fast' ? 'finalize' : 'continue',
    }, makeRegistry(), {
      isAvailable: async () => true, getVersion: async () => 'fixture',
      dispatch: async ({ engine, cwd, signal }) => {
        if (engine.id === 'slow') {
          signal!.addEventListener('abort', announceAbort, { once: true });
          announceSlow();
          await slowGate;
          slowFinished = true;
          return { exitCode: 130, stdout: 'paid partial response', stderr: 'cancelled', timedOut: false, durationMs: 1 };
        }
        await slowStarted;
        writeFileSync(join(cwd, 'fast.txt'), 'winner\n');
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false, durationMs: 1 };
      },
    }, event => { if (event.type === 'stage2:done') stageDone = true; });
    try {
      await slowAborted;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(slowFinished).toBe(false);
      expect(stageDone).toBe(false);
      releaseSlow();
      const result = await invocation;
      expect(slowFinished).toBe(true);
      expect(stageDone).toBe(true);
      expect(result.winner).toBe('fast');
      expect(result.results.slow.pass).toBe(false);
      const metrics = result.dispatchLog?.filter(metric => metric.engineId === 'slow') ?? [];
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokens?.prompt).toBeGreaterThan(0);
      expect(metrics[0].tokens?.response).toBeGreaterThan(0);
      expect(metrics[0].tokens?.costUsd).toBeGreaterThan(0);
      const persisted = JSON.parse(readFileSync(join(forgeDir, 'manifest.json'), 'utf8'));
      expect(persisted.dispatchLog.filter((metric: any) => metric.engineId === 'slow')).toEqual(metrics);
    } finally {
      releaseSlow();
      await invocation;
    }
  });

  it('aborts in-flight stage2 engines when onResult requests finalize', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-forge-finalize-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async ({ engine, cwd, signal }: any) => {
        if (engine.id === 'fast') {
          await new Promise((resolve) => setTimeout(resolve, 25));
          writeFileSync(join(cwd, 'fast.txt'), 'winner\n');
          return { exitCode: 0, stdout: 'fast done', stderr: '', timedOut: false };
        }

        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            writeFileSync(join(cwd, 'slow.txt'), 'too late\n');
            resolve({ exitCode: 0, stdout: 'slow done', stderr: '', timedOut: false });
          }, 60_000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted by caller finalize'));
          }, { once: true });
        });
      },
    };

    const callbacks: string[] = [];
    const manifest = await runForge(
      {
        task: 'write fast.txt',
        fitnessCmd: 'test -f fast.txt',
        cwd: repoDir,
        forgeDir,
        engines: ['fast', 'slow'],
        onResult: (engineId: string) => {
          callbacks.push(engineId);
          if (callbacks.length === 1) {
            return 'finalize';
          }
          return undefined;
        },
      } as any,
      makeRegistry(),
      adapter as any,
    );
    // No absolute wall-clock assertion: the abort behavior is proven
    // structurally below (slow.dispatchStdout carries the abort marker, so the
    // 60s slow engine did NOT run to completion), and the 30s testTimeout
    // already fails the test if runForge ever blocks on the slow engine.
    // The previous <5000ms / <2000ms bounds only added CI-load flakiness
    // (observed 22s elapsed on a saturated box) without testing new behavior.
    expect(callbacks[0]).toBe('fast');
    expect(manifest.winner).toBe('fast');
    expect(manifest.results.fast).toMatchObject({ engineId: 'fast', pass: true });
    expect(manifest.results.slow).toMatchObject({ engineId: 'slow', pass: false });
    expect(manifest.results.slow.dispatchStdout).toMatch(/ERROR: .*abort|ERROR: .*finalized/);

    const persisted = JSON.parse(readFileSync(join(forgeDir, 'manifest.json'), 'utf-8'));
    expect(persisted.winner).toBe('fast');
    expect(persisted.results.fast.pass).toBe(true);
    expect(persisted.results.slow.pass).toBe(false);
  });

  it('preserves wait-for-all behavior when onResult is not provided (backwards-compat)', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-forge-finalize-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async ({ engine, cwd }: any) => {
        const delay = engine.id === 'fast' ? 10 : 40;
        await new Promise((resolve) => setTimeout(resolve, delay));
        writeFileSync(join(cwd, `${engine.id}.txt`), `${engine.id} done\n`);
        return { exitCode: 0, stdout: `${engine.id} done`, stderr: '', timedOut: false };
      },
    };

    const manifest = await runForge(
      {
        task: 'write engine-named file',
        fitnessCmd: 'ls *.txt | head -1',
        cwd: repoDir,
        forgeDir,
        engines: ['fast', 'slow'],
      } as any,
      makeRegistry(),
      adapter as any,
    );

    expect(Object.keys(manifest.results).sort()).toEqual(['fast', 'slow']);
    expect(manifest.results.fast).toMatchObject({ engineId: 'fast', pass: true });
    expect(manifest.results.slow).toMatchObject({ engineId: 'slow', pass: true });
    expect(manifest.winner).toBeTruthy();
  });

  it('continues waiting for every engine when onResult returns "continue"', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-forge-finalize-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async ({ engine, cwd }: any) => {
        const delay = engine.id === 'fast' ? 10 : 40;
        await new Promise((resolve) => setTimeout(resolve, delay));
        writeFileSync(join(cwd, `${engine.id}.txt`), `${engine.id} done\n`);
        return { exitCode: 0, stdout: `${engine.id} done`, stderr: '', timedOut: false };
      },
    };

    const callbacks: string[] = [];
    const manifest = await runForge(
      {
        task: 'write engine-named file',
        fitnessCmd: 'ls *.txt | head -1',
        cwd: repoDir,
        forgeDir,
        engines: ['fast', 'slow'],
        onResult: (engineId: string) => {
          callbacks.push(engineId);
          return 'continue';
        },
      } as any,
      makeRegistry(),
      adapter as any,
    );

    expect(callbacks.sort()).toEqual(['fast', 'slow']);
    expect(Object.keys(manifest.results).sort()).toEqual(['fast', 'slow']);
    expect(manifest.results.fast.pass).toBe(true);
    expect(manifest.results.slow.pass).toBe(true);
    expect(manifest.winner).toBeTruthy();
  });

  it('auto-finalizes stage2 when the M-of-N passing quorum is reached', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    // Tight quorum config: 3 passing engines triggers auto-finalize.
    writeFileSync(join(repoDir, '.agon.json'), JSON.stringify({
      forgeRequireBaselineCheck: false,
      forgeEnableSynthesis: false,
      forgeDispatchTimeout: 480,
      forgeFitnessTimeout: FITNESS_TIMEOUT_SECONDS,
      forgeEarlyFinalizeEnabled: true,
      forgeEarlyFinalizePassingCount: 3,
      forgeEarlyFinalizeMinScore: 50,
    }, null, 2));

    const forgeDir = join(tmpdir(), `agon-forge-finalize-quorum-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const registry = new EngineRegistry();
    const engineIds = ['fast1', 'fast2', 'fast3', 'slow1', 'slow2', 'slow3'];
    for (const id of engineIds) {
      registry.register({
        id,
        displayName: id,
        api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
        timeout: 120,
        tier: 'user',
        schemaVersion: 3,
        isLocal: false,
        exec: { args: [] },
        review: { args: [] },
      } as any);
    }

    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async ({ engine, cwd, signal }: any) => {
        if (engine.id.startsWith('fast')) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          writeFileSync(join(cwd, `${engine.id}.txt`), `${engine.id} fast\n`);
          return { exitCode: 0, stdout: `${engine.id} done`, stderr: '', timedOut: false };
        }
        // Slow engines: would settle in 30s if not aborted. The quorum trigger
        // should fire well before that.
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            writeFileSync(join(cwd, `${engine.id}.txt`), 'too late\n');
            resolve({ exitCode: 0, stdout: 'slow done', stderr: '', timedOut: false });
          }, 30_000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted by quorum finalize'));
          }, { once: true });
        });
      },
    };

    const t0 = Date.now();
    const manifest = await runForge(
      {
        task: 'write engine-named file',
        fitnessCmd: 'ls *.txt | head -1',
        cwd: repoDir,
        forgeDir,
        engines: engineIds,
      } as any,
      registry,
      adapter as any,
    );
    const wallClockMs = Date.now() - t0;

    // All 3 fast engines must have settled and passed.
    for (const id of ['fast1', 'fast2', 'fast3']) {
      expect(manifest.results[id], `expected ${id} to have a result`).toBeDefined();
      expect(manifest.results[id].pass).toBe(true);
    }
    // The slow engines must have been aborted by the quorum, not settled
    // organically — their dispatchStdout should mention the abort.
    for (const id of ['slow1', 'slow2', 'slow3']) {
      const r = manifest.results[id];
      // Some slow engines may not have published a result at all if quorum
      // tripped before they made it past dispatch start — that's also fine.
      if (r) {
        expect(r.pass).toBe(false);
      }
    }
    // Hard wall-clock budget: must be well under what the slow engines'
    // settle-time (30s) would have required. Generous 10s ceiling to absorb
    // CI jitter while still proving the abort path fired.
    expect(wallClockMs).toBeLessThan(10_000);
  }, 30_000);

  it('treats earlyFinalizeCount=0 as an explicit disable (not "trigger on first")', async () => {
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
    const repoDir = makeRepo();
    // No config overrides — defaults would auto-finalize at 3. The
    // option override of 0 must trump it.
    const forgeDir = join(tmpdir(), `agon-forge-finalize-disable-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const registry = new EngineRegistry();
    const ids = ['e1', 'e2', 'e3', 'e4'];
    for (const id of ids) {
      registry.register({
        id,
        displayName: id,
        api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
        timeout: 120,
        tier: 'user',
        schemaVersion: 3,
        isLocal: false,
        exec: { args: [] },
        review: { args: [] },
      } as any);
    }

    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async ({ engine, cwd }: any) => {
        // All engines pass fast. With earlyFinalizeCount=0, NONE of them
        // should trigger auto-abort — every engine must run to completion.
        await new Promise((resolve) => setTimeout(resolve, 10));
        writeFileSync(join(cwd, `${engine.id}.txt`), `${engine.id} done\n`);
        return { exitCode: 0, stdout: `${engine.id} done`, stderr: '', timedOut: false };
      },
    };

    const manifest = await runForge(
      {
        task: 'write engine-named file',
        fitnessCmd: 'ls *.txt | head -1',
        cwd: repoDir,
        forgeDir,
        engines: ids,
        earlyFinalizeCount: 0,
      } as any,
      registry,
      adapter as any,
    );

    // All 4 engines should have published — none aborted.
    expect(Object.keys(manifest.results).sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
    for (const id of ids) {
      const result = manifest.results[id];
      const fitnessLog = result.fitnessLogPath ? readFileSync(result.fitnessLogPath, 'utf8') : '';
      expect(result.engineCompleted, `${id} dispatch must complete`).toBe(true);
      expect(result.pass, `${id} should have completed: ${JSON.stringify(result)}\n${fitnessLog}`).toBe(true);
    }
  }, 15_000);
});
