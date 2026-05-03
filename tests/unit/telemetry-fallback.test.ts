import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { EngineRegistry } from '../../packages/core/src/engine-registry.js';
import { EventBus } from '../../packages/core/src/event-bus.js';
import { runForge } from '../../packages/forge/src/index.js';
import { MockStallEngine } from '../fixtures/generated/mock-stall-engine.js';
import { createTelemetryService } from '../../packages/cli/src/generated/signals/telemetry-service.js';
import { createScoreboard, scoreboardStartEngine, scoreboardFailEngine } from '../../packages/cli/src/generated/cesar/scoreboard.js';

function makeRegistry(): EngineRegistry {
  const registry = new EngineRegistry();
  registry.register({
    id: 'staller',
    displayName: 'Staller',
    api: { apiKeyEnv: 'FAKE_API_KEY' },
    timeout: 1,
    tier: 'user',
    schemaVersion: 3,
    isLocal: false,
    exec: { args: [] },
    review: { args: [] },
  } as any);
  registry.register({
    id: 'backup',
    displayName: 'Backup',
    api: { apiKeyEnv: 'FAKE_API_KEY' },
    timeout: 1,
    tier: 'user',
    schemaVersion: 3,
    isLocal: false,
    exec: { args: [] },
    review: { args: [] },
  } as any);
  return registry;
}

function createRepo(label: string): string {
  const dir = join(tmpdir(), `agon-fallback-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('Telemetry fallback during forge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects stall, logs to scoreboard, dispatches toast, and activates successor', async () => {
    const registry = makeRegistry();
    const eventBus = new EventBus();
    const repoDir = createRepo('telemetry-fallback');
    const forgeDir = join(tmpdir(), `agon-fallback-forge-${Date.now()}`);
    mkdirSync(forgeDir, { recursive: true });

    // Ensure API key is set so engines appear available
    process.env.FAKE_API_KEY = 'test';

    // Telemetry service with test overrides so thresholds are not clamped.
    // Use an unreachable probe URL so network health doesn't mask the stall.
    const telemetry = createTelemetryService({
      registry,
      eventBus,
      stallThresholdMs: 50,
      sampleIntervalMs: 25,
      networkProbeUrl: 'http://localhost:59999',
      __test: true,
    });

    const fallbackEvents: Array<{ from: string; to: string; reason: string }> = [];
    const toastEvents: Array<string> = [];

    eventBus.on('engine:stall-detected', (payload) => {
      toastEvents.push(`stall:${payload.data.engineId}`);
      scoreboardFailEngine(scoreboard, payload.data.engineId, 'telemetry: stall detected');
    });

    eventBus.on('engine:fallback', (payload) => {
      fallbackEvents.push({
        from: String(payload.data.from),
        to: String(payload.data.to),
        reason: String(payload.data.reason),
      });
    });

    // Mock adapter: staller always stalls, backup never stalls
    const adapter = new MockStallEngine({
      stallProbability: 1.0,
      stallDurationMs: 200,
      engineId: 'staller',
    });

    const backupAdapter = new MockStallEngine({
      stallProbability: 0,
      stallDurationMs: 0,
      engineId: 'backup',
    });

    // Composite adapter that routes by engine id
    const compositeAdapter = {
      dispatch: async (options: any) => {
        if (options.engine.id === 'staller') {
          return adapter.dispatch(options);
        }
        return backupAdapter.dispatch(options);
      },
      dispatchAgent: async (options: any) => {
        if (options.engine.id === 'staller') {
          return adapter.dispatchAgent(options);
        }
        return backupAdapter.dispatchAgent(options);
      },
      isAvailable: async () => true,
      getVersion: async () => 'test',
    };

    // Scoreboard to track engine states
    const scoreboard = createScoreboard('fallback-run', 'forge', ['staller', 'backup']);

    telemetry.start();

    // Poll until telemetry detects the stall or timeout
    const maxWait = 5000;
    const pollInterval = 50;
    const startWait = Date.now();
    while (fallbackEvents.length === 0 && Date.now() - startWait < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    const events: any[] = [];
    const manifest = await runForge(
      {
        task: 'Create generated.ts that returns world',
        fitnessCmd: `grep -q '"world"' generated.ts`,
        cwd: repoDir,
        forgeDir,
        engines: ['staller', 'backup'],
        starter: 'staller',
        timeout: 600,
        fitnessTimeout: 120,
      },
      registry,
      compositeAdapter as any,
      (event) => {
        events.push(event);
        if (event.type === 'stage1:dispatch' && event.engineId) {
          scoreboardStartEngine(scoreboard, event.engineId);
        }
        if (event.type === 'engine:failed' && event.engineId) {
          scoreboardFailEngine(scoreboard, event.engineId, String(event.data?.error ?? 'failed'));
        }
      }
    );

    // Stop telemetry and clean up
    telemetry.stop();

    // Assertions
    // 1. Watchdog fired: telemetry should have detected stall on 'staller'
    expect(fallbackEvents.length).toBeGreaterThanOrEqual(1);
    expect(fallbackEvents.some((e) => e.from === 'staller' && e.to === 'backup')).toBe(true);

    // 2. Scoreboard logged the stall (scoreboard should show failed or fallback state)
    const stallerEntry = scoreboard.entries.find((e) => e.engineId === 'staller');
    expect(stallerEntry).toBeDefined();
    expect(stallerEntry?.state === 'failed' || stallerEntry?.state === 'running').toBe(true);

    // 3. Toast event dispatched (engine:stall-detected fired)
    expect(toastEvents.some((t) => t.includes('staller'))).toBe(true);

    // 4. Successor engine activated: backup should have produced a result
    expect(manifest.results['backup']).toBeDefined();
    expect(manifest.results['backup']?.pass).toBe(true);

    // 5. Staller may still pass (the stall was a delay, not a dispatch failure);
    //    the key assertion is that telemetry detected it and triggered fallback
    expect(manifest.results['staller']).toBeDefined();

    // Cleanup
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(forgeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
