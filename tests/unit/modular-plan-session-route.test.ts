import { describe, expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-plan/src/implementation.js';
import * as session from '../../packages/mod-plan/src/session.js';
import { createPlanProposal } from '../../packages/mod-plan/src/execution-state.js';

async function routes(services: unknown) {
  const intents: IntentContribution[] = [];
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'intent') intents.push(args[0] as IntentContribution);
    return () => {};
  } }) as Registrar;
  await (await createMod(services as ModServices)).activate(registrar);
  return intents;
}
const context = { cwd: '/fixture', invocationId: 'fixture', platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };

describe('physical Plan session routing', () => {
  it.each([true, false])('natural approval precedes resume, accepted=%s', async accepted => {
    const proposedPlan = createPlanProposal('new task', []);
    const activePlan = { ...createPlanProposal('paused task', []), state: 'paused' as const };
    const trace: unknown[] = [];
    expect(await session.dispatchPlanNaturalInput('go', {
      snapshot: () => ({ proposedPlan, activePlan }),
      assertAvailable: action => { trace.push(action); },
      approve: async () => { trace.push('approve'); return accepted; },
      resume: async plan => { trace.push(plan.id); }, notify: vi.fn(),
    })).toBe(true);
    expect(trace).toEqual(accepted ? ['/approve', 'approve'] : ['/approve', 'approve', activePlan.id]);
  });

  it.each(['approve', 'resume'] as const)('does not hide or fall back after natural %s failure', async action => {
    const failure = new Error('action failed');
    const resume = vi.fn(async () => { throw failure; });
    const notify = vi.fn();
    const proposedPlan = action === 'approve' ? createPlanProposal('new task', []) : undefined;
    const activePlan = { ...createPlanProposal('paused task', []), state: 'paused' as const };
    await expect(session.dispatchPlanNaturalInput('go', {
      snapshot: () => ({ proposedPlan, activePlan }), assertAvailable: vi.fn(),
      approve: async () => { throw failure; }, resume, notify,
    })).rejects.toBe(failure);
    expect(resume).toHaveBeenCalledTimes(action === 'resume' ? 1 : 0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps status readable without execution authority and ignores unrelated input', async () => {
    const activePlan = { ...createPlanProposal('paused task', []), state: 'paused' as const };
    const effects = { snapshot: () => ({ activePlan }),
      assertAvailable: vi.fn(() => { throw new Error('disabled'); }),
      approve: vi.fn(async () => true), resume: vi.fn(async () => {}), notify: vi.fn(),
    };
    expect(await session.dispatchPlanNaturalInput('status', effects)).toBe(true);
    expect(effects.notify).toHaveBeenCalledWith('info', expect.stringContaining('is paused'));
    expect(await session.dispatchPlanNaturalInput('hello', effects)).toBe(false);
    expect(effects.assertAvailable).not.toHaveBeenCalled();
    expect(effects.approve).not.toHaveBeenCalled();
    expect(effects.resume).not.toHaveBeenCalled();
    expect(effects.notify).toHaveBeenCalledOnce();
  });

  it.each([null, { handled: false, ranAsJob: false }, { handled: true, ranAsJob: true },
    { handled: true, ranAsJob: false }])('emits only a synchronous handled non-Auto tail: %j', result => {
    expect(session.shouldEmitPlanPostDispatch({ type: 'auto', input: 'task', autoMode: true }, result)).toBe(false);
    expect(session.shouldEmitPlanPostDispatch({ type: 'approve' }, result))
      .toBe(result?.handled === true && !result.ranAsJob);
  });

  it.each(['approve', 'cancel'] as const)('the Plan owner selects pending %s before the legacy runner', async type => {
    for (const pending of [true, false]) {
      const calls: string[] = [];
      const effects = {
        approvePending: async () => { calls.push('pending'); return pending; },
        approveLegacy: async () => { calls.push('legacy'); },
        cancelPending: () => { calls.push('pending'); return pending; },
        cancelLegacy: () => { calls.push('legacy'); },
      } as unknown as session.PlanSessionActions;
      await expect(session.dispatchPlanSession({ type }, effects)).resolves.toEqual({ handled: true, ranAsJob: false });
      expect(calls).toEqual(pending ? ['pending'] : ['pending', 'legacy']);
    }
  });

  it('does not fall back after a pending approval fails', async () => {
    const approveLegacy = vi.fn();
    await expect(session.dispatchPlanSession({ type: 'approve' }, {
      approvePending: async () => { throw new Error('save failed'); }, approveLegacy,
    } as unknown as session.PlanSessionActions)).rejects.toThrow('save failed');
    expect(approveLegacy).not.toHaveBeenCalled();
  });

  it('retains task job results and delegates Auto without changing its result', async () => {
    const task = vi.fn(async () => ({ handled: true as const, ranAsJob: true }));
    const autoResult = { handled: true as const, ranAsJob: false };
    const auto = vi.fn(async () => autoResult);
    const effects = { task, auto } as unknown as session.PlanSessionActions;
    await expect(session.dispatchPlanSession({ type: 'plan-task', task: 'task' }, effects))
      .resolves.toEqual({ handled: true, ranAsJob: true });
    expect(task).toHaveBeenCalledExactlyOnceWith('task');
    const request = { type: 'auto' as const, input: 'task', autoMode: true as const };
    await expect(session.dispatchPlanSession(request, effects)).resolves.toBe(autoResult);
    expect(auto).toHaveBeenCalledExactlyOnceWith(request);
  });

  it.each([
    ['/plan build a parser', { type: 'plan-task', task: 'build a parser' }],
    ['/plan resume cplan-123', { type: 'plan-resume', planId: 'cplan-123' }],
    ['/plan resume', { type: 'plan-resume' }],
    ['/plan resumeDatabase', { type: 'plan-task', task: 'resumeDatabase' }],
    ['/plan', { type: 'plan' }],
    ['/plans', { type: 'plans' }],
    ['/approve', { type: 'approve' }],
    ['/cancel', { type: 'cancel' }],
    ['/retry', { type: 'retry' }],
    ['/auto build a parser', { type: 'auto', input: 'build a parser', autoMode: true }],
  ])('%s invokes the interactive workflow', async (input, expected) => {
    const run = vi.fn(async () => ({ exitCode: 0 }));
    const intents = await routes({ planSession: { run } });
    const intent = intents.find((entry) => entry.parse(input) !== undefined)!;
    await expect(intent.run(JSON.parse(JSON.stringify(intent.parse(input))), context)).resolves.toEqual({ exitCode: 0 });
    expect(run).toHaveBeenCalledWith(expected, context);
  });
  it('refuses a headless approval instead of selecting the latest persisted plan', async () => {
    const intents = await routes({});
    const intent = intents.find((entry) => entry.parse('/approve') !== undefined)!;
    await expect(intent.run({}, context)).resolves.toMatchObject({ exitCode: 2 });
  });
});
