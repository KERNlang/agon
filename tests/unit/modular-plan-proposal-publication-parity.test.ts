import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { handleProposePlan as legacy } from '../fixtures/modular-plan-proposal-publication-legacy.js';
import { handleProposePlan as physical } from '../../packages/cli/src/handlers/plan-mode.js';
import * as planHandlers from '../../packages/cli/src/handlers/plan-mode.js';
import { createPlanExecutionSession } from '../../packages/cli/src/blocks/plan-execution-effects.js';
import { deriveRoutingHints } from '../../packages/cli/src/cesar/routing.js';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import { approveCesarPlan, createCesarPlan } from '@kernlang/agon-mod-plan';
import { planCostEstimator } from '@kernlang/agon-core';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
import { initializeProcessSurfaceAuthority, disposeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';

const roots: string[] = [];
const hostRoots: string[] = [];
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks(); planCostEstimator.reset();
  await disposeProcessSurfaceAuthority();
  for (const root of roots.splice(0)) cleanupTestAgonHome(root);
  for (const root of hostRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function files(root: string, prefix = ''): Record<string, string> {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? Object.entries(files(root, path)) : [[path, readFileSync(join(root, path), 'utf8')]];
  }));
}

it('shares CLI execution history with proposal and routing estimates, not Core history', async () => {
  const root = setupTestAgonHome('plan-history-consumers'); roots.push(root);
  const hostRoot = mkdtempSync(join(tmpdir(), 'plan-history-host-')); hostRoots.push(hostRoot);
  await initializeProcessSurfaceAuthority(hostRoot);
  planCostEstimator.recordStepCompletion('agent', 999, 99);
  planCostEstimator.recordStepCompletion('agent', 999, 99);
  const execute = vi.fn(async (step: { id: string }) => ({ result: {
    status: 'success' as const, actualTokens: step.id === 'a' ? 10 : 30,
    actualCostUsd: 0.2, durationMs: 1, output: 'fixture-completed',
  } }));
  vi.spyOn(planHandlers, 'buildStepExecutors').mockReturnValue({ agent: { execute } });
  const ctx = { config: {}, cesar: {}, activeEngines: () => ['fixture'], setActiveAbort: vi.fn() } as unknown as HandlerContext;
  const setActivePlan = vi.fn();
  const dispatch = vi.fn();
  const session = createPlanExecutionSession({ ctx, setActivePlan, dispatch } as unknown as DispatchCallbacks);
  const plan = { ...approveCesarPlan(createCesarPlan('learn through CLI', ['a', 'b'].map(id => ({
    id, type: 'agent', description: id, estimatedTokens: 50, estimatedCostUsd: 1,
  })))), selfReview: false };
  await session.execute(plan);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(setActivePlan).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'done' }));
  const proposed = await physical({ intent: 'next', steps: [{ id: 'next', type: 'agent', description: 'next' }] }, dispatch, ctx);
  expect(proposed.steps[0]).toMatchObject({ estimatedTokens: 20, estimatedCostUsd: 0.2 });
  expect(deriveRoutingHints('hello', ctx, root).estimatedStepCost).toEqual({ tokens: 20, costUsd: 0.2 });
  expect(planCostEstimator.estimate('agent', [])).toEqual({ tokens: 999, costUsd: 99 });
});

it.each([
  { label: 'normal', args: { intent: 'new', steps: [{ id: 'a', type: 'self', description: 'read' }] }, auto: false },
  { label: 'agentic', args: { intent: 'new', steps: [{ id: 'a', type: 'self', description: 'read' }] }, auto: true },
  { label: 'malformed', args: { intent: 3, steps: [null, { type: 'invalid' }, { id: '../escape', type: 'review' }] }, auto: false },
  { label: 'flags', args: { intent: 'new', steps: [], autoApprove: true, selfReview: false, planningCost: { tokens: 99, costUsd: -1 } }, auto: false },
  { label: 'nonarray', args: { intent: 'new', steps: { bogus: true } }, auto: false },
  { label: 'notification changes auto mode', args: { intent: 'new', steps: [null] }, auto: false, flipAuto: true },
])('preserves raw events, state, Markdown, and JSON for $label', async fixture => {
  const { args, auto } = fixture;
  const hostRoot = mkdtempSync(join(tmpdir(), 'plan-publication-host-'));
  hostRoots.push(hostRoot);
  await initializeProcessSurfaceAuthority(hostRoot);
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const outcomes = [];
  let firstRoot: string | undefined;
  for (const run of [legacy, physical]) {
    const root = setupTestAgonHome('proposal-parity'); roots.push(root);
    if (firstRoot === undefined) firstRoot = root;
    else expect(root).toBe(firstRoot);
    const prior = { ...createCesarPlan('old', []), id: 'prior', state: 'awaiting_approval' as const };
    const active = { ...prior, id: 'active' };
    const ctx = { cesar: { proposedPlan: prior }, activePlan: active, autoModeQueued: auto, config: {} } as unknown as HandlerContext;
    const events: unknown[] = [];
    const result = await run(args, event => {
      events.push(event);
      if ('flipAuto' in fixture && fixture.flipAuto && event.type === 'info') ctx.autoModeQueued = true;
    }, ctx);
    outcomes.push(JSON.stringify({ result, events, proposed: ctx.cesar?.proposedPlan, active: ctx.activePlan, files: files(root) }));
    cleanupTestAgonHome(root); roots.pop();
  }
  expect(outcomes[1]).toBe(outcomes[0]);
});
