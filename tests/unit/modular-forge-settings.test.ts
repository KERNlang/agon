import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import type { CommandContribution, CommandResult, IntentContribution, InvocationContext, ModServices } from '../../packages/mod-api/src/index.js';
import { ModRegistry } from '../../packages/mod-kernel/src/index.js';
import { resolveRegisteredModSettings } from '../../packages/mod-kernel/src/mod-settings.js';
import { createMod as createForgeMod, MANIFEST, runForgeCompetition as runCompetition } from '../../packages/mod-forge/src/index.js';
import { withForgeHost } from '../helpers/forge-host.js';
import { classifyNoDiffForgeResult as ownedNoDiffPolicy } from '@kernlang/agon-mod-forge';
import { DEFAULT_FIRST_PARTY_SETTINGS } from '../../packages/core/src/models/first-party-settings.generated.js';
import { DEFAULT_AGON_CONFIG } from '../../packages/core/src/models/types.js';
import { classifyNoDiffForgeResult } from '../../packages/forge/src/stages.js';
import { createForgeHostServices, createForgeWorkflowEffects } from '@kernlang/agon-core';
import * as ownedForgeHost from '../../packages/mod-forge/src/host.js';
import type { EngineRegistry, EngineAdapter } from '@kernlang/agon-core';

const createMod = (services: ModServices) => createForgeMod(withForgeHost(services));
const runForgeCompetition = (raw: Parameters<typeof runCompetition>[0], context: InvocationContext, services: ModServices) =>
  runCompetition(raw, context, withForgeHost(services));

describe('Forge configuration ownership', () => {
  it('binds each physical Forge host invocation to its own registry and authority', async () => {
    const registries = [{} as EngineRegistry, {} as EngineRegistry];
    const rawAdapters = [{ dispatch: vi.fn(async () => ({ exitCode: 0 })) }, { dispatch: vi.fn(async () => ({ exitCode: 0 })) }];
    const seed = vi.fn();
    const createEffects = vi.fn(() => ({ ...createForgeWorkflowEffects(), seedNewEnginesFromRegistry: seed }));
    const openRegistry = vi.fn().mockReturnValueOnce(registries[0]).mockReturnValueOnce(registries[1]);
    const createAdapter = vi.fn().mockReturnValueOnce(rawAdapters[0]).mockReturnValueOnce(rawAdapters[1]);
    const stale = [false, false];
    let captures = 0;
    const captureAuthority = vi.fn(() => {
      const index = captures++;
      return () => { if (stale[index]) throw new Error(`stale invocation ${index}`); };
    });
    const host = ownedForgeHost.createForgeHostServices<EngineRegistry>({ openRegistry, createAdapter, createEffects, captureAuthority });
    expect(openRegistry).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(createEffects).not.toHaveBeenCalled();
    expect(captureAuthority).not.toHaveBeenCalled();
    const context: InvocationContext = { invocationId: 'first', cwd: '/fixture/first', platform: 'darwin-arm64', config: {}, signal: new AbortController().signal };
    const first = await host.open(context);
    const second = await host.open({ ...context, invocationId: 'second', cwd: '/fixture/second' });
    expect(openRegistry.mock.calls).toEqual([['/fixture/first'], ['/fixture/second']]);
    expect(createAdapter.mock.calls).toEqual([[registries[0]], [registries[1]]]);
    expect(createEffects).toHaveBeenCalledTimes(2);
    first.effects.seedNewEnginesFromRegistry(registries[1]!);
    second.effects.seedNewEnginesFromRegistry(registries[0]!);
    expect(seed).toHaveBeenCalledTimes(2);
    expect(seed.mock.calls[0]![0]).toBe(registries[0]);
    expect(seed.mock.calls[1]![0]).toBe(registries[1]);
    stale[0] = true;
    await expect(first.adapter.dispatch({} as never)).rejects.toThrow('stale invocation 0');
    expect(rawAdapters[0]!.dispatch).not.toHaveBeenCalled();
    expect(await second.adapter.dispatch({} as never)).toEqual({ exitCode: 0 });
    expect(rawAdapters[1]!.dispatch).toHaveBeenCalledTimes(1);
    const aborted = new AbortController(); aborted.abort(new Error('child cancelled'));
    await expect(second.adapter.dispatch({ signal: aborted.signal } as never)).rejects.toThrow('child cancelled');
    expect(rawAdapters[1]!.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(['aborted', 'stale'])('rejects a physical Forge host %s open before any effects', async fault => {
    const openRegistry = vi.fn(); const createAdapter = vi.fn(); const createEffects = vi.fn();
    const reason = new Error(fault);
    const controller = new AbortController();
    if (fault === 'aborted') controller.abort(reason);
    const captureAuthority = vi.fn(() => () => { throw reason; });
    const host = ownedForgeHost.createForgeHostServices({ openRegistry, createAdapter, createEffects, captureAuthority });
    const context: InvocationContext = { invocationId: 'refused', cwd: '/fixture', platform: 'darwin-arm64', config: {}, signal: controller.signal };
    await expect(Promise.resolve().then(() => host.open(context))).rejects.toBe(reason);
    expect(captureAuthority).toHaveBeenCalledTimes(fault === 'aborted' ? 0 : 1);
    expect(openRegistry).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(createEffects).not.toHaveBeenCalled();
  });

  it.each([undefined, null])('rejects an invalid physical Forge authority result %s before transport', async result => {
    const openRegistry = vi.fn(); const createAdapter = vi.fn(); const createEffects = vi.fn();
    const host = ownedForgeHost.createForgeHostServices({ openRegistry, createAdapter, createEffects,
      captureAuthority: () => result as never });
    const context: InvocationContext = { invocationId: 'invalid-authority', cwd: '/fixture', platform: 'darwin-arm64', config: {}, signal: new AbortController().signal };
    await expect(Promise.resolve().then(() => host.open(context))).rejects.toThrow(TypeError);
    expect(openRegistry).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(createEffects).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'healthCheckTimeoutSec', 'earlyFinalizeCount', 'finalizeOnScore'] as const)(
    'rejects non-string %s at the direct export before host effects', async key => {
      const listActive = vi.fn(async () => ['fixture']);
      const services = { engines: { listActive } } as unknown as ModServices;
      for (const value of [30, 0, -1, null, true, [], {}]) {
        const outcome = await runCompetition({ task: 'fixture', [key]: value }, {
          invocationId: 'invalid-forge-option', cwd: '/unused', platform: 'darwin-arm64',
          signal: new AbortController().signal, config: {},
        }, services);
        expect(outcome).toMatchObject({ exitCode: 1, stderr: `Forge ${key} must be provided as a string.\n` });
      }
      expect(listActive).not.toHaveBeenCalled();
    },
  );

  it('forwards caller cancellation and its reason into health probes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-health-abort-'));
    const controller = new AbortController();
    const reason = new Error('fixture cancelled during health probe');
    let probeSignal: AbortSignal | undefined;
    const events: string[] = [];
    vi.stubEnv('AGON_DISABLE_FORGE_HEALTH_CHECK', '');
    try {
      for (const args of [['init', '--quiet'], ['-c', 'user.name=Fixture', '-c',
        'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']]) {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
      }
      const services = withForgeHost({ engines: { listActive: async () => ['fixture'] },
        logger: { debug: async () => {} }, receipts: { record: async () => 'fixture' },
      } as unknown as ModServices, true);
      const open = services.forge!.open;
      const configured = { ...services, forge: { async open(context: InvocationContext) {
        const opened = await open(context);
        return { ...opened, adapter: { ...opened.adapter, dispatchAgent: async options => {
          probeSignal = options.signal;
          controller.abort(reason);
          return { exitCode: 130, stdout: '', stderr: 'cancelled', durationMs: 0, timedOut: false,
            diff: '', diffLines: 0, filesChanged: 0 };
        } } };
      } } } satisfies typeof services;
      await expect(runCompetition({ task: 'fixture', test: 'true' }, {
        invocationId: 'health-abort', cwd: root, platform: 'darwin-arm64', signal: controller.signal,
        config: {}, onWorkflowEvent: event => { events.push(event.type); },
      }, configured)).rejects.toBe(reason);
      expect(probeSignal?.aborted).toBe(true);
      expect(probeSignal?.reason).toBe(reason);
      expect(events).not.toContain('stage1:start');
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['completed', 'repository-failure', 'setup-throw'] as const)('releases the caller abort listener after %s', async fault => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-listener-'));
    try {
      for (const args of [['init', '--quiet'], ['-c', 'user.name=Fixture', '-c',
        'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']]) {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
      }
      const services = withForgeHost({
        engines: { listActive: async () => ['fixture'], dispatch: async (_id: string, _prompt: string, context: InvocationContext) => {
          writeFileSync(join(context.cwd, 'result.txt'), 'candidate\n');
          return { exitCode: 0, stdout: 'implemented', stderr: '' };
        } }, logger: { debug: async () => {} }, receipts: { record: async () => 'fixture' },
      } as unknown as ModServices);
      const open = services.forge!.open;
      const configured = { ...services, forge: { async open(context: InvocationContext) {
        const opened = await open(context);
        return { ...opened, effects: { ...opened.effects,
          ...(fault === 'repository-failure' ? { repoRoot: () => { throw new Error('fixture repository failure'); } } : {}),
          ...(fault === 'setup-throw' ? { buildKernContextSpine: async () => { throw new Error('fixture setup failure'); } } : {}),
        } };
      } } };
      const signal = new AbortController().signal;
      const outcome = await runCompetition({ task: 'fixture', test: 'true', noHealthCheck: true }, {
        invocationId: 'listener-cleanup', cwd: root, platform: 'darwin-arm64', signal, config: {},
      }, configured).catch(error => error);
      if (fault === 'setup-throw') expect(outcome).toMatchObject({ message: 'fixture setup failure' });
      else expect(outcome.exitCode).toBe(fault === 'completed' ? 0 : 1);
      expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('drains timed-out synthesis before removing its worktree or publishing completion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-synthesis-drain-'));
    let workerFinished = false;
    let synthesisStarted = false;
    let timedOut = false;
    let cleanupWhileRunning = false;
    let worktreeSurvived = false;
    let finishWorker!: () => void;
    const workerDone = new Promise<void>(resolve => { finishWorker = resolve; });
    try {
      for (const args of [['init', '--quiet'], ['-c', 'user.name=Fixture', '-c',
        'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']]) {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
      }
      const services = withForgeHost({
        engines: { listActive: async () => ['alpha', 'beta'],
          dispatch: async (_id: string, _prompt: string, context: InvocationContext, options: { mode?: string }) => {
            if (context.cwd.endsWith('/synth-worktree')) {
              synthesisStarted = true;
              try {
                await new Promise<void>(resolve => {
                  const drain = () => {
                    timedOut = true;
                    // The worker outlives the legacy one-second cleanup grace.
                    setTimeout(resolve, 1500);
                  };
                  if (context.signal.aborted) drain();
                  else context.signal.addEventListener('abort', drain, { once: true });
                });
                worktreeSurvived = existsSync(context.cwd);
                return { exitCode: 130, stdout: '', stderr: 'cancelled' };
              } finally { workerFinished = true; finishWorker(); }
            }
            if (options.mode === 'review') return { exitCode: 0, stdout: '[{"file":"result.txt","problem":"check boundary","minimalFix":"validate"}]' };
            writeFileSync(join(context.cwd, 'result.txt'), 'candidate\n');
            return { exitCode: 0, stdout: 'implemented', stderr: '' };
          },
        },
        logger: { debug: async () => {} }, receipts: { record: async () => 'fixture' },
      } as unknown as ModServices);
      const open = services.forge!.open;
      const configured = { ...services, forge: { async open(context: InvocationContext) {
        const opened = await open(context);
        return { ...opened, effects: { ...opened.effects,
          loadConfig: cwd => ({ ...opened.effects.loadConfig(cwd), forgeEnableSynthesis: true,
            forgeSynthesisTimeout: 1, forgeClearWinnerSpread: 101 }),
          worktreeRemoveBestEffort: (repo, path) => {
            if (path.endsWith('/synth-worktree') && !workerFinished) cleanupWhileRunning = true;
            opened.effects.worktreeRemoveBestEffort(repo, path);
          },
        } };
      } } } satisfies typeof services;
      const outcome = await runCompetition({ task: 'fixture', test: 'true', noHealthCheck: true }, {
        invocationId: 'synthesis-drain', cwd: root, platform: 'darwin-arm64',
        signal: new AbortController().signal, config: {},
      }, configured);
      const completedBeforeWorker = !workerFinished;
      if (synthesisStarted) await workerDone;
      expect(synthesisStarted).toBe(true);
      expect(timedOut).toBe(true);
      expect(cleanupWhileRunning).toBe(false);
      expect(completedBeforeWorker).toBe(false);
      expect(worktreeSurvived).toBe(true);
      expect(outcome.exitCode).toBe(0);
      expect(outcome.result).toMatchObject({ status: 'winner', winner: expect.stringMatching(/^(alpha|beta)$/) });
    } finally {
      if (synthesisStarted) await workerDone;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves a provisional winner but fails publication after a workflow error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-workflow-error-'));
    const reason = 'fixture publication failed after winner selection';
    const receipts: unknown[] = [];
    let injected = false;
    try {
      for (const args of [['init', '--quiet'], ['-c', 'user.name=Fixture', '-c',
        'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']]) {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
      }
      const services = withForgeHost({
        engines: { listActive: async () => ['fixture'], dispatch: async (_id: string, _prompt: string, context: InvocationContext) => {
          writeFileSync(join(context.cwd, 'result.txt'), 'candidate\n');
          return { exitCode: 0, stdout: 'implemented', stderr: '' };
        } },
        logger: { debug: async () => {} },
        receipts: { record: async (kind: string, payload: unknown) => { receipts.push({ kind, payload }); return 'fixture'; } },
      } as unknown as ModServices);
      const sourceObserver = vi.fn();
      const open = services.forge!.open;
      const observedServices = { ...services, forge: { async open(context: InvocationContext) {
        const opened = await open(context);
        return { ...opened, effects: { ...opened.effects, stages: { ...opened.effects.stages,
          fitness: { ...opened.effects.stages.fitness, observeCommand: sourceObserver },
        } } };
      } } };
      const outcome = await runCompetition({ task: 'fixture', test: 'true', noHealthCheck: true }, {
        invocationId: 'workflow-error', cwd: root, platform: 'darwin-arm64',
        signal: new AbortController().signal, config: {},
        onWorkflowEvent: event => {
          if (event.type === 'forge:done') { injected = true; throw new Error(reason); }
        },
      }, observedServices);
      expect(injected).toBe(true);
      expect(sourceObserver.mock.calls.map(call => call[0])).toEqual(['baseline', 'fixture']);
      expect(outcome).toMatchObject({ exitCode: 1, failure: { code: 'FORGE_WORKFLOW_FAILED', message: reason },
        result: { status: 'failed', error: reason, winner: 'fixture', candidates: [{ engineId: 'fixture', pass: true }] } });
      expect(receipts).toMatchObject([{ kind: 'forge', payload: { status: 'failed', error: reason } }]);
      const result = outcome.result as { runDir: string };
      expect(JSON.parse(readFileSync(join(result.runDir, 'status.json'), 'utf8'))).toMatchObject({ ok: false, summary: reason });
      const manifest = JSON.parse(readFileSync(join(result.runDir, 'manifest.json'), 'utf8'));
      expect(manifest).toMatchObject({ status: 'failed', error: reason, winner: 'fixture' });
      const published = JSON.parse(readFileSync(join(result.runDir, 'competition.json'), 'utf8'));
      expect(published.candidates[0].durationMs).toBe(manifest.dispatchLog[0].totalDurationMs);
      expect(published.candidates[0].fitnessDurationMs).toBe(sourceObserver.mock.calls[1][2].durationMs);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('does not open transport until an invocation and rejects a cancelled open', async () => {
    const registry = {} as EngineRegistry;
    const adapter = {} as EngineAdapter;
    const openRegistry = vi.fn(() => registry);
    const createAdapter = vi.fn(() => adapter);
    const host = createForgeHostServices(openRegistry, createAdapter);
    expect(openRegistry).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    const controller = new AbortController();
    const reason = new Error('cancel before opening Forge');
    controller.abort(reason);
    const context: InvocationContext = {
      invocationId: 'forge-host-cancel', cwd: '/unused-forge-host-fixture',
      platform: 'darwin-arm64', signal: controller.signal, config: {},
    };
    await expect(Promise.resolve().then(() => host.open(context))).rejects.toBe(reason);
    expect(openRegistry).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    const opened = await host.open({ ...context, signal: new AbortController().signal });
    expect(openRegistry).toHaveBeenCalledExactlyOnceWith(context.cwd);
    expect(createAdapter).toHaveBeenCalledExactlyOnceWith(registry);
    expect(opened.registry).toBe(registry);
    expect(opened.adapter).not.toBe(adapter);
    expect(opened.adapter.dispatch).toBeTypeOf('function');
    expect(opened.effects).not.toHaveProperty('runForge');
  });

  it.each(['dispatch', 'dispatchAgent', 'dispatchStream', 'dispatchAgentStream', 'isAvailable', 'getVersion'] as const)(
    'blocks stale and cancelled Forge transport before %s', async method => {
      const calls: string[] = [];
      const raw = {
        dispatch: async () => { calls.push('dispatch'); return {}; },
        dispatchAgent: async () => { calls.push('dispatchAgent'); return {}; },
        dispatchStream: async function* () { calls.push('dispatchStream'); yield 'chunk'; return {}; },
        dispatchAgentStream: async function* () { calls.push('dispatchAgentStream'); yield 'chunk'; return {}; },
        isAvailable: async () => { calls.push('isAvailable'); return true; },
        getVersion: async () => { calls.push('getVersion'); return 'fixture'; },
      } as EngineAdapter;
      for (const fault of ['stale', 'cancelled'] as const) {
        let stale = false;
        const controller = new AbortController();
        const reason = new Error(fault);
        const host = createForgeHostServices(() => ({} as EngineRegistry), () => raw,
          () => () => { if (stale) throw reason; });
        const { adapter } = await host.open({ invocationId: 'forge-host-guard',
          cwd: '/unused-forge-host-fixture', platform: 'darwin-arm64', config: {}, signal: controller.signal });
        if (fault === 'stale') stale = true;
        else controller.abort(reason);
        const invoke = async () => {
          const options = {} as Parameters<EngineAdapter['dispatch']>[0];
          if (method === 'dispatchStream' || method === 'dispatchAgentStream') {
            await adapter[method]!(options).next();
          } else if (method === 'isAvailable' || method === 'getVersion') {
            await adapter[method]({} as Parameters<EngineAdapter['isAvailable']>[0]);
          } else await adapter[method]!(options);
        };
        await expect(invoke()).rejects.toBe(reason);
        expect(calls).toEqual([]);
      }
    },
  );

  it('settles every candidate before cleaning an arena after one candidate fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-drain-'));
    let releaseSlow!: () => void;
    const slowRelease = new Promise<void>(resolve => { releaseSlow = resolve; });
    let announceSlow!: () => void;
    const slowStarted = new Promise<void>(resolve => { announceSlow = resolve; });
    let finishSlow!: () => void;
    const slowFinished = new Promise<void>(resolve => { finishSlow = resolve; });
    let settledEarly = false;
    let slowHadWorktree = false;
    let cleanupBeforeSlowFinished = false;
    let slowDone = false;
    let invocation: Promise<{ result?: CommandResult; error?: unknown }> | undefined;
    try {
      for (const args of [['init', '--quiet'], ['-c', 'user.name=Fixture', '-c',
        'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']]) {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
      }
      const services = {
        engines: { listActive: async () => ['broken', 'slow'],
          dispatch: async (engine: string, _prompt: string, context: InvocationContext) => {
            if (engine === 'broken') {
              await slowStarted;
              // Break only this disposable candidate's Git link.
              unlinkSync(join(context.cwd, '.git'));
              return { exitCode: 1, stderr: 'fixture candidate failed' };
            }
            announceSlow();
            try {
              await slowRelease;
              slowHadWorktree = existsSync(context.cwd);
              if (slowHadWorktree) writeFileSync(join(context.cwd, 'result.txt'), 'completed\n');
              return { exitCode: 0, stdout: 'implemented', stderr: '' };
            } finally { slowDone = true; finishSlow(); }
          },
        },
        logger: { debug: async () => { cleanupBeforeSlowFinished = !slowDone; } },
        receipts: { record: async () => 'fixture' },
      } as unknown as ModServices;
      invocation = runForgeCompetition({ task: 'fixture', noHealthCheck: true, test: 'true' }, {
        invocationId: 'forge-drain', cwd: root, platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
      }, services).then(result => ({ result }), error => ({ error })).then(result => { settledEarly = !slowDone; return result; });
      await slowStarted;
      // Drain promise reactions before releasing the still-running sibling.
      await new Promise<void>(resolve => setImmediate(resolve));
      const returnedBeforeRelease = settledEarly;
      releaseSlow();
      await slowFinished;
      const outcome = await invocation;
      expect(outcome.error).toBeUndefined();
      expect(outcome.result).toMatchObject({ exitCode: 0, result: {
        winner: 'slow', candidates: expect.arrayContaining([
          expect.objectContaining({ engineId: 'broken', pass: false, status: 'dispatch_failed' }),
          expect.objectContaining({ engineId: 'slow', pass: true, diff: expect.stringContaining('completed') }),
        ]),
      } });
      expect(returnedBeforeRelease).toBe(false);
      expect(cleanupBeforeSlowFinished).toBe(false);
      expect(slowHadWorktree).toBe(true);
    } finally {
      releaseSlow();
      await invocation;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the legacy classifier as the physical owner export', () => {
    expect(classifyNoDiffForgeResult).toBe(ownedNoDiffPolicy);
  });
  it.each(([
    { name: 'tool-loop exhaustion', mode: 'improve', requireDiff: false, acceptReviewOutput: true,
      stdout: 'API engine reached the 40-step tool loop limit after 40 tool calls; evaluating any candidate worktree changes with fitness.', pass: false },
    { name: 'short report with required diff', mode: 'validate', requireDiff: true, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', pass: false },
    { name: 'explicitly accepted implementation report', mode: 'implement', requireDiff: true, acceptReviewOutput: true,
      stdout: 'The review covers module exports, use-from semantics, external boundaries, and test gaps; it recommends retaining the implementation because all checked behaviors pass.', pass: true },
    { name: 'baseline no-op without required diff', mode: 'improve', requireDiff: false, acceptReviewOutput: true,
      stdout: 'No changes needed.', pass: true },
    { name: 'baseline no-op with required diff', mode: 'validate', requireDiff: true, acceptReviewOutput: true,
      stdout: 'No changes needed.', pass: false },
    { name: 'failing fitness', mode: 'validate', requireDiff: false, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', fitness: 'false', pass: false },
    { name: 'dispatch timeout', mode: 'validate', requireDiff: false, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', exitCode: 124, timedOut: true, pass: false },
    { name: 'dispatch cancellation', mode: 'validate', requireDiff: false, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', exitCode: 130, pass: false },
    { name: 'explicitly rejected implementation report', mode: 'implement', requireDiff: true, acceptReviewOutput: false,
      stdout: 'The review covers module exports, use-from semantics, external boundaries, and test gaps; it recommends retaining the implementation because all checked behaviors pass.', pass: false },
  ] as const).map(fixture => ({ fitness: 'true', exitCode: 0, timedOut: false, ...fixture })))('preserves legacy no-diff verdict: $name', async fixture => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-no-diff-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-no-diff-parity', activeOwners: [owner] });
    let dispatchCount = 0;
    try {
      git('init', '--quiet');
      writeFileSync(join(root, 'fixture.txt'), 'unchanged\n');
      git('add', 'fixture.txt');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture');
      const session = registry.beginRegistration(MANIFEST);
      const mod = await createMod({
        engines: {
          listActive: async () => ['fixture'],
          dispatch: async () => { dispatchCount += 1; return { exitCode: fixture.exitCode, timedOut: fixture.timedOut, stdout: fixture.stdout, stderr: '' }; },
        },
        receipts: { record: async () => 'fixture-receipt' },
        logger: { debug: async () => {} },
      } as unknown as ModServices);
      await mod.activate(session.registrar);
      session.commit();
      const legacy = classifyNoDiffForgeResult({ ...fixture,
        fitnessPassed: fixture.fitness === 'true', baselinePasses: fixture.fitness === 'true' });
      expect(legacy.pass).toBe(fixture.pass);
      const command = registry.project('cli').entries[0]!.payload as CommandContribution;
      const result = await command.run({ task: 'inspect fixture', test: fixture.fitness, noHealthCheck: true,
        mode: fixture.mode, requireDiff: fixture.requireDiff, acceptReviewOutput: fixture.acceptReviewOutput }, {
        invocationId: 'forge-no-diff-parity', cwd: root, platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
      });
      expect(dispatchCount).toBe(1);
      // Stage dispatch rejection precedes the no-diff classifier.
      const verdict = fixture.exitCode === 130
        ? { pass: false, score: 0, engineCompleted: false, status: 'dispatch_failed', reason: 'dispatch exited with code 130' }
        : legacy;
      expect(result).toMatchObject({ exitCode: fixture.pass ? 0 : 1, result: {
        winner: fixture.pass ? 'fixture' : null, candidates: [{ ...verdict, diffLines: 0 }],
      } });
      expect(git('status', '--porcelain')).toBe('');
      expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    } finally {
      await registry.disposeOwner(owner.id);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['npm test', 'false', 'node check.mjs'])('preserves the intent fitness command through physical execution: %s', async fitness => {
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-input-parity', activeOwners: [owner] });
    const session = registry.beginRegistration(MANIFEST);
    const mod = await createMod({ engines: {
      listActive: async () => ['fixture'],
      dispatch: async () => { throw new Error('dry-run must not dispatch'); },
    } } as unknown as ModServices);
    await mod.activate(session.registrar);
    session.commit();
    try {
      const intent = registry.resolve('intent', 'intentVariants:0032')!.payload as IntentContribution;
      const parsed = await intent.parse(`/forge fix the defect test with ${fitness}`);
      expect(parsed).toMatchObject({ fitnessCmd: fitness });
      const context: InvocationContext = { invocationId: 'forge-input-parity', cwd: '/fixture', platform: 'darwin-arm64',
        signal: new AbortController().signal, config: {} };
      const result = await intent.run({ ...(parsed as object), dryRun: true, noHealthCheck: true }, context);
      expect(result).toMatchObject({ exitCode: 0, result: { fitness, fitnessProvided: true } });
      const command = registry.project('cli').entries[0]!.payload as CommandContribution;
      expect(await command.run({ task: 'fixture', test: fitness, dryRun: true, noHealthCheck: true }, context))
        .toMatchObject({ exitCode: 0, result: { fitness, fitnessProvided: true } });
      expect(await command.run({ task: 'fixture', test: fitness, fitnessCmd: 'ignored compatibility value', dryRun: true, noHealthCheck: true }, context))
        .toMatchObject({ exitCode: 0, result: { fitness, fitnessProvided: true } });
    } finally { await registry.disposeOwner(owner.id); }
  });

  it.each(['false', 'true', 'printf generated > generated.txt'])('executes the parsed fitness command in real worktrees: %s', async fitness => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-fitness-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-fitness-runtime', activeOwners: [owner] });
    const contexts: string[] = [];
    const cleanups: Array<{ worktreePaths: string[]; cleanupComplete: boolean }> = [];
    try {
      git('init', '--quiet');
      writeFileSync(join(root, 'fixture.txt'), 'before\n');
      git('add', 'fixture.txt');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture');
      const session = registry.beginRegistration(MANIFEST);
      const mod = await createMod({
        engines: {
          listActive: async () => ['fixture'],
          dispatch: async (_engine: string, prompt: string, context: InvocationContext) => {
            expect(prompt).toContain(`## FITNESS TEST\nRun this command to verify your work passes:\n\`\`\`\n${fitness}\n\`\`\``);
            contexts.push(context.cwd);
            expect(context.cwd).not.toBe(root);
            writeFileSync(join(context.cwd, 'fixture.txt'), 'after\n');
            return { exitCode: 0, stdout: 'fixture implementation', stderr: '' };
          },
        },
        receipts: { record: async () => 'fixture-receipt' },
        logger: { debug: async (_message: string, fields: { worktreePaths: string[]; cleanupComplete: boolean }) => { cleanups.push(fields); } },
      } as unknown as ModServices);
      await mod.activate(session.registrar);
      session.commit();
      const intent = registry.resolve('intent', 'intentVariants:0032')!.payload as IntentContribution;
      const parsed = await intent.parse(`/forge change fixture test with ${fitness}`);
      const result = await intent.run({ ...(parsed as object), noHealthCheck: true }, {
        invocationId: 'forge-fitness-runtime', cwd: root, platform: 'darwin-arm64',
        signal: new AbortController().signal, config: {},
      });
      const passes = fitness !== 'false';
      const generatesFile = fitness.includes('generated.txt');
      expect(result).toMatchObject({ exitCode: passes ? 0 : 1, result: {
        fitness, fitnessProvided: true, winner: passes ? 'fixture' : null,
        status: passes ? 'winner' : 'no_passing_candidate',
        baseline: { command: fitness, exitCode: passes ? 0 : 1 },
        candidates: [{ fitnessPassed: passes, pass: passes, filesChanged: generatesFile ? 2 : 1 }],
      } });
      if (generatesFile) {
        expect(result.result).toMatchObject({ winningPatch: expect.stringContaining('+generated') });
      }
      expect(contexts).toHaveLength(1);
      expect(cleanups).toHaveLength(1);
      expect(cleanups[0].cleanupComplete).toBe(true);
      expect(cleanups[0].worktreePaths.every(path => !existsSync(path))).toBe(true);
      expect(readFileSync(join(root, 'fixture.txt'), 'utf8')).toBe('before\n');
      expect(git('status', '--porcelain')).toBe('');
      expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    } finally {
      await registry.disposeOwner(owner.id);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['before-start', 'baseline', 'candidate', 'internal-finalization', 'dry-finish'] as const)(
    'separates caller cancellation from Forge early finalization: %s', async phase => {
      const root = mkdtempSync(join(tmpdir(), 'agon-forge-phase-'));
      const git = (...args: string[]) => {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      };
      const controller = new AbortController();
      const reason = new Error('cancel physical Forge');
      const started = join(root, 'baseline.started');
      const scriptPath = join(root, 'wait.mjs');
      let settled: Promise<{ result?: unknown; error?: unknown }> | undefined;
      const cleanups: Array<{ worktreePaths: string[]; cleanupComplete: boolean }> = [];
      let loserAborted = false;
      const record = vi.fn(async () => 'fixture-receipt');
      const dispatch = vi.fn(async (engine: string, _prompt: string, context: InvocationContext) => {
        if (engine === 'slow') return await new Promise(resolve => {
          const timer = setTimeout(() => resolve({ exitCode: 1, stdout: '' }), 3000);
          const abort = () => { loserAborted = true; clearTimeout(timer); resolve({ exitCode: 130, stdout: '' }); };
          if (context.signal.aborted) abort();
          else context.signal.addEventListener('abort', abort, { once: true });
        });
        writeFileSync(join(context.cwd, 'fixture.txt'), 'after\n');
        if (phase === 'candidate') controller.abort(reason);
        return { exitCode: 0, stdout: 'fixture implementation', stderr: '' };
      });
      try {
        git('init', '--quiet');
        writeFileSync(join(root, 'fixture.txt'), 'before\n');
        git('add', 'fixture.txt');
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
        writeFileSync(scriptPath, `import { writeFileSync } from 'node:fs';
          writeFileSync(${JSON.stringify(started)}, String(process.pid)); setTimeout(() => {}, 4000);`);
        if (phase === 'before-start') controller.abort(reason);
        const services = { engines: { listActive: async () => ['fixture', 'slow', 'judge'], dispatch },
          receipts: { record }, logger: { debug: async (_message: string, fields: { worktreePaths: string[]; cleanupComplete: boolean }) => { cleanups.push(fields); } },
          ...(phase === 'dry-finish' ? { runs: {
            start: async () => ({ path: 'fixture-run', startedAt: new Date().toISOString() }),
            finish: async () => { controller.abort(reason); },
          } } : {}),
        } as unknown as ModServices;
        settled = runForgeCompetition({ task: 'fixture', engines: phase === 'internal-finalization' ? 'fixture,slow' : 'fixture',
          dryRun: phase === 'dry-finish',
          test: phase === 'baseline' ? `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}` : 'true',
          judge: phase === 'candidate' ? 'judge' : '', noHealthCheck: true, earlyFinalizeCount: '1' }, {
          invocationId: 'forge-phase', cwd: root, platform: 'darwin-arm64', signal: controller.signal, config: {},
        }, services).then(result => ({ result }), error => ({ error }));
        if (phase === 'baseline') {
          await expect.poll(() => existsSync(started), { timeout: 3000 }).toBe(true);
          controller.abort(reason);
        }
        const outcome = await settled;
        if (phase === 'internal-finalization') {
          expect(outcome).toMatchObject({ result: { exitCode: 0, result: { winner: 'fixture', earlyFinalized: true } } });
          expect(controller.signal.aborted).toBe(false);
          expect(loserAborted).toBe(true);
          expect(record).toHaveBeenCalledOnce();
        } else {
          expect(outcome.error).toBe(reason);
          expect(record).not.toHaveBeenCalled();
          expect(dispatch).toHaveBeenCalledTimes(phase === 'candidate' ? 1 : 0);
        }
        expect(cleanups).toHaveLength(phase === 'before-start' || phase === 'dry-finish' ? 0 : 1);
        for (const cleanup of cleanups) {
          expect(cleanup.cleanupComplete).toBe(true);
          expect(cleanup.worktreePaths.every(path => !existsSync(path))).toBe(true);
          if (phase === 'baseline' || phase === 'candidate') {
            const manifestPath = join(dirname(cleanup.worktreePaths[0]), 'manifest.json');
            expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toMatchObject({
              status: 'failed', error: reason.message,
            });
          }
        }
        expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
        expect(readFileSync(join(root, 'fixture.txt'), 'utf8')).toBe('before\n');
      } finally {
        controller.abort(reason);
        await settled;
        rmSync(root, { recursive: true, force: true });
      }
    }, 10000,
  );

  it('validates migration metadata without allowing unknown value-schema keywords', () => {
    const base = { type: 'object', properties: { enabled: { type: 'boolean', default: true } } };
    const resolve = (schema: object) => resolveRegisteredModSettings('example.settings', {}, [schema]);
    expect(resolve({ ...base, 'x-agon-config': { version: 1, legacyAliases: ['enabled'] } })).toEqual({ enabled: true });
    for (const descriptor of [null, { version: 2, legacyAliases: [] }, { version: 1, legacyAliases: ['enabled', 'enabled'] },
      { version: 1, legacyAliases: ['constructor'] }, { version: 1, legacyAliases: ['unknown'] }, { version: 1, legacyAliases: [], run: 'code' }]) {
      expect(() => resolve({ ...base, 'x-agon-config': descriptor })).toThrow(/descriptor|alias/);
    }
    expect(() => resolve({ ...base, 'x-unknown': {} })).toThrow(/unsupported schema keyword/);
  });
  it('keeps mutable compatibility defaults independent of generated defaults', () => {
    const compatibility = DEFAULT_AGON_CONFIG.goalReviewEngines;
    const generated = DEFAULT_FIRST_PARTY_SETTINGS.goalReviewEngines;
    expect(compatibility).not.toBe(generated);
    const before = [...generated];
    try {
      generated.push('fixture-mutation');
      expect(compatibility).not.toContain('fixture-mutation');
    } finally { generated.splice(0, generated.length, ...before); }
  });
  it('ships its assigned defaults in the owner schema', () => {
    const schema = JSON.parse(readFileSync(new URL('../../packages/mod-forge/schemas/config.schema.json', import.meta.url), 'utf8'));
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-ownership.json', import.meta.url), 'utf8'));
    const keys = ledger.assignments.filter((item: { category: string; package: string }) => item.category === 'configKeys' && item.package === '@kernlang/agon-mod-forge')
      .map((item: { id: string }) => item.id).sort();
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(keys);
    expect(schema.properties).toEqual({
      autoReviewAfterForge: { type: 'boolean', default: true },
      forgeFitnessTimeout: { type: 'number', default: 120 },
    });
    expect(DEFAULT_FIRST_PARTY_SETTINGS).toMatchObject(Object.fromEntries(
      Object.entries(schema.properties as Record<string, { default: unknown }>).map(([key, property]) => [key, property.default]),
    ));
  });

  it.each([
    ['review', () => import('../../packages/mod-review/src/index.js'), { autoReviewAfterImpl: true, goalReviewEngines: [] }],
    ['agent', () => import('../../packages/mod-agent/src/index.js'), { cesarAgenticContinuationLimit: 12 }],
    ['mutate', () => import('../../packages/mod-mutate/src/index.js'), { cesarMutateReflex: true }],
    ['synthesis', () => import('../../packages/mod-synthesis/src/index.js'), { forgeEnableSynthesis: false, forgeSynthesisTimeout: 300, skillSynthesisThreshold: 3 }],
  ] as const)('%s owns and registers its configuration', async (name, load, expected) => {
    const { MANIFEST: declaration, createMod: factory } = await load();
    const owner = { id: declaration.id, version: declaration.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'remaining-settings', activeOwners: [owner] });
    const session = registry.beginRegistration(declaration);
    const mod = await factory(new Proxy({} as ModServices, { get() { throw new Error('unexpected host effect'); } }));
    await mod.activate(session.registrar);
    session.commit();
    const schema = JSON.parse(readFileSync(new URL(`../../packages/mod-${name}/schemas/config.schema.json`, import.meta.url), 'utf8'));
    const schemas = declaration.contributes.configKeys.map(({ id }) => registry.resolve('config', id)!.payload);
    const { $id: _schemaId, ...registeredSchema } = schema;
    for (const payload of schemas) expect(payload).toEqual(registeredSchema);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(Object.keys(expected).sort());
    expect(resolveRegisteredModSettings(owner.id, {}, schemas)).toEqual(expected);
    const explicit = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, Array.isArray(value) ? ['fixture-engine'] : typeof value === 'boolean' ? false : 0]));
    expect(resolveRegisteredModSettings(owner.id, { ...explicit, future: 'keep' }, schemas)).toEqual({ ...explicit, future: 'keep' });
    const command = (registry.project('cli').entries[0] ?? registry.project('tui').entries[0]).payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'remaining-invalid', cwd: '/fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: { [Object.keys(expected)[0]]: null } };
    expect(() => command.run({}, context)).toThrow(/mod settings for agon\./);
    for (const key of Object.keys(expected)) {
      expect(() => command.run({}, { ...context, config: { [key]: null } })).toThrow(/mod settings for agon\./);
    }
    if (name === 'review') {
      expect(() => command.run({}, { ...context, config: { goalReviewEngines: ['valid', 3] } })).toThrow(/mod settings/);
      const first = resolveRegisteredModSettings(owner.id, {}, schemas).goalReviewEngines;
      const second = resolveRegisteredModSettings(owner.id, {}, schemas).goalReviewEngines;
      expect(first).not.toBe(second);
      expect(first).not.toBe(schema.properties.goalReviewEngines.default);
      expect(Object.isFrozen(first)).toBe(true);
    }
    await registry.disposeOwner(owner.id);
    expect(() => command.run({}, { ...context, config: {} })).toThrow(/unavailable/);
  });

  it('generates exactly the defaults assigned to the five mod owners', () => {
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-ownership.json', import.meta.url), 'utf8'));
    const expected: Record<string, unknown> = {};
    for (const name of ['forge', 'review', 'agent', 'mutate', 'synthesis']) {
      const schema = JSON.parse(readFileSync(new URL(`../../packages/mod-${name}/schemas/config.schema.json`, import.meta.url), 'utf8'));
      const keys = ledger.assignments.filter((item: { category: string; package: string }) => item.category === 'configKeys' && item.package === `@kernlang/agon-mod-${name}`)
        .map((item: { id: string }) => item.id).sort();
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(keys);
      for (const key of keys) expected[key] = schema.properties[key].default;
    }
    expect(DEFAULT_FIRST_PARTY_SETTINGS).toEqual(expected);
  });

  it('registers executable defaults and rejects invalid settings before effects', async () => {
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-settings', activeOwners: [owner] });
    const session = registry.beginRegistration(MANIFEST);
    // Activation must only register contributions, not use host effects.
    const mod = await createForgeMod(new Proxy({} as ModServices, { get() { throw new Error('unexpected host effect'); } }));
    await mod.activate(session.registrar);
    session.commit();
    const schemas = MANIFEST.contributes.configKeys.map(({ id }) => registry.resolve('config', id)!.payload);
    expect(resolveRegisteredModSettings(owner.id, {}, schemas)).toEqual({ autoReviewAfterForge: true, forgeFitnessTimeout: 120 });
    expect(resolveRegisteredModSettings(owner.id, { autoReviewAfterForge: false, forgeFitnessTimeout: 0, future: 'keep' }, schemas))
      .toEqual({ autoReviewAfterForge: false, forgeFitnessTimeout: 0, future: 'keep' });
    const command = registry.project('cli').entries[0].payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'forge-invalid', cwd: '/fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
    for (const config of [{ forgeFitnessTimeout: 'wrong' }, { forgeFitnessTimeout: null }, { forgeFitnessTimeout: Infinity }, { autoReviewAfterForge: 'false' }]) {
      expect(() => command.run({}, { ...context, config })).toThrow(/mod settings for agon.forge/);
    }
    for (const schema of schemas) expect(schema).not.toHaveProperty('$id');
    await registry.disposeOwner(owner.id);
    expect(() => command.run({}, { ...context, config: {} })).toThrow(/unavailable/);
  });

  it('generates from owner inputs, rejects invalid definitions and detects stale output', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const reExports = (source: string) => ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
      .statements.flatMap(statement => {
        if (!ts.isExportDeclaration(statement)) return [];
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)
          || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) throw new Error('expected named public re-exports');
        const module = statement.moduleSpecifier.text;
        return statement.exportClause.elements.map(entry => JSON.stringify([
          entry.name.text, (entry.propertyName ?? entry.name).text,
          statement.isTypeOnly || entry.isTypeOnly ? 'type' : 'value', module,
        ]));
      }).sort();
    // Capture the authored contract outside the generator's disposable fixture.
    const authoredExports = Object.fromEntries(['plan', 'forge'].map(mod => [mod,
      reExports(readFileSync(join(root, `packages/mod-${mod}/src/index.ts`), 'utf8'))]));
    const fixture = mkdtempSync(join(tmpdir(), 'forge-settings-generator-'));
    try {
      const inputs = ['scripts/spec/generate-modular-first-party-packages.mjs', 'LICENSE', 'package.json', 'tsconfig.json',
        ...['package-map', 'ownership', 'current-inventory', 'ui-hierarchy', 'physical-contributions'].map(name => `docs/specs/evidence/modular-agon-${name}.json`)];
      const packages = JSON.parse(readFileSync(join(root, inputs[4]), 'utf8')).packages as { id: string; class: string }[];
      for (const pkg of packages.filter(item => item.class === 'user-toggleable-mod-package')) {
        const path = `packages/${pkg.id.replace('@kernlang/agon-', '')}`;
        inputs.push(`${path}/schemas/config.schema.json`);
        if (existsSync(join(root, path, 'src/implementation.ts'))) inputs.push(`${path}/src/implementation.ts`);
      }
      for (const input of inputs) {
        mkdirSync(dirname(join(fixture, input)), { recursive: true });
        cpSync(join(root, input), join(fixture, input));
      }
      const run = (check = false) => spawnSync(process.execPath, [join(fixture, inputs[0]), ...(check ? ['--check'] : [])], { cwd: fixture, encoding: 'utf8' });
      const schemaPath = join(fixture, 'packages/mod-forge/schemas/config.schema.json');
      const originalSchema = readFileSync(schemaPath, 'utf8');
      const schema = JSON.parse(originalSchema);
      schema.properties.foreignSetting = { type: 'string', default: 'ignored' };
      schema.properties.goalReviewEngines = { type: 'array', items: { type: 'string' }, default: ['not-forge-owned'] };
      writeFileSync(schemaPath, JSON.stringify(schema));
      expect(run().status).toBe(0);
      expect(run(true).status).toBe(0);
      const implementationPath = join(fixture, 'packages/mod-think/src/implementation.ts');
      const implementation = readFileSync(implementationPath);
      const earlierOutput = join(fixture, 'packages/mod-ask/src/index.ts');
      const earlierBytes = readFileSync(earlierOutput);
      writeFileSync(earlierOutput, '// stale output must survive failed generation\n');
      const preservedPaths = [earlierOutput, join(fixture, 'packages/mod-think/src/index.ts'), join(fixture, 'package.json')];
      const preserved = preservedPaths.map(path => readFileSync(path));
      unlinkSync(implementationPath);
      try {
        for (const check of [false, true]) {
          const missing = run(check);
          expect(missing.status).toBe(1);
          expect(missing.stderr).toContain('missing physical implementation for @kernlang/agon-mod-think');
          preservedPaths.forEach((path, index) => expect(readFileSync(path)).toEqual(preserved[index]));
        }
      } finally {
        writeFileSync(implementationPath, implementation);
        writeFileSync(earlierOutput, earlierBytes);
      }
      for (const mod of ['plan', 'forge']) {
        const index = readFileSync(join(fixture, `packages/mod-${mod}/src/index.ts`), 'utf8');
        expect(reExports(index)).toEqual(authoredExports[mod]);
        expect(reExports(index + '\n// export { counterfeit } from "./fake.js";')).toEqual(authoredExports[mod]);
      }
      const planManifest = JSON.parse(readFileSync(join(fixture, 'packages/mod-plan/agon.mod.json'), 'utf8'));
      expect(planManifest.pack.include).toContain('dist/worktree-workflow.d.ts');
      const forgeManifest = JSON.parse(readFileSync(join(fixture, 'packages/mod-forge/agon.mod.json'), 'utf8'));
      expect(forgeManifest.permissions).toContainEqual({ capability: 'engine.dispatch', resources: [], required: true });
      for (const name of ['competition', 'corpus', 'errors', 'fitness', 'gauntlet', 'host', 'manifest', 'prompts', 'quality', 'scoring', 'stage-context', 'stages', 'synth-plan', 'synthesis', 'types', 'workflow']) {
        expect(forgeManifest.pack.include).toContain(`dist/${name}.d.ts`);
      }
      const generatorPath = join(fixture, inputs[0]);
      const generator = readFileSync(generatorPath, 'utf8');
      for (const [before, after] of [
        ['listWorktreePlans, ', ''],
        ['export type { WorktreePlanHost, WorktreePlanEvent }', 'export { WorktreePlanHost, WorktreePlanEvent }'],
        ["from './worktree-workflow.js'", "from './incorrect.js'"],
      ]) {
        const mutant = generator.replace(before, after);
        expect(mutant).not.toBe(generator);
        try {
          writeFileSync(generatorPath, mutant);
          expect(run().status).toBe(0);
          expect(reExports(readFileSync(join(fixture, 'packages/mod-plan/src/index.ts'), 'utf8'))).not.toEqual(authoredExports.plan);
        } finally { writeFileSync(generatorPath, generator); }
      }
      expect(run().status).toBe(0);
      expect(run(true).status).toBe(0);
      for (const aliases of [[], ['forgeFitnessTimeout'], ['forgeFitnessTimeout', 'forgeFitnessTimeout'], ['foreignSetting']]) {
        writeFileSync(schemaPath, JSON.stringify({ ...schema, 'x-agon-config': { version: 1, legacyAliases: aliases } }));
        const invalid = run();
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain('legacy migration aliases differ');
      }
      writeFileSync(schemaPath, JSON.stringify(schema));
      const generatedPath = join(fixture, 'packages/core/src/models/first-party-settings.generated.ts');
      const generated = readFileSync(generatedPath, 'utf8');
      expect(generated).not.toMatch(/foreignSetting|not-forge-owned/);
      expect(generated).toContain('forgeFitnessTimeout?: number');
      expect(generated).toContain('autoReviewAfterForge?: boolean');
      schema.properties.forgeFitnessTimeout.default = 121;
      const changedSchema = JSON.stringify(schema);
      writeFileSync(schemaPath, changedSchema);
      expect(run(true).status).toBe(1);
      expect(run().status).toBe(0);
      expect(readFileSync(schemaPath, 'utf8')).toBe(changedSchema);
      expect(readFileSync(generatedPath, 'utf8')).toContain('"forgeFitnessTimeout": 121');
      expect(run(true).status).toBe(0);
      for (const invalid of [null, false, { type: 'number' }, { type: 'object', default: {} }, { type: 'number', default: 'wrong' }]) {
        schema.properties.forgeFitnessTimeout = invalid;
        writeFileSync(schemaPath, JSON.stringify(schema));
        expect(run().status).toBe(1);
      }
      writeFileSync(schemaPath, originalSchema);
      const ledgerPath = join(fixture, 'docs/specs/evidence/modular-agon-ownership.json');
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      ledger.assignments.push(ledger.assignments.find((item: { category: string; id: string }) => item.category === 'configKeys' && item.id === 'forgeFitnessTimeout'));
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      const duplicate = run();
      expect(duplicate.status).toBe(1);
      expect(duplicate.stderr).toContain('duplicate settings owner');
      ledger.assignments.pop();
      const assignment = ledger.assignments.find((item: { category: string; id: string }) => item.category === 'configKeys' && item.id === 'forgeFitnessTimeout');
      ledger.assignments.push({ ...assignment, package: '@kernlang/agon-mod-review' });
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      const reviewPath = join(fixture, 'packages/mod-review/schemas/config.schema.json');
      const reviewSchema = JSON.parse(readFileSync(reviewPath, 'utf8'));
      reviewSchema.properties = { ...reviewSchema.properties, forgeFitnessTimeout: { type: 'number', default: 120 } };
      writeFileSync(reviewPath, JSON.stringify(reviewSchema));
      const crossOwner = run();
      expect(crossOwner.status).toBe(1);
      expect(crossOwner.stderr).toContain('duplicate settings owner');
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
});
