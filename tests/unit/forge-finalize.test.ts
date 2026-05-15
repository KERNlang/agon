import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import { runForge } from '../../packages/forge/src/generated/forge.js';

vi.mock('../../packages/forge/src/generated/quality.js', () => ({
  runLint: vi.fn(async () => 0),
  runStyleCheck: vi.fn(async () => 100),
  // Test fixtures write plain .txt files; the real runSyntaxCheck would
  // return the same shape (skip-by-extension), but mocking keeps the
  // unit test independent of the tree-sitter Python sidecar install.
  runSyntaxCheck: vi.fn(() => ({ errors: 0, invalidFiles: [] })),
}));

const tempDirs: string[] = [];

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
    forgeFitnessTimeout: 1,
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

describe('caller-driven forge finalize', () => {
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
    const started = Date.now();
    let finalizeRequestedAt = 0;
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
            finalizeRequestedAt = Date.now();
            return 'finalize';
          }
          return undefined;
        },
      } as any,
      makeRegistry(),
      adapter as any,
    );
    const elapsedMs = Date.now() - started;
    const finalizeElapsedMs = Date.now() - finalizeRequestedAt;

    expect(elapsedMs).toBeLessThan(5_000);
    expect(finalizeElapsedMs).toBeLessThan(2_000);
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
      forgeFitnessTimeout: 1,
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
      expect(manifest.results[id].pass, `${id} should have completed`).toBe(true);
    }
  }, 15_000);
});
