import { beforeEach, expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import type { DispatchCallbacks, DispatchResult } from '../../packages/cli/src/signals/dispatch.js';
import { createPlan } from '@kernlang/agon-support-worktree';
import type { Plan } from '@kernlang/agon-support-worktree';

const router = vi.hoisted(() => ({ run: vi.fn(async () => false), post: vi.fn() }));
const actions = vi.hoisted(() => ({
  approvePending: vi.fn(async () => false), cancelPending: vi.fn(() => false),
  readWorktree: vi.fn<() => Plan | null>(() => null), saveWorktree: vi.fn(),
  auto: vi.fn<(request: unknown, input: string, cb: DispatchCallbacks) => Promise<DispatchResult | null>>(),
}));
vi.mock('../../packages/cli/src/signals/dispatch/plan-execution.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../packages/cli/src/signals/dispatch/plan-execution.js')>(),
  approvePendingCesarPlan: actions.approvePending, cancelPendingCesarPlan: actions.cancelPending,
}));
vi.mock('../../packages/cli/src/blocks/worktree-plan-effects.js', () => ({
  worktreePlanHost: () => ({ available: () => true, current: actions.readWorktree, emit: vi.fn(),
    setCurrent: (plan: Plan) => actions.readWorktree.mockReturnValue(plan), save: actions.saveWorktree }),
}));
vi.mock('../../packages/cli/src/signals/dispatch/intent-skills.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../packages/cli/src/signals/dispatch/intent-skills.js')>(),
  dispatchSkillsUiIntent: actions.auto,
}));
vi.mock('../../packages/cli/src/signals/dispatch/cesar-router.js', () => ({ routeWithCesar: router.run }));
vi.mock('../../packages/cli/src/signals/dispatch/utils.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../packages/cli/src/signals/dispatch/utils.js')>(),
  emitPostDispatch: router.post,
}));
import { createMod } from '../../packages/mod-plan/src/implementation.js';
import { planSessionHost } from '@kernlang/agon-mod-plan';
import { dispatchSessionInfoIntent, runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';

beforeEach(() => {
  vi.clearAllMocks();
  actions.approvePending.mockReset().mockResolvedValue(false);
  actions.cancelPending.mockReset().mockReturnValue(false);
  actions.readWorktree.mockReset().mockReturnValue(null);
  actions.auto.mockReset().mockResolvedValue(null);
});

async function invokePhysical(command: string, cb: DispatchCallbacks) {
  const intents: IntentContribution[] = [];
  const registrar = new Proxy({}, { get: (_, method) => (value: unknown) => {
    if (method === 'intent') intents.push(value as IntentContribution);
    return () => {};
  } }) as Registrar;
  await (await createMod({ planSession: planSessionHost } as ModServices)).activate(registrar);
  const contribution = intents.find(entry => entry.parse(command) !== undefined)!;
  await runPhysicalTuiContribution({ payload: contribution }, contribution.parse(command)!, command, cb, new AbortController().signal);
}

it.each(['physical', 'legacy'] as const)('preserves approval and cancellation precedence through the %s route', async route => {
  const cb = { dispatch: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks;
  for (const type of ['approve', 'cancel'] as const) {
    for (const pending of [true, false]) {
      const trace: string[] = [];
      router.post.mockClear();
      actions.approvePending.mockImplementation(async () => { trace.push('pending'); return pending; });
      actions.cancelPending.mockImplementation(() => { trace.push('pending'); return pending; });
      actions.readWorktree.mockImplementation(() => { trace.push('legacy'); return null; });
      if (route === 'physical') await invokePhysical(`/${type}`, cb);
      else await expect(dispatchSessionInfoIntent({ type }, 'original input', cb)).resolves.toEqual({ handled: true, ranAsJob: false });
      expect(trace).toEqual(pending ? ['pending'] : ['pending', 'legacy']);
      expect(router.post).toHaveBeenCalledExactlyOnceWith({ type }, route === 'physical' ? '' : 'original input', cb);
    }
  }
});

it.each(['physical', 'legacy'] as const)('propagates action failures without fallback or tail events through %s', async route => {
  const cb = { dispatch: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks;
  for (const type of ['approve', 'cancel'] as const) {
    for (const failAt of ['pending', 'legacy'] as const) {
      const failure = new Error(`${type}-${failAt}`);
      const trace: string[] = [];
      router.post.mockClear();
      const pending = () => { trace.push('pending'); if (failAt === 'pending') throw failure; return false; };
      const legacy = () => { trace.push('legacy'); throw failure; };
      actions.approvePending.mockImplementation(async () => pending());
      actions.cancelPending.mockImplementation(pending);
      actions.readWorktree.mockImplementation(legacy);
      const operation = route === 'physical' ? invokePhysical(`/${type}`, cb) : dispatchSessionInfoIntent({ type }, 'original input', cb);
      await expect(operation).rejects.toBe(failure);
      expect(trace).toEqual(failAt === 'pending' ? ['pending'] : ['pending', 'legacy']);
      expect(router.post).not.toHaveBeenCalled();
    }
  }
});

it.each(['physical', 'legacy'] as const)('persists distinct approval and cancellation outcomes through %s', async route => {
  const cb = { dispatch: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks;
  for (const type of ['approve', 'cancel'] as const) {
    const draft = createPlan({ type: 'build', task: 'fixture' },
      { id: 'fixture', path: '/fixture', headSha: 'abc', branch: 'fixture', dirty: false }, []);
    actions.readWorktree.mockReturnValue(draft);
    actions.saveWorktree.mockClear();
    router.post.mockClear();
    if (route === 'physical') await invokePhysical(`/${type}`, cb);
    else await dispatchSessionInfoIntent({ type }, 'original input', cb);
    expect(actions.saveWorktree).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: draft.id, state: type === 'approve' ? 'approved' : 'cancelled',
    }));
    expect(draft.state).toBe('draft');
    expect(router.post).toHaveBeenCalledOnce();
  }
});

it.each(['handled', 'job', 'unsupported', 'error'] as const)('retains the physical Auto event boundary: %s', async outcome => {
  const cb = { dispatch: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks;
  const failure = new Error('auto failed');
  actions.auto.mockImplementation(async (request, input, callbacks) => {
    if (outcome === 'error') throw failure;
    router.post(request, input, callbacks);
    return outcome === 'unsupported' ? null : { handled: true, ranAsJob: outcome === 'job' };
  });
  const operation = invokePhysical('/auto build parser', cb);
  if (outcome === 'error') await expect(operation).rejects.toBe(failure);
  else await operation;
  expect(actions.auto).toHaveBeenCalledExactlyOnceWith({ type: 'auto', input: 'build parser', autoMode: true }, '', cb);
  expect(router.post).toHaveBeenCalledTimes(outcome === 'error' ? 0 : 1);
  if (outcome === 'unsupported') expect(cb.dispatch).toHaveBeenCalledWith({ type: 'warning', message: 'Unsupported Plan session action.\n' });
});

it.each([true, false])('retains legacy task job=%s results and event input', async job => {
  router.run.mockReset().mockResolvedValue(job);
  const cb = { dispatch: vi.fn(), setActivePlan: vi.fn(), ctx: { config: {} } } as unknown as DispatchCallbacks;
  const request = { type: 'plan-task', task: 'build parser' };
  await expect(dispatchSessionInfoIntent(request, 'original task input', cb)).resolves.toEqual({ handled: true, ranAsJob: job });
  expect(router.run).toHaveBeenCalledExactlyOnceWith('[PLAN MODE] build parser', [], cb);
  expect(router.post).toHaveBeenCalledTimes(job ? 0 : 1);
  if (!job) expect(router.post).toHaveBeenCalledWith(request, 'original task input', cb);
});

it.each([true, false])('routes a task through Plan mode, preserves job=%s events and does not resume implicit disk state', async job => {
  router.run.mockReset().mockResolvedValue(job);
  router.post.mockClear();
  const intents: IntentContribution[] = [];
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'intent') intents.push(args[0] as IntentContribution);
    return () => {};
  } }) as Registrar;
  await (await createMod({ planSession: planSessionHost } as ModServices)).activate(registrar);
  const dispatch = vi.fn(); const setActivePlan = vi.fn();
  const cb = { dispatch, setActivePlan, ctx: { config: {} } } as unknown as DispatchCallbacks;
  const plan = intents.find(entry => entry.id === 'intentVariants:0046')!;
  await runPhysicalTuiContribution({ payload: plan }, plan.parse('/plan build parser')!, 'plan', cb, new AbortController().signal);
  expect(router.run).toHaveBeenCalledWith('[PLAN MODE] build parser', [], cb);
  expect(setActivePlan).toHaveBeenCalledWith(expect.objectContaining({ intent: 'build parser' }));
  expect(router.post).toHaveBeenCalledTimes(job ? 0 : 1);
  router.post.mockClear();
  router.run.mockClear();
  await runPhysicalTuiContribution({ payload: plan }, plan.parse('/plan resume')!, 'plan', cb, new AbortController().signal);
  expect(router.run).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('No active plan in this session') }));
  expect(router.post).toHaveBeenCalledExactlyOnceWith({ type: 'plan-resume' }, '', cb);
});
