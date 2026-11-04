import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tracker } from '@kernlang/agon-core';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

const backends = vi.hoisted(() => ({ brainstorm: vi.fn(), forge: vi.fn(), tribunal: vi.fn() }));
const patches = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn() }));
vi.mock('@kernlang/agon-support-worktree', async original => ({ ...await original<Record<string, unknown>>(),
  readPatchContent: (path: string) => patches.read(path).content, applyPatchToTree: patches.apply,
}));
const validation = vi.hoisted(() => ({ fault: '' }));
vi.mock('@kernlang/agon-core', async original => {
  const actual = await original<typeof import('@kernlang/agon-core')>();
  return { ...actual, resolveWorkingDir: () => '/fixture', verifyWorkflowRunFlow: (...args: Parameters<typeof actual.verifyWorkflowRunFlow>) => {
    if (validation.fault === 'issues') return [{ code: 'invalid-phase', message: 'missing evidence' }];
    if (validation.fault) throw Object.assign(new Error('validator unavailable'), { issues: validation.fault === 'empty-exception' ? [] : [{ code: 'invalid-phase', message: 'missing evidence' }] });
    return actual.verifyWorkflowRunFlow(...args);
  } };
});
vi.mock('@kernlang/agon-forge', async original => ({ ...await original<Record<string, unknown>>(),
  runBrainstorm: backends.brainstorm, runForge: backends.forge, runTribunal: backends.tribunal,
}));
import { buildLegacyBuildStepExecutors } from '../fixtures/modular-plan-build-steps-legacy.js';
vi.mock('@kernlang/agon-mod-tribunal', async original => ({
  ...await original<object>(),
  createTribunalRuntime: (effects: Record<string, unknown>) => (options: Record<string, unknown>) => {
    const { cwd, mode, ...policy } = options;
    expect(cwd).toBe('/fixture');
    // Pipeline uses the default mode, as does the frozen legacy call.
    expect(mode).toBeUndefined();
    expect(effects.assertCurrent).toEqual(expect.any(Function));
    expect(effects.loadConfig).toEqual(expect.any(Function));
    expect(effects.judgeForRating).toEqual(expect.any(Function));
    return backends.tribunal(policy);
  },
}));
vi.mock('@kernlang/agon-mod-brainstorm', async original => {
  const actual = await original<typeof import('@kernlang/agon-mod-brainstorm')>();
  return { ...actual, createBrainstormRuntime: (...args: Parameters<typeof actual.createBrainstormRuntime>) => ({
    ...actual.createBrainstormRuntime(...args), runBrainstorm: backends.brainstorm,
  }) };
});
import { buildStepExecutors } from '../../packages/cli/src/handlers/plan-mode.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agon-pipeline-parity-')); vi.stubEnv('AGON_HOME', home); vi.useFakeTimers();
  patches.read.mockReset().mockReturnValue({ content: 'patch' });
  patches.apply.mockReset().mockReturnValue({ ok: true });
});
afterEach(() => { validation.fault = ''; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
const scenarios = ['success', 'brainstorm-fails', 'forge-fails', 'tribunal-fails', 'no-winner', 'abort-brainstorm', 'abort-forge', 'pre-abort', 'no-engines', 'explicit-engines'];
const cases = ['none', 'live', 'plan', 'last'].flatMap(ui => scenarios.map(scenario => ({ ui, scenario })));

it('keeps the pipeline step algorithm out of the CLI', () => {
  const source = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  expect(source).toContain('createPlanStepExecutors({');
  expect(source).not.toContain('createPipelineStepExecutor(');
  expect(source).not.toContain('const wrap =');
  expect(source).not.toContain('const emitPipelinePhase');
});

it.each(['issues', 'exception', 'empty-exception'])('refuses invalid final verification: %s, unlike the frozen legacy owner', async fault => {
  validation.fault = fault;
  const results: { output: unknown; events: Record<string, unknown>[] }[] = [];
  for (const build of [buildLegacyBuildStepExecutors, buildStepExecutors]) {
    backends.brainstorm.mockResolvedValue({ winner: 'one', response: 'approach' });
    backends.forge.mockResolvedValue({ winner: 'one', patches: { one: '/patch' }, results: {} });
    backends.tribunal.mockResolvedValue({ summary: 'review' });
    const events: Record<string, unknown>[] = [];
    const ctx = { registry: {}, adapter: {}, activeEngines: () => ['one'] } as unknown as HandlerContext;
    let output: unknown;
    try {
      output = await build(ctx, event => { events.push(event); }).pipeline.execute({ id: 'p', type: 'pipeline', description: 'task', estimatedTokens: 0, estimatedCostUsd: 0 }, {});
    } catch (error) { output = { thrown: error instanceof Error ? error.message : String(error) }; }
    results.push({ output, events });
    expect(vi.getTimerCount()).toBe(0);
  }
  if (fault === 'issues') expect(results[0].output).toMatchObject({ result: { status: 'success' } });
  else expect(results[0].output).toEqual({ thrown: 'validator unavailable' });
  expect(results[1].output).toMatchObject({ result: { status: 'failure', error: 'workflow-conformance-failed' } });
  expect(results[1].output).not.toHaveProperty('contextExport');
  const terminal = results[1].events.filter(event => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({ status: 'failed', reason: 'workflow-conformance-failed', workflowStatus: 'failed' });
  const diagnostics = results[1].events.filter(event => event.type === 'workflow-run-conformance-failed');
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].issues).toEqual([expect.objectContaining({ code: 'invalid-phase' })]);
});

it.each(['info', 'progress-update'])('matches legacy refusal when initial Forge %s cancels execution', async type => {
  const results: unknown[] = [];
  for (const build of [buildLegacyBuildStepExecutors, buildStepExecutors]) {
    vi.setSystemTime(123456789);
    Object.values(backends).forEach(backend => backend.mockReset());
    backends.brainstorm.mockResolvedValue({ winner: 'one', response: 'approach' });
    backends.forge.mockResolvedValue({ winner: 'one', results: {} });
    backends.tribunal.mockResolvedValue({ summary: 'review' });
    const controller = new AbortController();
    const ctx = { registry: {}, adapter: {}, activeEngines: () => ['one'] } as unknown as HandlerContext;
    const events: unknown[] = [];
    const output = await build(ctx, event => {
      events.push(event);
      if (event.type === type) controller.abort(new Error('cancelled by progress'));
    }).pipeline.execute({ id: 'p', type: 'pipeline', description: 'task', estimatedTokens: 0, estimatedCostUsd: 0 }, {}, controller.signal);
    expect(output.result).toMatchObject({ status: 'failure', error: 'cancelled by progress' });
    expect(backends.forge).not.toHaveBeenCalled();
    expect(backends.tribunal).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    results.push({ output, events });
  }
  expect(results[1]).toEqual(results[0]);
});

it.each(cases)('compares raw pipeline $scenario with dispatch=$ui', async ({ ui, scenario }) => {
  const results = [];
  const registry = {}; const adapter = {};
  for (const build of [buildLegacyBuildStepExecutors, buildStepExecutors]) {
    vi.setSystemTime(123456789);
    Object.values(backends).forEach(fn => fn.mockReset());
    vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ totalTokens: 10, meteredCostUsd: 1 } as ReturnType<typeof tracker.getStats>)
      .mockReturnValue({ totalTokens: 30, meteredCostUsd: 1.5 } as ReturnType<typeof tracker.getStats>);
    const controller = new AbortController();
    if (scenario === 'pre-abort') controller.abort(new Error('cancelled'));
    const events: unknown[] = []; const calls: unknown[] = [];
    const boundaries: { registry: unknown; adapter: unknown; signal: unknown }[] = [];
    const dispatch = (event: unknown) => { events.push(event); };
    const ctx = { registry, adapter, activeEngines: () => scenario === 'no-engines' ? [] : ['one', 'two', 'three', 'four'],
      cesar: { ...(ui === 'plan' ? { planDispatch: dispatch } : {}), ...(ui === 'last' ? { lastDispatch: dispatch } : {}) },
    } as unknown as HandlerContext;
    for (const phase of ['brainstorm', 'forge', 'tribunal'] as const) {
      backends[phase].mockImplementation(async (input, forgeRegistry, forgeAdapter, emit) => {
        const { registry: inputRegistry, adapter: inputAdapter, signal, ...options } = input;
        boundaries.push({ registry: phase === 'forge' ? forgeRegistry : inputRegistry,
          adapter: phase === 'forge' ? forgeAdapter : inputAdapter, signal });
        calls.push({ phase, options, callback: typeof emit === 'function' });
        emit?.({ type: 'stage1:dispatch', engineId: 'one' });
        await vi.advanceTimersByTimeAsync(501);
        if (scenario === `${phase}-fails`) throw new Error(`${phase} failed`);
        if (scenario === `abort-${phase}`) controller.abort(new Error('cancelled'));
        if (phase === 'brainstorm') return { winner: 'one', response: 'approach' };
        if (phase === 'forge') return { winner: scenario === 'no-winner' ? null : 'one', patches: { one: '/patch' }, results: {} };
        return { summary: 'review result' };
      });
    }
    let output: unknown;
    try {
      output = await build(ctx, ui === 'live' ? dispatch : undefined).pipeline.execute({ id: 'p', type: 'pipeline',
        description: 'task', imports: ['facts'], estimatedTokens: 0, estimatedCostUsd: 0,
        ...(scenario === 'explicit-engines' ? { engines: ['explicit'], fitnessCmd: 'npm test' } : {}),
      }, { facts: 'context' }, controller.signal);
    } catch (error) { output = { thrown: error instanceof Error ? error.message : String(error) }; }
    for (const boundary of boundaries) { expect(boundary.registry).toBe(registry); expect(boundary.adapter).toBe(adapter); expect(boundary.signal).toBe(controller.signal); }
    if (scenario === 'pre-abort') expect(output).toEqual({ thrown: 'cancelled' });
    else expect((output as { result: { status: string } }).result.status).toBe(['success', 'no-engines', 'explicit-engines'].includes(scenario) ? 'success' : 'failure');
    results.push({ output, events, calls });
    expect(vi.getTimerCount()).toBe(0);
  }
  const artifact = { status: 'applied', cwd: '/fixture', patchPath: '/patch',
    patchHash: 'sha256:a4895eb44afc336fecbba6e520cd67e178dace0276655d102fceffa8e5f70570' };
  if (['success', 'no-engines', 'explicit-engines', 'tribunal-fails'].includes(scenario)) {
    expect(patches.read).toHaveBeenCalledExactlyOnceWith('/patch');
    expect(patches.apply).toHaveBeenCalledExactlyOnceWith('/fixture', 'patch');
  } else {
    expect(patches.read).not.toHaveBeenCalled();
    expect(patches.apply).not.toHaveBeenCalled();
  }
  if (scenario === 'tribunal-fails') {
    const previous = results[0];
    const result = (previous.output as { result: Record<string, unknown> }).result;
    expect(result.output).toBe('Partial pipeline (brainstorm done): approach');
    expect(results[1]).toEqual({ ...previous, output: { result: { ...result, output: 'Partial pipeline (brainstorm → forge done): approach', artifact } } });
  } else if (['success', 'no-engines', 'explicit-engines'].includes(scenario)) {
    const previous = results[0];
    const output = previous.output as { result: Record<string, unknown> };
    expect(results[1]).toEqual({ ...previous, output: { ...output, result: { ...output.result, artifact } } });
  } else {
    expect(results[1]).toEqual(results[0]);
  }
});
