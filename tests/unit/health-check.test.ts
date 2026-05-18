import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import { runForge } from '../../packages/forge/src/generated/forge.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.AGON_FINALIZE_TEST_KEY;
});

function makeRepo(): string {
  const dir = join(tmpdir(), `agon-health-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# health-check test\n');
  writeFileSync(join(dir, '.agon.json'), JSON.stringify({
    forgeRequireBaselineCheck: false,
    forgeEnableSynthesis: false,
    forgeDispatchTimeout: 30,
    forgeFitnessTimeout: 1,
    forgeHealthCheckEnabled: true,
    forgeHealthCheckTimeoutSec: 2,
    forgeEarlyFinalizeEnabled: false,
  }, null, 2));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('forge pre-flight health check', () => {
  const HEALTH_PROBE_PROMPT = 'Reply with just: ok';

  beforeEach(() => {
    // The global setup disables health-check for the rest of the suite;
    // these tests need it active.
    delete process.env.AGON_DISABLE_FORGE_HEALTH_CHECK;
    process.env.AGON_FINALIZE_TEST_KEY = 'test';
  });

  afterEach(() => {
    process.env.AGON_DISABLE_FORGE_HEALTH_CHECK = '1';
  });

  it('filters out engines that fail the health probe', async () => {
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-health-fdir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const registry = new EngineRegistry();
    for (const id of ['alive', 'dead']) {
      registry.register({
        id, displayName: id,
        api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
        timeout: 30, tier: 'user', schemaVersion: 3,
        isLocal: false,
        exec: { args: [] },
        review: { args: [] },
      } as any);
    }

    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async ({ engine, prompt, cwd }: any) => {
        const isHealthProbe = String(prompt ?? '').includes(HEALTH_PROBE_PROMPT);
        if (isHealthProbe) {
          if (engine.id === 'dead') {
            // Simulate a hanging engine: return empty stdout AFTER the probe
            // timeout would have fired. The bridge treats timeout as unhealthy.
            await new Promise((resolve) => setTimeout(resolve, 4_000));
            return { exitCode: 0, stdout: '', stderr: '', timedOut: true };
          }
          return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
        }
        // Real dispatch: write a file, succeed.
        writeFileSync(join(cwd, `${engine.id}.txt`), `${engine.id} done\n`);
        return { exitCode: 0, stdout: `${engine.id} done`, stderr: '', timedOut: false };
      },
    };

    const skipped: string[] = [];
    const manifest = await runForge(
      {
        task: 'write engine-named file',
        fitnessCmd: 'ls *.txt | head -1',
        cwd: repoDir,
        forgeDir,
        engines: ['alive', 'dead'],
      } as any,
      registry,
      adapter as any,
      (event: any) => {
        if (event.type === 'forge:engine-skipped'
            && event.data?.status === 'health-check-failed') {
          skipped.push(event.data.engineId);
        }
      },
    );

    expect(manifest.results.alive, 'alive should have run').toBeDefined();
    expect(manifest.results.alive.pass).toBe(true);
    expect(manifest.results.dead, 'dead should NOT have run').toBeUndefined();
    expect(manifest.skippedEngines).toEqual([
      expect.objectContaining({
        engineId: 'dead',
        status: 'health-check-failed',
      }),
    ]);
    expect(skipped).toEqual(['dead']);
  }, 20_000);

  it('skips the probe entirely when dryRun=true (does not dispatch a single time)', async () => {
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-health-dryrun-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const registry = new EngineRegistry();
    registry.register({
      id: 'paranoid', displayName: 'paranoid',
      api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
      timeout: 30, tier: 'user', schemaVersion: 3,
      isLocal: false, exec: { args: [] }, review: { args: [] },
    } as any);

    let dispatchCalls = 0;
    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async () => {
        dispatchCalls++;
        throw new Error('dispatch must not be called during dryRun');
      },
    };

    await runForge(
      {
        task: 'plan only',
        fitnessCmd: 'true',
        cwd: repoDir,
        forgeDir,
        engines: ['paranoid'],
        dryRun: true,
      } as any,
      registry,
      adapter as any,
    );

    expect(dispatchCalls).toBe(0);
  }, 10_000);

  it('does not block forge when ALL engines fail the probe — returns a no-engines manifest', async () => {
    const repoDir = makeRepo();
    const forgeDir = join(tmpdir(), `agon-health-allfail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(forgeDir);
    mkdirSync(forgeDir, { recursive: true });

    const registry = new EngineRegistry();
    for (const id of ['d1', 'd2']) {
      registry.register({
        id, displayName: id,
        api: { apiKeyEnv: 'AGON_FINALIZE_TEST_KEY' },
        timeout: 30, tier: 'user', schemaVersion: 3,
        isLocal: false,
        exec: { args: [] },
        review: { args: [] },
      } as any);
    }

    const adapter = {
      isAvailable: async () => true,
      getVersion: async () => 'test',
      dispatch: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: true }),
    };

    const manifest = await runForge(
      {
        task: 'unreachable',
        fitnessCmd: 'true',
        cwd: repoDir,
        forgeDir,
        engines: ['d1', 'd2'],
      } as any,
      registry,
      adapter as any,
    );

    expect(manifest.winner).toBeNull();
    expect(Object.keys(manifest.results).length).toBe(0);
  }, 20_000);
});
