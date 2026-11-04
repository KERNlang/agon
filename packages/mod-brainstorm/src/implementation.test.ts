import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, Registrar } from '@kernlang/agon-mod-api';
import { createMod, runBrainstorm } from './implementation.js';
import { dispatchSeatWithRetry } from '@kernlang/agon-support-panel';
import type { BrainstormModServices } from './host.js';
import { buildKernDraftPrompt } from '@kernlang/protocol';

const context = {
  invocationId: 'brainstorm-test',
  cwd: process.cwd(),
  platform: 'darwin-arm64' as const,
  signal: new AbortController().signal,
  config: {},
};

function harness(outputs: Record<string, unknown>) {
  const dispatch = vi.fn(async (engineId: string, prompt?: string, _context?: unknown, _options?: unknown) => prompt?.includes('Multiple AI engines analyzed')
    ? { engineId, exitCode: 0, stdout: 'fixture synthesis', stderr: '', timedOut: false }
    : outputs[engineId] ?? {
    engineId,
    exitCode: 1,
    stdout: '',
    stderr: 'failed',
    timedOut: false,
  });
  const record = vi.fn(async () => 'receipt');
  const services = {
    identity: { id: 'agon.brainstorm', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    source: 'bundled',
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record },
    permissions: { check: vi.fn(async () => 'allow') },
    state: { read: vi.fn(), write: vi.fn() },
    engines: { listActive: vi.fn(async () => ['alpha', 'beta']), dispatch },
    runs: {
      start: vi.fn(async () => ({ id: 'run', path: '/fixture/run', mode: 'brainstorm', startedAt: 'fixture' })),
      finish: vi.fn(), writeArtifact: vi.fn(),
    },
    brainstorm: { open: () => ({
      readRatings: () => ({ byMode: { brainstorm: {} }, global: {} }),
      seed: () => {}, preflight: async (options: { engines: string[] }) => ({ healthy: options.engines, skipped: [] }),
      createLogger: () => ({ log: () => {} }),
      buildPrompt: () => 'fixture draft prompt',
      parseDraft: (raw: string) => ({ reasoning: '', keyFiles: [], steps: [], tradeoffs: [], ...JSON.parse(raw) }),
      deduplicate: async () => ({ groups: null, status: { status: 'not-needed' } }),
      updateRatings: () => {},
      selectSeat: (options: { timeout: number }, engineId: string) => (prompt: string, systemPrompt: string) =>
        dispatchSeatWithRetry({ dispatch: () => dispatch(engineId, prompt, context, { timeoutSeconds: options.timeout, systemPrompt, textOnly: true }) } as never,
          { engineId, engine: { id: engineId }, prompt, systemPrompt, timeout: options.timeout } as never),
      selectWinner: (_options: unknown, engineId: string) => (prompt: string) => dispatch(engineId, prompt, context, { textOnly: true }),
    }) },
  } as unknown as BrainstormModServices;
  const registered: { surface: string; command: CommandContribution }[] = [];
  const registrar = {
    command: (surface: string, command: CommandContribution) => { registered.push({ surface, command }); return () => {}; },
    intent: () => () => {},
    tool: () => () => {},
    planStep: () => () => {},
    resultType: () => () => {},
  } as unknown as Registrar;
  return { services, registered, dispatch, record, registrar };
}

describe('physical brainstorm mod', () => {
  it.each(['unknown', '', null, 42])('rejects invalid style %j before opening host capabilities or starting a run', async style => {
    const h = harness({});
    const open = vi.spyOn(h.services.brainstorm!, 'open');
    const result = await runBrainstorm({ question: 'Question', style }, context, h.services);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("use 'divergent' or 'grounded'");
    expect(open).not.toHaveBeenCalled();
    expect(h.services.runs!.start).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it.each(['divergent', 'grounded'])('accepts the supported %s style', async style => {
    const h = harness({ alpha: { exitCode: 0, stdout: '{"approach":"fixture","confidence":80}', stderr: '', timedOut: false } });
    const result = await runBrainstorm({ question: 'Question', engines: 'alpha', style }, context, h.services);
    expect(result.exitCode).toBe(0);
    expect(h.services.runs!.start).toHaveBeenCalledOnce();
  });

  it('stops streaming late seat completions after a workflow rejection', async () => {
    const h = harness({});
    const chunks: string[] = [];
    let release!: (value: any) => void;
    const late = new Promise<any>(resolve => { release = resolve; });
    const open = h.services.brainstorm!.open;
    const services: BrainstormModServices = { ...h.services, brainstorm: {
      writeCliOutput: chunk => { chunks.push(chunk); },
      open: async invocation => ({ ...await open(invocation), selectSeat: (_options, engineId) => async () => {
        if (engineId === 'alpha') throw new Error('fixture rejected');
        return late;
      } }),
    } };
    const result = await runBrainstorm({ question: 'Question' }, context, services, true);
    expect(result.exitCode).toBe(1);
    const count = chunks.length;
    release({ engineId: 'beta', ok: true, text: '{"approach":"late","confidence":70}', attempts: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chunks).toHaveLength(count);
  });
  it.each([false, true])('announces the run before preflight and streams seats only outside quiet mode (%s)', async quiet => {
    const h = harness({ alpha: { exitCode: 0, stdout: '{"approach":"A","confidence":60}' } });
    const chunks: string[] = [];
    const open = h.services.brainstorm!.open;
    const services: BrainstormModServices = { ...h.services, brainstorm: {
      writeCliOutput: (chunk: string) => { chunks.push(chunk); },
      open: async invocation => ({ ...await open(invocation), preflight: async options => {
        expect(chunks.join('')).toContain(quiet ? '/fixture/run\n' : 'AGON_RUN: /fixture/run\n');
        return { healthy: options.engines, skipped: [] };
      } }),
    } };
    const result = await runBrainstorm({ question: 'Question', quiet }, context, services, true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('/fixture/run');
    expect(chunks.join('')).toContain(quiet ? '/fixture/run\n' : 'alpha: 1 attempt(s)');
    if (quiet) expect(chunks).toEqual(['/fixture/run\n']);
    else expect(chunks.join('')).toContain('beta: failed');
    expect(result.stdout).toContain('AGON_SUMMARY: 1/2 succeeded; beta: error');
  });

  it('never uses the CLI writer for machine invocations', async () => {
    const h = harness({ alpha: { exitCode: 0, stdout: '{"approach":"A","confidence":60}' } });
    const writeCliOutput = vi.fn();
    const services = { ...h.services, brainstorm: { ...h.services.brainstorm!, writeCliOutput } };
    const result = await runBrainstorm({ question: 'Question' }, context, services);
    expect(JSON.parse(result.stdout!)).toEqual(result.result);
    expect(writeCliOutput).not.toHaveBeenCalled();
  });

  it('does not repeat the streamed run path when the workflow fails', async () => {
    const h = harness({});
    const writeCliOutput = vi.fn();
    const services = { ...h.services, brainstorm: { ...h.services.brainstorm!, writeCliOutput } };
    const result = await runBrainstorm({ question: 'Question', quiet: true }, context, services, true);
    expect(writeCliOutput).toHaveBeenCalledExactlyOnceWith('/fixture/run\n');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('AGON_SUMMARY: 0/2 succeeded; alpha: error, beta: error\n');
  });
  it('keeps failed quiet runs discoverable without reporting success', async () => {
    const h = harness({});
    const result = await runBrainstorm({ question: 'Question', quiet: true }, context, h.services, true);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('/fixture/run\nAGON_SUMMARY: 0/2 succeeded; alpha: error, beta: error\n');
  });
  it('honors AGON_QUIET for CLI output without changing machine output or mutating the environment', async () => {
    vi.stubEnv('AGON_QUIET', '1');
    try {
      const h = harness({ alpha: { exitCode: 0, stdout: '{"approach":"A","confidence":60}' } });
      const cli = await runBrainstorm({ question: 'Question' }, context, h.services, true);
      expect(cli.stdout).toBe('/fixture/run\nAGON_SUMMARY: 1/2 succeeded; beta: error\n');
      const machine = await runBrainstorm({ question: 'Question' }, context, h.services);
      expect(JSON.parse(machine.stdout!)).toEqual(machine.result);
      expect(process.env.AGON_QUIET).toBe('1');
    } finally { vi.unstubAllEnvs(); }
  });
  it('keeps quiet CLI output to a run path and outcome summary', async () => {
    const h = harness({ alpha: { exitCode: 0, stdout: '{"approach":"A","confidence":60}' } });
    await (await createMod(h.services)).activate(h.registrar);
    const cli = h.registered.find(entry => entry.surface === 'cli')!.command;
    const result = await cli.run({ question: 'Question', quiet: true }, context);
    expect(result.stdout).toBe('/fixture/run\nAGON_SUMMARY: 1/2 succeeded; beta: error\n');
    expect(result.result).toMatchObject({ winner: 'alpha', response: 'fixture synthesis' });
  });

  it('renders human CLI quality and confidence separately without changing structured results', async () => {
    const h = harness({ alpha: { exitCode: 0, stdout: '{"approach":"A","confidence":60}' } });
    await (await createMod(h.services)).activate(h.registrar);
    const cli = h.registered.find(entry => entry.surface === 'cli')!.command;
    const result = await cli.run({ question: 'Question' }, context);
    expect(result.stdout).toContain('AGON_RUN: /fixture/run');
    expect(result.stdout).toContain('Engine\tQuality\tConfidence\tReasoning');
    expect(result.stdout).toContain('Response from alpha\nfixture synthesis');
    expect(result.stdout).toContain('AGON_SUMMARY: 1/2 succeeded; beta: error');
  });
  it('carries supplied project context into each real draft prompt', async () => {
    const h = harness({
      alpha: { exitCode: 0, stdout: '{"approach":"A","confidence":60}' },
      beta: { exitCode: 0, stdout: '{"approach":"B","confidence":70}' },
    });
    const open = h.services.brainstorm!.open;
    const services: BrainstormModServices = { ...h.services,
      brainstorm: { open: async invocation => ({ ...await open(invocation), buildPrompt: buildKernDraftPrompt }) },
    };
    const result = await runBrainstorm({ question: 'Question', context: 'CONTEXT_FIXTURE: use the project adapter' }, context, services);
    expect(result.exitCode).toBe(0);
    expect(h.dispatch.mock.calls.slice(0, 2).map(([engine]) => engine)).toEqual(['alpha', 'beta']);
    for (const [, prompt] of h.dispatch.mock.calls.slice(0, 2)) {
      expect(prompt).toContain('CONTEXT_FIXTURE: use the project adapter');
    }
  });
  it.each(['brainstorm', 'runs'] as const)('refuses a host missing %s without dispatch or fallback', async missing => {
    const h = harness({});
    const services = { ...h.services, [missing]: undefined };
    await expect(runBrainstorm({ question: 'Question' }, context, services)).resolves.toMatchObject({
      exitCode: 1, stderr: expect.stringContaining('host capabilities are unavailable'),
    });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it.each([0, -1, 'NaN', 'Infinity'])('rejects invalid timeout %s before starting a run', async timeout => {
    const h = harness({});
    await expect(runBrainstorm({ question: 'Question', timeout }, context, h.services)).resolves.toMatchObject({ exitCode: 1 });
    expect(h.services.runs!.start).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch or start a run after cancellation', async () => {
    const h = harness({});
    const controller = new AbortController(); controller.abort(new Error('fixture cancelled'));
    await expect(runBrainstorm({ question: 'Question' }, { ...context, signal: controller.signal }, h.services)).rejects.toThrow('fixture cancelled');
    expect(h.services.runs!.start).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('refuses an empty active roster without choosing an implicit engine', async () => {
    const h = harness({});
    vi.mocked(h.services.engines.listActive!).mockResolvedValue([]);
    await expect(runBrainstorm({ question: 'Question' }, context, h.services)).resolves.toMatchObject({ exitCode: 1, stderr: expect.stringContaining('No active engines') });
    expect(h.services.runs!.start).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('does not turn cancellation during synthesis into a successful fallback run', async () => {
    const h = harness({});
    const controller = new AbortController();
    h.dispatch.mockImplementation(async (engineId, prompt) => {
      if (prompt?.includes('Multiple AI engines analyzed')) {
        controller.abort(new Error('cancel synthesis'));
        throw controller.signal.reason;
      }
      return { engineId, exitCode: 0, stdout: '{"approach":"usable draft","confidence":70}', stderr: '', timedOut: false };
    });
    await expect(runBrainstorm({ question: 'Question' }, { ...context, signal: controller.signal }, h.services)).rejects.toThrow('cancel synthesis');
    expect(h.record).not.toHaveBeenCalled();
    expect(h.services.runs!.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
  });

  it('discovers engines, runs seats concurrently, chooses a result, and records evidence', async () => {
    const h = harness({
      alpha: { engineId: 'alpha', exitCode: 0, stdout: JSON.stringify({ approach: 'A', confidence: 55, steps: ['one'], tradeoffs: [] }), stderr: '', timedOut: false },
      beta: { engineId: 'beta', exitCode: 0, stdout: JSON.stringify({ approach: 'B', confidence: 80, steps: ['one', 'two'], tradeoffs: ['cost'] }), stderr: '', timedOut: false },
    });
    const mod = await createMod(h.services);
    await mod.activate(h.registrar, h.services);
    const command = h.registered.find(({ surface }) => surface === 'cli')!.command;
    const result = await command.run({ question: 'What should we build?' }, context);
    const parsed = result.result as any;
    expect(parsed).toMatchObject({ winner: 'beta', response: 'fixture synthesis', panelHealth: { requested: 2, responded: 2, degraded: false } });
    expect(parsed.synthesis?.status).toBe('completed');
    expect(h.dispatch).toHaveBeenCalledTimes(3);
    for (const call of h.dispatch.mock.calls) {
      expect(call).toEqual([expect.any(String), expect.any(String), context, expect.objectContaining({ textOnly: true })]);
    }
    expect(h.record).toHaveBeenCalledWith('brainstorm', { winner: 'beta', requested: 2, responded: 2 });
  });

  it('reports partial failure without turning a usable panel into a false failure', async () => {
    const h = harness({
      alpha: { engineId: 'alpha', exitCode: 0, stdout: JSON.stringify({ approach: 'usable', confidence: 60 }), stderr: '', timedOut: false },
    });
    const mod = await createMod(h.services);
    await mod.activate(h.registrar, h.services);
    const result = await h.registered[0].command.run({ question: 'Question' }, context);
    const parsed = result.result as any;
    expect(parsed.panelHealth).toMatchObject({ requested: 2, responded: 1, degraded: true });
    expect(h.dispatch.mock.calls.filter(([id]) => id === 'beta')).toHaveLength(2);
    expect(h.services.runs!.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), context);
    const status = vi.mocked(h.services.runs!.finish).mock.calls[0][1] as Record<string, unknown>;
    expect(status.summary).toContain(parsed.panelHealth.banner);
    expect(status).not.toHaveProperty('label');
  });

  it('fails closed when no seat returns usable output', async () => {
    const h = harness({});
    const mod = await createMod(h.services);
    await mod.activate(h.registrar, h.services);
    await expect(h.registered[0].command.run({ question: 'Question' }, context)).resolves.toMatchObject({ exitCode: 1 });
    expect(h.record).not.toHaveBeenCalled();
    expect(h.services.runs!.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      ok: false, summary: expect.stringContaining('no engine produced a usable draft'),
      engines: [{ id: 'alpha', status: 'error', detail: 'failed' }, { id: 'beta', status: 'error', detail: 'failed' }],
    }), context);
  });
});
