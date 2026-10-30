import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-synthesis/src/implementation.js';
import { createSynthesisHostServices } from '../../packages/mod-synthesis/src/host.js';
import { runSynthesisModus as frozen, synthesisRoutingAdvice } from '../fixtures/modular-synthesis-legacy.js';

vi.mock('@kernlang/agon-core', async original => ({
  ...await original<object>(),
  loadConfig: () => ({}),
  resolveWorkingDir: () => '/fixture',
}));

afterEach(() => vi.restoreAllMocks());

describe('generated Synthesis uses the legacy pairing policy', () => {
  it.each([
    { scenario: 'CLI code', surface: 'cli', quiet: false, environmentQuiet: false, taskClass: 'bugfix', expectedAdvice: true },
    { scenario: 'CLI quiet flag', surface: 'cli', quiet: true, environmentQuiet: false, taskClass: 'bugfix', expectedAdvice: false },
    { scenario: 'CLI quiet environment', surface: 'cli', quiet: false, environmentQuiet: true, taskClass: 'bugfix', expectedAdvice: false },
    { scenario: 'CLI prose', surface: 'cli', quiet: false, environmentQuiet: false, taskClass: 'docs', expectedAdvice: false },
    { scenario: 'MCP code', surface: 'mcp', quiet: false, environmentQuiet: false, taskClass: 'bugfix', expectedAdvice: false },
    { scenario: 'TUI code', surface: 'tui', quiet: false, environmentQuiet: false, taskClass: 'bugfix', expectedAdvice: false },
  ])('preserves routing advice presentation: $scenario', async ({ surface, quiet, environmentQuiet, taskClass, expectedAdvice }) => {
    const prompt = taskClass === 'docs' ? 'Write a README explaining the architecture' : 'fix the login crash';
    const order: string[] = [];
    const showRoutingAdvice = vi.fn(() => { order.push('warning'); });
    const adapter = { dispatch: vi.fn(async (request: { mode: string }) => {
      order.push('dispatch');
      return { stdout: request.mode === 'review'
        ? 'SCORE_1: 90\nWINNER: alpha\nREASONING: fixture' : 'draft',
      stderr: '', exitCode: 0, timedOut: false };
    }) };
    const hostEffects = {
      openRegistry: () => ({ get: (id: string) => ({ id }), findBinary: () => null }),
      createAdapter: () => adapter,
      captureAuthority: () => () => {}, loadConfig: () => ({}), warn: vi.fn(),
      routingAdvice: { classifyTask: () => taskClass, isQuiet: () => environmentQuiet, show: showRoutingAdvice },
    };
    const services = {
      engines: { listActive: async () => ['alpha'] },
      receipts: { record: vi.fn(async () => 'receipt') },
      runs: { start: async () => ({ id: 'fixture', path: '/fixture/run', startedAt: 'fixture' }), finish: vi.fn() },
      synthesis: createSynthesisHostServices(hostEffects as never),
    } as unknown as ModServices;
    let command!: CommandContribution;
    const registrar = new Proxy({}, { get: (_target, method) => (...args: unknown[]) => {
      if (method === (surface === 'mcp' ? 'tool' : 'command') && args[0] === surface) command = args[1] as CommandContribution;
      return () => {};
    } }) as Registrar;
    const dispose = await (await createMod(services)).activate(registrar);
    try {
      const outcome = await command.run(surface === 'tui'
        ? { input: prompt, engines: 'alpha', swaps: 0 }
        : { prompt, engines: 'alpha', swaps: '0', quiet }, {
        cwd: '/fixture', invocationId: 'synthesis-routing-advice', platform: 'darwin-arm64',
        signal: new AbortController().signal, config: {},
      });
      if (surface === 'mcp') expect(outcome).toMatchObject({ winner: 'alpha' });
      else expect(outcome.exitCode).toBe(0);
      if (expectedAdvice) expect(showRoutingAdvice).toHaveBeenCalledExactlyOnceWith(synthesisRoutingAdvice(prompt));
      else expect(showRoutingAdvice).not.toHaveBeenCalled();
      expect(order[0]).toBe(expectedAdvice ? 'warning' : 'dispatch');
      expect(adapter.dispatch).toHaveBeenCalledTimes(2);
    } finally { await dispose(); }
  });

  it.each([2, 3, 4])('uses disjoint pairs for %i engines, not a ring', async count => {
    const engines = ['alpha', 'beta', 'gamma', 'delta'].slice(0, count);
    const calls: Array<{ engineId: string; prompt: string }> = [];
    const requests: unknown[] = [];
    const reply = async (engineId: string, prompt: string) => {
      calls.push({ engineId, prompt });
      return { stdout: prompt.includes('JUDGE') || prompt.includes('ENTRY 1')
        ? 'SCORE_1: 90\nWINNER: alpha\nREASONING: fixture'
        : prompt.includes('REASONING section') ? 'improved\n## REASONING\nfixture' : `draft ${engineId}`,
      stderr: '', exitCode: 0, timedOut: false };
    };
    const context = { cwd: '/fixture', invocationId: 'synthesis-parity',
      platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
    const registry = { get: (id: string) => ({ id }), findBinary: () => null };
    const adapter = { dispatch: (request: { engine: { id: string }; prompt: string }) => {
      requests.push(request);
      return reply(request.engine.id, request.prompt);
    } };
    const services = {
      engines: { listActive: async () => engines, dispatch: reply },
      receipts: { record: vi.fn(async () => 'receipt') },
      runs: { start: async () => ({ id: 'fixture', path: '/fixture/run', startedAt: 'fixture' }), finish: vi.fn() },
      synthesis: { open: () => ({ registry, adapter, assertCurrent: () => {}, effects: {
        resolveWorkingDir: () => context.cwd, health: { loadConfig: () => ({}) }, warn: vi.fn(),
      } }) },
    } as unknown as ModServices;
    let command!: CommandContribution;
    const registrar = new Proxy({}, { get: (_target, method) => (...args: unknown[]) => {
      if (method === 'command' && args[0] === 'cli') command = args[1] as CommandContribution;
      return () => {};
    } }) as Registrar;
    const dispose = await (await createMod(services)).activate(registrar);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const outcome = await command.run({ prompt: 'Design fixture', engines: engines.join(','), swaps: '2' }, context);
      expect(outcome.exitCode).toBe(0);
      const result = outcome.result as { swaps: unknown[] };
      expect(result.swaps).toHaveLength(Math.floor(count / 2) * 2);
      expect(calls).toHaveLength(count + Math.floor(count / 2) * 2 + 1);
      expect(calls[0].prompt).toMatch(/^## SYNTHESIS DRAFT/);
      expect(calls.at(-1)?.prompt).toMatch(/^## SYNTHESIS JUDGE/);
      const generatedRequests = [...requests];
      requests.length = 0;
      const expected = await frozen({
        prompt: 'Design fixture', engines, swaps: 2, timeout: 120,
        registry: registry as never, adapter: adapter as never,
        outputDir: '/fixture/run', signal: context.signal,
      });
      expect(requests).toEqual(generatedRequests);
      expect(outcome.result).toEqual({
        ...expected, judge: engines[0],
        panelHealth: { requested: generatedRequests.length, failures: 0, degraded: false },
      });
    } finally { await dispose(); }
  });

  it.each(['revoked', 'cancelled', 'failed-judge', 'empty-judge', 'missing-host', 'receipt-failure', 'finish-failure', 'failed-drafts', 'timed-out-drafts',
    ...['start', 'judge', 'finish', 'receipt'].flatMap(phase => ['revoked', 'cancelled'].map(kind => `${kind}-${phase}`))])(
    'does not publish success for %s', async scenario => {
      const controller = new AbortController();
      let revoked = false;
      const assertCurrent = () => { if (revoked) throw new Error('revoked'); };
      const interrupt = (phase: string) => {
        if (scenario === `revoked-${phase}`) revoked = true;
        if (scenario === `cancelled-${phase}`) controller.abort(new Error('cancelled'));
      };
      const dispatch = vi.fn(async (request: { mode: string }) => {
        if (scenario === 'revoked') revoked = true;
        if (scenario === 'cancelled') controller.abort(new Error('cancelled'));
        const judging = request.mode === 'review';
        if (judging) interrupt('judge');
        return {
          stdout: judging ? (scenario === 'empty-judge' ? '' : 'SCORE_1: 90\nWINNER: alpha\nREASONING: fixture') : 'draft',
          stderr: '', exitCode: (judging && scenario === 'failed-judge') || (!judging && scenario === 'failed-drafts') ? 1 : 0,
          timedOut: !judging && scenario === 'timed-out-drafts',
        };
      });
      const record = vi.fn(async () => {
        if (scenario === 'receipt-failure') throw new Error('receipt unavailable');
        interrupt('receipt');
        return 'receipt';
      });
      const finish = vi.fn(async () => {
        if (scenario === 'finish-failure') throw new Error('status unavailable');
        interrupt('finish');
      });
      const services = {
        engines: { listActive: async () => ['alpha', 'beta'], dispatch }, receipts: { record },
        runs: { start: async () => {
          interrupt('start');
          return { id: 'fixture', path: '/fixture/run', startedAt: 'fixture' };
        }, finish },
        ...(scenario === 'missing-host' ? {} : { synthesis: { open: () => ({
          registry: { get: (id: string) => ({ id }), findBinary: () => null },
          adapter: { dispatch }, assertCurrent,
          effects: { resolveWorkingDir: () => '/fixture', health: { loadConfig: () => ({}) }, warn: vi.fn() },
        }) } }),
      } as unknown as ModServices;
      let command!: CommandContribution;
      const registrar = new Proxy({}, { get: (_target, method) => (...args: unknown[]) => {
        if (method === 'command' && args[0] === 'cli') command = args[1] as CommandContribution;
        return () => {};
      } }) as Registrar;
      const dispose = await (await createMod(services)).activate(registrar);
      try {
        const failedDrafts = scenario === 'failed-drafts' || scenario === 'timed-out-drafts';
        const result = command.run({ prompt: 'fixture', swaps: failedDrafts ? '1' : '0',
          engines: failedDrafts ? 'alpha,beta' : 'alpha' }, {
          cwd: '/fixture', invocationId: 'failure', platform: 'darwin-arm64',
          signal: controller.signal, config: {},
        });
        if (scenario.startsWith('revoked') || scenario.startsWith('cancelled')) {
          const [kind, phase] = scenario.split('-');
          await expect(result).rejects.toThrow(kind);
          expect(dispatch).toHaveBeenCalledTimes(phase === 'start' ? 0 : phase ? 2 : 1);
          expect(record).toHaveBeenCalledTimes(phase === 'receipt' ? 1 : 0);
          expect(finish).toHaveBeenCalledTimes(1);
          const completed = phase === 'finish' || phase === 'receipt';
          expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(
            completed ? { ok: true } : { ok: false, summary: kind }), expect.anything());
        } else if (scenario === 'receipt-failure' || scenario === 'finish-failure') {
          await expect(result).resolves.toMatchObject({ exitCode: 1, result: { winner: 'alpha' } });
          expect(finish).toHaveBeenCalledTimes(1);
          expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: true }), expect.anything());
          if (scenario === 'finish-failure') expect(record).not.toHaveBeenCalled();
        } else {
          await expect(result).resolves.toMatchObject({ exitCode: 1 });
          if (scenario === 'missing-host') expect(dispatch).not.toHaveBeenCalled();
          else expect(finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ok: false }), expect.anything());
          if (failedDrafts) expect(dispatch).toHaveBeenCalledTimes(3); // Two drafts and an empty-entry judge, never a swap.
        }
      } finally { await dispose(); }
    },
  );
});
