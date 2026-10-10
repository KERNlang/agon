import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { assertProcessPlanStepAvailable, disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority, processSurfaceCatalog } from '../../packages/cli/src/surface-authority-runtime.js';
import { SurfaceGeneration } from '@kernlang/agon-kernel';
import type { CesarPlanStep } from '@kernlang/agon-mod-plan';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

const effects = vi.hoisted(() => ({ brainstorm: vi.fn(), delegate: vi.fn(), other: vi.fn() }));
vi.mock('@kernlang/agon-forge', async original => ({
  ...await original<Record<string, unknown>>(), runBrainstorm: effects.brainstorm,
  runDelegate: effects.delegate, runForge: effects.other, runTribunal: effects.other, runCampfire: effects.other,
}));
vi.mock('../../packages/cli/src/handlers/agent.js', async original => ({
  ...await original<Record<string, unknown>>(), runAgentMode: effects.other, runAgentTeam: effects.other,
}));
vi.mock('../../packages/cli/src/handlers/review.js', async original => ({
  ...await original<Record<string, unknown>>(), runReviewCore: effects.other,
}));
import { buildStepExecutors } from '../../packages/cli/src/handlers/plan-mode.js';

const NOW = '2026-10-10T00:00:00.000Z';
let root: string;
let host: DurableModHost;
beforeEach(async () => {
  vi.clearAllMocks();
  effects.brainstorm.mockResolvedValue({ winner: 'fixture', response: 'answer' });
  effects.delegate.mockResolvedValue({ response: 'answer' });
  effects.other.mockResolvedValue({ winner: 'fixture', summary: 'review' });
  root = await mkdtemp(join(tmpdir(), 'agon-step-admission-'));
  vi.stubEnv('AGON_HOME', join(root, 'execution-home'));
  host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 'step-admission-test' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await disposeProcessSurfaceAuthority();
  vi.unstubAllEnvs();
  const generations = await readdir(join(root, 'generations')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const generation of generations) await chmod(join(root, 'generations', generation), 0o755);
  await rm(root, { recursive: true, force: true });
});
async function install(disabled?: string) {
  const catalog = createFirstPartyModCatalog();
  const full = createFullCompatDesiredState(catalog, NOW);
  const desired = disabled ? planDesiredStateChange(catalog, full, { kind: 'disable', id: disabled }, NOW).nextState : full;
  await host.commitGeneration({ operation: disabled ? 'disable' : 'install', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });
}
function context(): HandlerContext { return { config: {} } as HandlerContext; }
function step(type: string): CesarPlanStep {
  return { id: 'step', type, description: 'fixture', state: 'pending', estimatedTokens: 0, estimatedCostUsd: 0 };
}

it('refuses disabled Plan before creating output storage', async () => {
  await install('agon.plan');
  await initializeProcessSurfaceAuthority(root);
  expect(() => buildStepExecutors(context())).toThrow('unavailable');
  expect(existsSync(join(root, 'execution-home', 'runs'))).toBe(false);
});

it.each(['generation', 'enabled-generation', 'host', 'disposal'] as const)('refuses a cached executor after its %s changes', async transition => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const executors = buildStepExecutors(context());
  if (transition === 'generation') await install('agon.plan');
  else if (transition === 'enabled-generation') await install('agon.review');
  else if (transition === 'disposal') await disposeProcessSurfaceAuthority();
  else { await disposeProcessSurfaceAuthority(); await initializeProcessSurfaceAuthority(root); }
  await expect(executors.brainstorm.execute(step('brainstorm'), {})).rejects.toThrow(/restart|disposed|replaced/);
  expect(effects.brainstorm).not.toHaveBeenCalled();
});

it.each([
  ['forge', 'agon.forge'], ['teamforge', 'agon.team-forge'], ['brainstorm', 'agon.brainstorm'],
  ['tribunal', 'agon.tribunal'], ['campfire', 'agon.campfire'], ['delegate', 'agon.agent'],
  ['pipeline', 'agon.pipeline-delivery'], ['review', 'agon.review'],
  ['agent', 'agon.agent'], ['team-agent', 'agon.agent'],
])('refuses disabled %s using its executor owner, not the supplied type', async (type, owner) => {
  await install(owner);
  await initializeProcessSurfaceAuthority(root);
  const executors = buildStepExecutors(context());
  await expect(executors[type].execute(step('self'), {})).rejects.toThrow('unavailable');
  expect(effects.brainstorm).not.toHaveBeenCalled();
  expect(effects.delegate).not.toHaveBeenCalled();
  expect(effects.other).not.toHaveBeenCalled();
});

it('does not delegate a self step through a disabled Agent owner', async () => {
  await install('agon.agent');
  await initializeProcessSurfaceAuthority(root);
  const result = await buildStepExecutors(context()).self.execute(step('self'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('unavailable') });
  expect(effects.delegate).not.toHaveBeenCalled();
});

it('preserves enabled brainstorming and self delegation', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const executors = buildStepExecutors(context());
  expect((await executors.brainstorm.execute(step('unknown-caller-type'), {})).result.status).toBe('success');
  expect((await executors.self.execute(step('self'), {})).result.status).toBe('success');
  expect(effects.brainstorm).toHaveBeenCalledOnce();
  expect(effects.delegate).toHaveBeenCalledOnce();
});

it('accepts all enabled step keys and rejects an unknown key', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  for (const key of Object.keys(buildStepExecutors(context()))) {
    expect(() => assertProcessPlanStepAvailable(key), key).not.toThrow();
  }
  expect(() => assertProcessPlanStepAvailable('unknown-step')).toThrow('unavailable');
});

it('rejects a catalog collision across owners', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const entry = processSurfaceCatalog('cesar').find(value => value.kind === 'plan-step' && value.publicId === 'self')!;
  expect(entry).toBeDefined();
  vi.spyOn(SurfaceGeneration.prototype, 'catalog').mockReturnValue([
    entry, { ...entry, owner: { ...entry.owner, id: 'different.owner' } },
  ]);
  expect(() => assertProcessPlanStepAvailable('self')).toThrow('ambiguous owners');
});

it('accepts same-owner duplicate declarations and alias-only lookup', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const entry = processSurfaceCatalog('cesar').find(value => value.kind === 'plan-step' && value.publicId === 'self')!;
  expect(entry).toBeDefined();
  const aliasEntry = { ...entry, publicId: 'renamed-self', aliases: ['self'] };
  vi.spyOn(SurfaceGeneration.prototype, 'catalog').mockReturnValue([aliasEntry, aliasEntry]);
  expect(() => assertProcessPlanStepAvailable('self')).not.toThrow();
});

it('rejects an alias collision across owners', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const entry = processSurfaceCatalog('cesar').find(value => value.kind === 'plan-step' && value.publicId === 'self')!;
  expect(entry).toBeDefined();
  vi.spyOn(SurfaceGeneration.prototype, 'catalog').mockReturnValue([
    entry, { ...entry, publicId: 'other-step', aliases: ['self'], owner: { ...entry.owner, id: 'different.owner' } },
  ]);
  expect(() => assertProcessPlanStepAvailable('self')).toThrow('ambiguous owners');
});

it.each(['brainstorm', 'forge', 'tribunal'])('refuses a disabled nested %s phase', async phase => {
  await install('agon.' + phase);
  await initializeProcessSurfaceAuthority(root);
  const result = await buildStepExecutors(context()).pipeline.execute(step('pipeline'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('unavailable') });
  if (phase === 'brainstorm') expect(effects.brainstorm).not.toHaveBeenCalled();
  else expect(effects.brainstorm).toHaveBeenCalledOnce();
  expect(effects.other).toHaveBeenCalledTimes(phase === 'tribunal' ? 1 : 0);
});

it.each(['brainstorm', 'forge', 'tribunal'])('refuses continuation after authority changes during %s', async phase => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const revoke = async () => {
    await install('agon.plan');
    return { winner: 'fixture', summary: 'review', response: 'answer' };
  };
  if (phase === 'brainstorm') effects.brainstorm.mockImplementationOnce(revoke);
  else if (phase === 'forge') effects.other.mockImplementationOnce(revoke);
  else effects.other.mockResolvedValueOnce({ winner: 'fixture' }).mockImplementationOnce(revoke);
  const dispatch = vi.fn();
  const result = await buildStepExecutors(context(), dispatch).pipeline.execute(step('pipeline'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('restart') });
  expect(effects.other).toHaveBeenCalledTimes(phase === 'brainstorm' ? 0 : phase === 'forge' ? 1 : 2);
  expect(result.contextExport).toBeUndefined();
  const events = dispatch.mock.calls.map(([event]) => event);
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-completed', phaseId: phase }));
  const terminal = events.filter(event => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({ status: 'failed' });
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-run-conformance-failed' }));
  const next = phase === 'brainstorm' ? 'forge' : phase === 'forge' ? 'tribunal' : null;
  if (next) expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-started', phaseId: next }));
});

it('preserves the enabled three-phase workflow', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const result = await buildStepExecutors(context()).pipeline.execute(step('pipeline'), {});
  expect(result.result.status).toBe('success');
  expect(result.contextExport).toContain('Tribunal: review');
  expect(effects.brainstorm).toHaveBeenCalledOnce();
  expect(effects.other).toHaveBeenCalledTimes(2);
});

it('does not start a cancelled step', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const controller = new AbortController();
  controller.abort(new Error('cancel fixture'));
  await expect(buildStepExecutors(context()).brainstorm.execute(step('brainstorm'), {}, controller.signal)).rejects.toThrow('cancel fixture');
  expect(effects.brainstorm).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'])('stops after cancellation during %s', async phase => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const controller = new AbortController();
  const cancel = async () => {
    controller.abort(new Error('cancel fixture'));
    return { winner: 'fixture', summary: 'review', response: 'answer' };
  };
  if (phase === 'brainstorm') effects.brainstorm.mockImplementationOnce(cancel);
  else if (phase === 'forge') effects.other.mockImplementationOnce(cancel);
  else effects.other.mockResolvedValueOnce({ winner: 'fixture' }).mockImplementationOnce(cancel);
  const dispatch = vi.fn();
  const result = await buildStepExecutors(context(), dispatch).pipeline.execute(step('pipeline'), {}, controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: 'cancel fixture' });
  expect(effects.other).toHaveBeenCalledTimes(phase === 'brainstorm' ? 0 : phase === 'forge' ? 1 : 2);
  expect(result.contextExport).toBeUndefined();
  const events = dispatch.mock.calls.map(([event]) => event);
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-completed', phaseId: phase }));
  const terminal = events.filter(event => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({ status: 'cancelled' });
  expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-run-conformance-failed' }));
  const next = phase === 'brainstorm' ? 'forge' : phase === 'forge' ? 'tribunal' : null;
  if (next) expect(events).not.toContainEqual(expect.objectContaining({ type: 'workflow-phase-started', phaseId: next }));
});

it('refuses a nested continuation after host replacement', async () => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  effects.brainstorm.mockImplementationOnce(async () => {
    await disposeProcessSurfaceAuthority();
    await initializeProcessSurfaceAuthority(root);
    return { winner: 'fixture', response: 'stale answer' };
  });
  const result = await buildStepExecutors(context()).pipeline.execute(step('pipeline'), {});
  expect(result.result).toMatchObject({ status: 'failure', error: expect.stringContaining('disposed or replaced') });
  expect(effects.other).not.toHaveBeenCalled();
});

it.each(['brainstorm', 'forge', 'tribunal'])('honors cancellation from the %s start event', async phase => {
  await install();
  await initializeProcessSurfaceAuthority(root);
  const controller = new AbortController();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  const dispatch = vi.fn(event => {
    if (event.type === 'workflow-phase-started' && event.phaseId === phase) controller.abort(new Error('event cancellation'));
  });
  const ctx = context();
  ctx.activeEngines = () => ['fixture'];
  const result = await buildStepExecutors(ctx, dispatch).pipeline.execute(step('pipeline'), {}, controller.signal);
  expect(result.result).toMatchObject({ status: 'failure', error: 'event cancellation' });
  expect(effects.brainstorm).toHaveBeenCalledTimes(phase === 'brainstorm' ? 0 : 1);
  expect(effects.other).toHaveBeenCalledTimes(phase === 'tribunal' ? 1 : 0);
  for (const interval of intervals.mock.results) expect(clear).toHaveBeenCalledWith(interval.value);
  const terminal = dispatch.mock.calls.map(([event]) => event).filter(event => event.type === 'workflow-run-completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({ status: 'cancelled' });
});
