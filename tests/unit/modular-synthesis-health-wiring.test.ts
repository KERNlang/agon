import { afterEach, expect, it, vi } from 'vitest';
import { engineHealth } from '@kernlang/agon-support-engine-runtime';
import { runSynthesisModus } from '../../packages/forge/src/synthesis-modus.js';

const config = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(),
  loadConfig: config.load,
  resolveWorkingDir: () => '/fixture/synthesis-workspace',
}));

afterEach(() => {
  vi.unstubAllEnvs();
  engineHealth.clearAll();
  config.load.mockReset();
});

it.each(['configured', 'config failure', 'disabled probe', 'quarantine'])
  ('preserves real preflight wiring through the compatibility facade: %s', async scenario => {
    vi.stubEnv('AGON_FORCE_HEALTH_PROBE', '1');
    vi.stubEnv('AGON_DISABLE_FORGE_HEALTH_CHECK', scenario === 'disabled probe' ? '1' : '');
    engineHealth.clearAll();
    config.load.mockImplementation(() => {
      if (scenario === 'config failure') throw new Error('fixture config failure');
      return { forgeHealthCheckApiTimeoutSec: 27, forgeMaxParallelApi: 1 };
    });
    if (scenario === 'quarantine') engineHealth.mark('beta', 'auth-failed', 'fixture quarantine');
    const probes: Array<{ id: string; timeout: number; cwd: string }> = [];
    const drafts: string[] = [];
    let active = 0, peak = 0;
    const dispatch = vi.fn(async (request: { engine: { id: string }; prompt: string; timeout: number; cwd: string }) => {
      if (request.prompt === 'Reply with just: ok') {
        probes.push({ id: request.engine.id, timeout: request.timeout, cwd: request.cwd });
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
      } else if (request.prompt.startsWith('## SYNTHESIS DRAFT')) {
        drafts.push(request.engine.id);
        expect(request.cwd).toBe('/fixture/synthesis-workspace');
      }
      return { stdout: 'fixture result', stderr: '', exitCode: 0, timedOut: false };
    });
    await runSynthesisModus({
      prompt: 'Design', engines: ['alpha', 'beta'], swaps: 0,
      timeout: 11, outputDir: process.env.TMPDIR!,
      registry: { get: (id: string) => ({ id, api: {} }), findBinary: () => null } as never,
      adapter: { dispatch } as never,
    });
    const expectedEngines = scenario === 'quarantine' ? ['alpha'] : ['alpha', 'beta'];
    expect(drafts).toEqual(expectedEngines);
    expect(config.load).toHaveBeenCalledWith(process.cwd());
    if (scenario === 'disabled probe') {
      expect(probes).toEqual([]);
    } else {
      expect(probes.map(probe => probe.id)).toEqual(expectedEngines);
      expect(probes.map(probe => probe.timeout)).toEqual(expectedEngines.map(() => scenario === 'config failure' ? 5 : 27));
      expect(probes.every(probe => probe.cwd !== '/fixture/synthesis-workspace')).toBe(true);
      if (scenario === 'configured') expect(peak).toBe(1);
    }
  });
