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
  let structured: CommandContribution | undefined;
  const registrar = { resultType: () => () => {}, command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; else structured = value; return () => {}; }, intent: () => () => {}, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar;
  const mod = await createMod({ ...services, campfire, runs } as ModServices); await mod.activate(registrar, services);
  return { command: command!, structured: structured!, campfire, dispatch, record, adapter, runs, loadConfig, revoke: () => { current = false; } };
}

describe('physical campfire mod', () => {
  it.each([false, true])('renders once through injected output (quiet=%s)', async quiet => {
    const h = await setup();
    const lines: string[] = [];
    const log = (line: string) => { lines.push(line); };
    Object.assign(h.campfire, { cliOutput: { log, header: log, info: log, bold: String, dim: String } });
    const result = await h.command.run({ topic: 'Modularity', quiet }, context);
    expect(result).toMatchObject({ exitCode: 0, stdout: '', result: { topic: 'Modularity', rounds: expect.any(Array) } });
    expect(lines.filter(line => line.includes('/fixture/campfire') && !line.includes('Full output'))).toHaveLength(1);
    expect(lines.filter(line => line.startsWith('AGON_SUMMARY:'))).toEqual(['AGON_SUMMARY: 2/2 succeeded']);
    if (quiet) expect(lines).toEqual(['/fixture/campfire', 'AGON_SUMMARY: 2/2 succeeded']);
    else {
      expect(lines).toContain('Campfire: Modularity');
      expect(lines).toContain('alpha');
      expect(lines).toContain('beta');
    }
  });

  it('keeps non-CLI output structured even when terminal output is injected', async () => {
    const h = await setup();
    const log = vi.fn();
    Object.assign(h.campfire, { cliOutput: { log, header: log, info: log, bold: String, dim: String } });
    const result = await h.structured.run({ topic: 'Modularity' }, context) as { stdout: string; result: unknown };
    expect(JSON.parse(result.stdout)).toEqual(result.result);
    expect(log).not.toHaveBeenCalled();
  });

  it('honors inherited quiet output without changing process configuration', async () => {
    vi.stubEnv('AGON_QUIET', '1');
    try {
      const h = await setup();
      const result = await h.command.run({ topic: 'Modularity' }, context) as { stdout: string };
      expect(result.stdout).toBe('/fixture/campfire\nAGON_SUMMARY: 2/2 succeeded\n');
      expect(process.env.AGON_QUIET).toBe('1');
    } finally { vi.unstubAllEnvs(); }
  });

  it('does not make quiet mode sticky for the next command', async () => {
    vi.stubEnv('AGON_QUIET', '');
    try {
      const h = await setup();
      await h.command.run({ topic: 'First', quiet: true }, context);
      const next = await h.command.run({ topic: 'Second' }, context) as { stdout: string };
      expect(next.stdout).toContain('Campfire: Second');
      expect(process.env.AGON_QUIET).toBe('');
    } finally { vi.unstubAllEnvs(); }
  });

  it('does not execute after display code revokes the invocation', async () => {
    const h = await setup();
    const log = vi.fn(() => h.revoke());
    Object.assign(h.campfire, { cliOutput: { log, header: log, info: log, bold: String, dim: String } });
    await expect(h.command.run({ topic: 'Modularity' }, context)).rejects.toThrow('generation replaced');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('prints degraded outcomes from the same statuses saved to disk', async () => {
    const h = await setup();
    h.dispatch.mockResolvedValueOnce({ engineId: 'alpha', exitCode: 0, stdout: 'A substantial opening response.', stderr: '', timedOut: false });
    h.dispatch.mockResolvedValueOnce({ engineId: 'beta', exitCode: 1, stdout: '', stderr: 'failed', timedOut: false });
    const result = await h.command.run({ topic: 'Modularity', label: 'fixture-label' }, context) as { stdout: string };
    expect(result.stdout).toContain('AGON_SUMMARY: 1/2 succeeded; beta: error');
    expect(h.runs.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      label: 'fixture-label', ok: false, engines: [
        { id: 'alpha', status: 'ok', detail: '1 round(s)' },
        { id: 'beta', status: 'error', detail: 'no output' },
      ],
    }), context);
  });

  it.each([false, true])('preserves human CLI output and quiet summary (quiet=%s)', async quiet => {
    const h = await setup();
    const result = await h.command.run({ topic: 'Modularity', strategy: 'all-respond', quiet }, context);
    expect(result).toMatchObject({ exitCode: 0, result: { topic: 'Modularity' } });
    const stdout = (result as { stdout: string }).stdout;
    expect(stdout).toContain(quiet ? '/fixture/campfire\n' : 'AGON_RUN: /fixture/campfire\n');
    expect(stdout).toContain('AGON_SUMMARY: 2/2 succeeded\n');
    if (quiet) {
      expect(stdout).not.toContain('Campfire:');
      expect(stdout).not.toContain('view of');
    } else {
      expect(stdout).toContain('Campfire: Modularity');
      expect(stdout).toContain('Engines: alpha, beta');
      expect(stdout).toContain('Strategy: all-respond');
      expect(stdout).toContain('Full output saved: /fixture/campfire');
      expect(stdout).toContain('alpha view of');
      expect(stdout).toContain('beta view of');
    }
  });

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
    expect(result).toMatchObject({ result: { strategy: 'lead-first', lead: 'beta', panelHealth: { requested: 2, responded: 2, degraded: false } } });
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
