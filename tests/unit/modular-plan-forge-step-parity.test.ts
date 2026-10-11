import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tracker } from '@kernlang/agon-core';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import type { CesarPlanStep } from '../../packages/mod-plan/src/execution-model.js';

const effects = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), apply: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({ ...await original<Record<string, unknown>>(),
  resolveWorkingDir: () => '/fixture', readPatchFromPath: effects.read, applyPatchToTree: effects.apply,
}));
vi.mock('@kernlang/agon-support-worktree', async original => ({ ...await original<Record<string, unknown>>(),
  readPatchContent: (path: string) => {
    const patch = effects.read(path);
    if (!patch) throw new Error('unreadable fixture');
    return patch.content;
  }, applyPatchToTree: effects.apply,
}));
vi.mock('@kernlang/agon-forge', async original => ({ ...await original<Record<string, unknown>>(), runForge: effects.run }));
import { buildLegacyBuildStepExecutors } from '../fixtures/modular-plan-build-steps-legacy.js';
import { buildStepExecutors } from '../../packages/cli/src/handlers/plan-mode.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-forge-parity-')); vi.stubEnv('AGON_HOME', home); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });
const scenarios = ['success', 'missing-path', 'missing-file', 'empty-patch', 'apply-fails', 'error', 'string-error',
  'no-winner', 'preflight-error', 'declared-noop', 'inferred-noop', 'dispatch-crash', 'pre-abort', 'no-engines'];
const cases = (['forge', 'teamforge'] as const).flatMap(kind => [false, true].flatMap(ui => scenarios.map(scenario => ({ kind, ui, scenario }))));

it('keeps Forge step algorithms and progress policies in the physical owner', () => {
  const cli = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  expect(cli).toContain('const forgeExecutors = createForgeStepExecutors({');
  expect(cli).not.toMatch(/(?:forge|teamforge):\s*wrap\(/);
  expect(cli).not.toContain('const notePlanForgeEvent');
  const coreImport = cli.match(/import\s*\{[^}]*\}\s*from '@kernlang\/agon-core'/)?.[0];
  expect(coreImport).not.toMatch(/readPatchFromPath|applyPatchToTree/);
  expect(cli).toMatch(/import\s*\{[^}]*readPatchContent[^}]*applyPatchToTree[^}]*\}\s*from '@kernlang\/agon-support-worktree'/);
  expect(cli).not.toContain('const applyForgeWinnerToCwd');
});

it.each(['forge', 'teamforge'] as const)('does not apply %s patch after cancellation in the read boundary', async kind => {
  const results: unknown[] = [];
  for (const build of [buildLegacyBuildStepExecutors, buildStepExecutors]) {
    const controller = new AbortController();
    Object.values(effects).forEach(effect => effect.mockReset());
    effects.run.mockResolvedValue({ winner: 'one', patches: { one: '/patch' }, results: {} });
    effects.read.mockImplementation(() => { controller.abort(new Error('cancelled while reading')); return { content: 'patch' }; });
    effects.apply.mockReturnValue({ ok: true });
    const ctx = { registry: {}, adapter: {}, activeEngines: () => ['one'] } as unknown as HandlerContext;
    const output = await build(ctx)[kind].execute({ id: 'f', type: kind, description: 'task', estimatedTokens: 0, estimatedCostUsd: 0 }, {}, controller.signal);
    results.push({ output, applied: effects.apply.mock.calls.length });
    expect(vi.getTimerCount()).toBe(0);
  }
  expect(results[0]).toMatchObject({ output: { result: { status: 'success' } }, applied: 1 });
  expect(results[1]).toMatchObject({ output: { result: { status: 'failure', error: 'cancelled while reading' } }, applied: 0 });
  expect((results[1] as { output: unknown }).output).not.toHaveProperty('contextExport');
});

it.each(cases)('matches raw $kind/$scenario with UI=$ui', async ({ kind, ui, scenario }) => {
  const results = [];
  const signal = new AbortController(); if (scenario === 'pre-abort') signal.abort(new Error('cancelled'));
  const ctx = { registry: {}, adapter: {}, activeEngines: () => scenario === 'no-engines' ? [] : ['engine', 'other'] } as unknown as HandlerContext;
  for (const build of [buildLegacyBuildStepExecutors, buildStepExecutors]) {
    vi.setSystemTime(123456789);
    for (const effect of Object.values(effects)) effect.mockReset();
    vi.spyOn(tracker, 'getStats').mockReturnValueOnce({ totalTokens: 10, meteredCostUsd: 1, totalCostUsd: 90 } as ReturnType<typeof tracker.getStats>)
      .mockReturnValue({ totalTokens: 30, meteredCostUsd: 1.5, totalCostUsd: 150 } as ReturnType<typeof tracker.getStats>);
    const events: unknown[] = []; const calls: unknown[] = [];
    const boundaries: { registry: unknown; adapter: unknown }[] = [];
    effects.read.mockReturnValue(scenario === 'missing-file' ? null : { content: scenario === 'empty-patch' ? ' \n ' : 'patch' });
    effects.apply.mockReturnValue(scenario === 'apply-fails' ? { ok: false, error: 'conflict' } : { ok: true });
    effects.run.mockImplementation(async (options, registry, adapter, emit) => {
      boundaries.push({ registry, adapter });
      calls.push({ options, hasCallback: typeof emit === 'function' });
      for (const event of [
        { type: 'baseline:start' }, { type: 'baseline:done', data: { passes: true } },
        { type: 'stage1:dispatch', engineId: 'engine' },
        { type: 'engine:worktree', engineId: 'engine', data: { worktreePath: '/worktree' } },
        { type: 'engine:worktree', engineId: 'engine', data: { worktreePath: '/worktree' } },
        { type: 'stage1:accepted', engineId: 'engine', data: { pass: false, score: 0 } },
        { type: 'engine:failed', data: { engineId: 'other', error: 'failure' } },
        { type: 'stage2:dispatch', engineId: 'engine' },
        { type: 'stage2:score', engineId: 'engine', data: { pass: true, score: 9 } },
        { type: 'winner:determined', data: { winner: 'engine', bestScore: 9 } },
        { type: 'synthesis:start' },
      ]) emit?.(event);
      await vi.advanceTimersByTimeAsync(1001);
      if (scenario === 'error' || scenario === 'string-error') throw scenario === 'error' ? new Error('backend failed') : 'backend failed';
      const noWinner = ['no-winner', 'preflight-error', 'declared-noop', 'inferred-noop', 'dispatch-crash'].includes(scenario);
      return { winner: noWinner ? null : 'engine', patches: scenario === 'missing-path' ? {} : { engine: '/patch' },
        alreadySatisfied: scenario === 'declared-noop', baselinePasses: scenario === 'inferred-noop' || scenario === 'dispatch-crash',
        ...(scenario === 'preflight-error' ? { error: 'No available engines' } : {}),
        results: { engine: { pass: false, score: 0, diffLines: 0, filesChanged: 0, fitnessLogPath: '/fitness', dispatchStdout: scenario === 'dispatch-crash' ? 'ERROR: crashed' : 'done' } } };
    });
    const step: CesarPlanStep = { id: 's', type: kind, description: 'task', imports: ['facts'], estimatedTokens: 0, estimatedCostUsd: 0 };
    let output: unknown;
    try { output = await build(ctx, ui ? event => { events.push(event); } : undefined)[kind].execute(step, { facts: 'context' }, signal.signal); }
    catch (error) { output = { thrown: error instanceof Error ? error.message : String(error) }; }
    for (const boundary of boundaries) { expect(boundary.registry).toBe(ctx.registry); expect(boundary.adapter).toBe(ctx.adapter); }
    if (scenario === 'pre-abort') expect(output).toEqual({ thrown: 'cancelled' });
    else expect((output as { result: { status: string } }).result.status).toBe(['success', 'empty-patch', 'declared-noop', 'inferred-noop', 'no-engines'].includes(scenario) ? 'success' : 'failure');
    results.push({ output, events, calls, read: effects.read.mock.calls.slice(), apply: effects.apply.mock.calls.slice() });
    expect(vi.getTimerCount()).toBe(0);
  }
  const previous = results[0];
  if (['success', 'empty-patch', 'declared-noop', 'inferred-noop', 'no-engines'].includes(scenario)) {
    // Keep every legacy field and effect exact. Only the new receipt is additive.
    const artifact = ['declared-noop', 'inferred-noop'].includes(scenario)
      ? { status: 'not-needed', cwd: '/fixture', reason: 'already-satisfied' }
      : scenario === 'empty-patch' ? { status: 'not-needed', cwd: '/fixture', reason: 'empty-patch' }
      : { status: 'applied', cwd: '/fixture', patchPath: '/patch',
        patchHash: 'sha256:a4895eb44afc336fecbba6e520cd67e178dace0276655d102fceffa8e5f70570' };
    const output = previous.output as { result: Record<string, unknown> };
    expect(results[1]).toEqual({ ...previous, output: { ...output, result: { ...output.result, artifact } } });
  } else expect(results[1]).toEqual(previous);
});
