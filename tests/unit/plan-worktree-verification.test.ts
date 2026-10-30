import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const effects = vi.hoisted(() => ({ cwd: '', execute: vi.fn(), save: vi.fn() }));
vi.mock('@kernlang/agon-core', async original => ({
  ...await original<Record<string, unknown>>(), resolveWorkingDir: () => effects.cwd,
  saveCesarPlan: effects.save,
}));
vi.mock('../../packages/cli/src/handlers/plan-mode.js', () => ({ buildStepExecutors: () => ({}) }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', async original => {
  const authority = await original<Record<string, unknown>>();
  const { createPlanRuntime, PlanCostEstimator } = await import('@kernlang/agon-mod-plan');
  const { estimateCost } = await import('@kernlang/agon-support-engine-catalog');
  const runtime = createPlanRuntime(new PlanCostEstimator(estimateCost));
  return { ...authority, processPlanRuntime: () => ({ ...runtime, executePlan: effects.execute }) };
});
import { executeApprovedPlan } from '../../packages/cli/src/signals/dispatch/plan-execution.js';

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
  vi.stubEnv('GIT_CEILING_DIRECTORIES', [tmpdir(), realpathSync(tmpdir())].join(':'));
  effects.cwd = mkdtempSync(join(tmpdir(), 'plan-git-verification-'));
  effects.execute.mockImplementation(async value => ({ ...value, state: 'done',
    steps: value.steps.map((step: object) => ({ ...step, state: 'done', result: {
      status: 'success', output: 'done', actualTokens: 1, actualCostUsd: 1, durationMs: 1 } })) }));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(effects.cwd, { recursive: true, force: true }); });

it.each(['clean', 'untracked', 'staged', 'not a repository'])('verifies a real working tree: %s', async state => {
  if (state !== 'not a repository') execFileSync('git', ['init', '--quiet'], { cwd: effects.cwd });
  if (state === 'untracked' || state === 'staged') {
    writeFileSync(join(effects.cwd, 'new-file.txt'), 'new workspace work\n');
    if (state === 'staged') execFileSync('git', ['add', 'new-file.txt'], { cwd: effects.cwd });
  }
  const dispatch = vi.fn();
  await executeApprovedPlan({ id: 'fixture', intent: 'verify workspace', state: 'running',
    steps: [{ id: 's1', type: 'self', description: 'work', state: 'pending', estimatedTokens: 1, estimatedCostUsd: 1 }],
    stepContext: {}, createdAt: '2026-01-01T00:00:00Z', totalEstimatedTokens: 1, totalEstimatedCostUsd: 1,
    totalActualTokens: 0, totalActualCostUsd: 0 }, { dispatch, setActivePlan: vi.fn(),
    ctx: { config: {}, setActiveAbort: vi.fn() } } as any);
  if (state === 'not a repository') {
    expect(effects.save.mock.calls.at(-1)![0].state).toBe('paused');
    expect(effects.save.mock.calls.some(([snapshot]) => snapshot.state === 'done')).toBe(false);
    expect(dispatch.mock.calls.some(([event]) => event.type === 'success')).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('Cannot check working tree') }));
  } else {
    expect(effects.execute).toHaveBeenCalledTimes(state === 'clean' ? 1 : 2);
    expect(effects.save.mock.calls.at(-1)![0].state).toBe('done');
  }
});
