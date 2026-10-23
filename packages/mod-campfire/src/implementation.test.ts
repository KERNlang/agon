import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';
import { createCampfireHostServices } from './host.js';
import { engineHealth } from '@kernlang/agon-support-engine-runtime';
import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';

const context = { invocationId: 'campfire-test', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

async function setup(fail = false, api = false) {
  const dispatch = vi.fn(async (engineId: string, prompt: string) => ({ engineId, exitCode: fail ? 1 : 0, stdout: fail ? '' : `${engineId} view of ${prompt}`, stderr: fail ? 'failed' : '', timedOut: false }));
  const record = vi.fn(async () => 'receipt');
  const services = { identity: { id: 'agon.campfire', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn(async () => 'allow') }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch } } as unknown as ModServices;
  const adapter = { dispatch: vi.fn(async (options: Parameters<EngineAdapter['dispatch']>[0]) => ({ ...await dispatch(options.engine.id, options.prompt), durationMs: 1 })) } as unknown as EngineAdapter;
  let current = true;
  const loadConfig = vi.fn(() => ({ forgeHealthCheckApiTimeoutSec: 7, forgeMaxParallelApi: 1 }));
  const campfire = createCampfireHostServices({
    openRegistry: () => ({ get: id => ({ id, ...(api ? { api: {} } : { binary: '/fixture/engine' }) }) as EngineDefinition, findBinary: () => api ? null : '/fixture/engine' }),
    createAdapter: () => adapter, loadConfig, captureAuthority: () => () => { if (!current) throw new Error('generation replaced'); }, warn: vi.fn(),
  });
  const runs = { start: vi.fn(async () => ({ id: 'campfire', path: '/fixture/campfire', mode: 'campfire', startedAt: '2026-10-24T00:00:00Z' })), finish: vi.fn(async () => {}) };
  let command: CommandContribution | undefined;
  const registrar = { resultType: () => () => {}, command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: () => () => {}, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar;
  const mod = await createMod({ ...services, campfire, runs } as ModServices); await mod.activate(registrar, services);
  return { command: command!, dispatch, record, adapter, runs, loadConfig, revoke: () => { current = false; } };
}

describe('physical campfire mod', () => {
  it('treats persisted response observations as history, not successful completion after revocation', async () => {
    const h = await setup();
    h.record.mockImplementationOnce(async () => { h.revoke(); return 'historical-response-receipt'; });
    await expect(h.command.run({ topic: 'Modularity' }, context)).rejects.toThrow('generation replaced');
    expect(h.record).toHaveBeenCalledWith('campfire', { strategy: 'lead-first', lead: 'alpha', requested: 2, responded: 2 });
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it('uses invocation configuration for opt-in API probes without probing the project directory', async () => {
    const h = await setup(false, true);
    vi.stubEnv('AGON_FORCE_HEALTH_PROBE', '1');
    vi.stubEnv('AGON_DISABLE_FORGE_HEALTH_CHECK', '');
    const invocation = { ...context, cwd: '/fixture/distinct-project' };
    try {
      await h.command.run({ topic: 'Modularity' }, invocation);
      expect(h.loadConfig).toHaveBeenCalledWith(invocation.cwd);
      const calls = vi.mocked(h.adapter.dispatch).mock.calls.map(([options]) => options);
      const probes = calls.filter(options => options.prompt === 'Reply with just: ok');
      expect(probes).toHaveLength(2);
      for (const probe of probes) {
        expect(probe.timeout).toBe(7);
        expect(probe.cwd).not.toBe(invocation.cwd);
      }
      expect(calls.filter(options => options.prompt !== 'Reply with just: ok').every(options => options.cwd === invocation.cwd)).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it('drains parallel seats before recording a revoked run', async () => {
    const h = await setup();
    let startBeta!: () => void;
    let releaseBeta!: () => void;
    const betaStarted = new Promise<void>(resolve => { startBeta = resolve; });
    const betaDone = new Promise<void>(resolve => { releaseBeta = resolve; });
    h.dispatch.mockImplementation(async engineId => {
      if (engineId === 'alpha') { await betaStarted; h.revoke(); }
      else { startBeta(); await betaDone; }
      return { engineId, exitCode: 0, stdout: 'A substantive response.', stderr: '', timedOut: false };
    });
    const settled = Promise.resolve(h.command.run({ topic: 'Modularity', strategy: 'all-respond' }, context)).then(() => 'success', error => String(error));
    try {
      await betaStarted;
      await new Promise(resolve => setImmediate(resolve));
      expect(h.runs.finish).not.toHaveBeenCalled();
      expect(h.record).not.toHaveBeenCalled();
    } finally { releaseBeta(); }
    expect(await settled).toContain('generation replaced');
    expect(h.runs.finish).toHaveBeenCalledOnce();
  });

  it('preserves cancellation during successful-run persistence', async () => {
    const h = await setup();
    const controller = new AbortController();
    h.runs.finish.mockImplementationOnce(async () => {
      controller.abort(new Error('operator cancelled during persistence'));
      throw new Error('disk full');
    });
    await expect(h.command.run({ topic: 'Modularity' }, { ...context, signal: controller.signal })).rejects.toThrow('operator cancelled during persistence');
    expect(h.record).not.toHaveBeenCalled();
  });

  it.each(['Agree', 'Agree, nothing substantial to add.', 'Too short'])('omits a non-substantive observer: %s', async content => {
    const h = await setup();
    h.dispatch.mockResolvedValueOnce({ engineId: 'alpha', exitCode: 0, stdout: 'A substantive opening discussion.', stderr: '', timedOut: false });
    h.dispatch.mockResolvedValueOnce({ engineId: 'beta', exitCode: 0, stdout: content, stderr: '', timedOut: false });
    const result = await h.command.run({ topic: 'Modularity' }, context);
    expect(result).toMatchObject({ result: { rounds: [{ engineId: 'alpha', content: 'A substantive opening discussion.' }] } });
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it('uses plain-text execution with the invocation directory and run artifacts', async () => {
    const h = await setup();
    const invocation = { ...context, cwd: '/fixture/distinct-invocation' };
    await h.command.run({ topic: 'Modularity' }, invocation);
    expect(h.adapter.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      cwd: invocation.cwd, outputDir: '/fixture/campfire', signal: expect.any(AbortSignal), mode: 'exec', textOnly: true,
    }));
    expect(h.runs.finish).toHaveBeenCalledOnce();
  });

  it('excludes quarantined seats before choosing a lead', async () => {
    engineHealth.mark('alpha', 'auth-failed', 'fixture quarantine');
    try {
      const h = await setup();
      const result = await h.command.run({ topic: 'Modularity', lead: 'alpha' }, context);
      expect(h.dispatch.mock.calls.map(call => call[0])).toEqual(['beta']);
      expect(result).toMatchObject({ result: { lead: 'beta' } });
    } finally { engineHealth.clear('alpha'); }
  });

  it('refuses observers and success receipts after the generation changes', async () => {
    const h = await setup();
    h.dispatch.mockImplementationOnce(async engineId => {
      h.revoke();
      return { engineId, exitCode: 0, stdout: 'A substantive opening discussion.', stderr: '', timedOut: false };
    });
    await expect(h.command.run({ topic: 'Modularity' }, context)).rejects.toThrow('generation replaced');
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.record).not.toHaveBeenCalled();
    expect(h.runs.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), context);
  });

  it('preserves cancellation when saving the failed run also fails', async () => {
    const h = await setup();
    const controller = new AbortController();
    h.dispatch.mockImplementationOnce(async engineId => {
      controller.abort(new Error('operator cancelled'));
      return { engineId, exitCode: 0, stdout: 'A substantive opening discussion.', stderr: '', timedOut: false };
    });
    h.runs.finish.mockRejectedValueOnce(new Error('disk full'));
    await expect(h.command.run({ topic: 'Modularity' }, { ...context, signal: controller.signal })).rejects.toThrow('operator cancelled');
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('does not dispatch observers after an empty lead', async () => {
    const h = await setup(true);
    await h.command.run({ topic: 'Modularity' }, context);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('preserves project context and the prior assessment in the lead prompt', async () => {
    const h = await setup();
    await h.command.run({ topic: 'Modularity', context: 'project evidence', seedPlan: 'prior assessment' }, context);
    expect(h.dispatch.mock.calls[0][1]).toContain('## Project Context\nproject evidence');
    expect(h.dispatch.mock.calls[0][1]).toContain('## Lead assessment (prior context)\nprior assessment');
  });

  it('does not dispatch when the invocation is already cancelled', async () => {
    const h = await setup();
    const controller = new AbortController();
    controller.abort(new Error('operator cancelled'));
    await expect(h.command.run({ topic: 'Modularity' }, { ...context, signal: controller.signal })).rejects.toThrow('operator cancelled');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('runs lead-first and exposes the lead response to the remaining seats', async () => {
    const h = await setup();
    const result = await h.command.run({ topic: 'Modularity', strategy: 'lead-first', lead: 'beta' }, context);
    const parsed = JSON.parse((result as { stdout: string }).stdout);
    expect(parsed).toMatchObject({ strategy: 'lead-first', lead: 'beta', panelHealth: { requested: 2, responded: 2, degraded: false } });
    expect(h.dispatch.mock.calls[0][0]).toBe('beta');
    expect(h.dispatch.mock.calls[1][1]).toContain('## Lead engine (beta) response');
    expect(h.record).toHaveBeenCalledWith('campfire', { strategy: 'lead-first', lead: 'beta', requested: 2, responded: 2 });
  });

  it('dispatches all-respond seats independently', async () => {
    const h = await setup();
    const result = await h.command.run({ topic: 'Modularity', strategy: 'all-respond' }, context);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(h.dispatch.mock.calls.every((call) => !String(call[1]).includes('## Lead engine ('))).toBe(true);
  });

  it('fails closed when every engine fails', async () => {
    const h = await setup(true);
    await expect(h.command.run({ topic: 'Modularity' }, context)).resolves.toMatchObject({ exitCode: 1 });
    expect(h.record).not.toHaveBeenCalled();
  });
});
