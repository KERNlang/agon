import { expect, it, vi } from 'vitest';
import * as owner from '@kernlang/agon-mod-plan';
import { createPlan } from '@kernlang/agon-support-worktree';
import type { Plan } from '@kernlang/agon-support-worktree';
import type { WorktreePlanEvent } from '@kernlang/agon-mod-plan';

function fixture(answer = 'y', kind: 'build' | 'forge' = 'forge') {
  let current: Plan | null = createPlan({ type: kind, task: 'fixture task', fitnessCmd: 'npm test', hardened: true },
    { id: 'fixture', path: '/fixture', headSha: 'abc', branch: 'fixture', dirty: false },
    [{ id: 'build', kind: 'dispatch', label: 'Build', effects: ['write'] }]);
  const host = {
    available: () => true,
    current: () => current,
    setCurrent: vi.fn((plan: Plan) => { current = plan; }),
    load: vi.fn((_id: string) => current), list: vi.fn((_limit: number) => current ? [current] : []),
    save: vi.fn<(plan: Plan) => void>(), emit: vi.fn<(event: WorktreePlanEvent) => void>(),
    ask: vi.fn(async (_question: string) => answer), forge: vi.fn(async (_plan: Plan) => {}),
  };
  return { host, initial: current };
}

it('refuses an answer when the same draft object changes state', async () => {
  const { host, initial } = fixture();
  host.ask.mockImplementation(async () => { initial.state = 'cancelled'; return 'y'; });
  await owner.showWorktreePlan(host);
  expect(host.save).not.toHaveBeenCalled();
  expect(host.forge).not.toHaveBeenCalled();
  expect(initial.state).toBe('cancelled');
});

it.each(['missing', 'current', 'recent', 'empty', 'completed'] as const)('preserves %s plan selection', async selection => {
  const { host, initial } = fixture('');
  if (selection === 'missing') host.load.mockReturnValue(null);
  if (selection === 'completed') initial.state = 'completed';
  if (selection === 'recent' || selection === 'empty') {
    host.current = () => null;
    host.list.mockReturnValue(selection === 'recent' ? [initial] : []);
  }
  await owner.showWorktreePlan(host, selection === 'missing' ? 'missing' : undefined);
  expect(host.ask).toHaveBeenCalledTimes(['current', 'recent'].includes(selection) ? 1 : 0);
  if (selection === 'missing') expect(host.list).not.toHaveBeenCalled();
  if (selection === 'current' || selection === 'completed') expect(host.list).not.toHaveBeenCalled();
  if (selection === 'recent') expect(host.setCurrent).toHaveBeenCalledWith(initial);
  if (selection === 'empty') expect(host.emit).toHaveBeenCalledWith({ type: 'info', message: 'No plans yet. Run /forge or build to create one.' });
  expect(host.save).not.toHaveBeenCalled();
});

it.each([1, 2, 0])('stops retry effects on save failure %s, or preserves full ordering', async failAt => {
  const { host, initial } = fixture();
  initial.state = 'failed';
  initial.steps[0].result.state = 'failed';
  const trace: string[] = [];
  const failure = new Error('save failed');
  let saves = 0;
  const setCurrent = host.setCurrent;
  host.setCurrent = vi.fn(plan => { trace.push(`state:${plan.state}`); setCurrent(plan); });
  host.save.mockImplementation(plan => { trace.push(`save:${plan.state}`); if (++saves === failAt) throw failure; });
  host.emit.mockImplementation(event => { trace.push(`event:${event.type}`); });
  host.forge.mockImplementation(async () => { trace.push('forge'); });
  if (failAt) await expect(owner.retryWorktreePlan(host)).rejects.toBe(failure);
  else await owner.retryWorktreePlan(host);
  const full = ['event:info', 'state:approved', 'save:approved', 'state:running', 'save:running', 'forge'];
  expect(trace).toEqual(full.slice(0, failAt === 1 ? 3 : failAt === 2 ? 5 : 6));
});

it('preserves the legacy retry reread after a synchronous event changes the active plan', async () => {
  const { host, initial } = fixture('yes', 'build');
  initial.state = 'failed';
  initial.steps[0].result.state = 'failed';
  const replacement = { ...initial, id: 'replacement' };
  host.emit.mockImplementation(() => { host.setCurrent(replacement); });
  await owner.retryWorktreePlan(host);
  expect(host.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'replacement', state: 'approved' }));
});

it.each(['question', 'forge'])('propagates a %s failure', async source => {
  const { host } = fixture();
  const error = new Error(`${source} failed`);
  if (source === 'question') host.ask.mockRejectedValue(error);
  else host.forge.mockRejectedValue(error);
  await expect(owner.showWorktreePlan(host)).rejects.toBe(error);
  if (source === 'question') expect(host.save).not.toHaveBeenCalled();
});

it.each(['', ' ', 'maybe', 'n', 'y', ' YES '])('physical draft workflow handles %j without implicit approval', async answer => {
  const { host, initial } = fixture(answer);
  await owner.showWorktreePlan(host);
  const approved = ['y', 'yes'].includes(answer.trim().toLowerCase());
  expect(host.forge).toHaveBeenCalledTimes(approved ? 1 : 0);
  expect(host.current()?.state).toBe(approved ? 'approved' : answer.trim() ? 'cancelled' : 'draft');
  expect(initial.state).toBe('draft');
  if (approved) expect(host.forge).toHaveBeenCalledWith(expect.objectContaining({ action: initial.action }));
  if (!answer.trim()) expect(host.save).not.toHaveBeenCalled();
});

it('does not apply an answer to a replacement plan', async () => {
  const { host, initial } = fixture();
  const replacement = { ...initial, id: 'replacement' };
  host.ask.mockImplementation(async () => { host.setCurrent(replacement); return 'yes'; });
  await owner.showWorktreePlan(host);
  expect(host.current()).toBe(replacement);
  expect(host.save).not.toHaveBeenCalled();
  expect(host.forge).not.toHaveBeenCalled();
});

it.each(['build', 'forge'] as const)('retry preserves %s transitions and failed-step history', async kind => {
  const { host, initial } = fixture('yes', kind);
  const failed: Plan = { ...initial, state: 'paused', steps: [{ ...initial.steps[0],
    result: { ...initial.steps[0].result, state: 'failed', attempts: [{ startedAt: 'before', error: 'failed' }] } }] };
  host.setCurrent(failed);
  await owner.retryWorktreePlan(host);
  expect(host.save.mock.calls.map(([plan]) => plan.state)).toEqual(kind === 'forge' ? ['approved', 'running'] : ['approved']);
  expect(host.current()?.steps[0].result.state).toBe('pending');
  expect(host.current()?.steps[0].result.attempts).toEqual(failed.steps[0].result.attempts);
  expect(failed.steps[0].result.state).toBe('failed');
  expect(host.forge).toHaveBeenCalledTimes(kind === 'forge' ? 1 : 0);
});

it('does not run Forge after persistence fails', async () => {
  const { host } = fixture();
  const failure = new Error('disk unavailable');
  host.save.mockImplementation(() => { throw failure; });
  await expect(owner.approveWorktreePlan(host)).rejects.toBe(failure);
  expect(host.forge).not.toHaveBeenCalled();
});

it('resets from the first failed step and retains previous results and artifact history', async () => {
  const { host, initial } = fixture('yes', 'build');
  initial.state = 'failed';
  const step = initial.steps[0];
  initial.steps = [
    { ...step, id: 'done', result: { ...step.result, state: 'completed' } },
    { ...step, id: 'failed', result: { ...step.result, state: 'failed',
      attempts: [{ startedAt: 'before' }], artifacts: [{ type: 'patch', path: 'saved.patch' }] } },
    { ...step, id: 'later', result: { ...step.result, state: 'failed' } },
  ];
  const before = structuredClone(initial);
  await owner.retryWorktreePlan(host);
  expect(host.current()?.currentStepId).toBe('failed');
  expect(host.current()?.steps.map(value => value.result.state)).toEqual(['completed', 'pending', 'pending']);
  expect(host.current()?.steps[1].result.attempts).toEqual(before.steps[1].result.attempts);
  expect(host.current()?.steps[1].result.artifacts).toEqual(before.steps[1].result.artifacts);
  expect(initial).toEqual(before);
});

it('lists and cancels through the physical owner', () => {
  const { host } = fixture();
  owner.listWorktreePlans(host);
  expect(host.list).toHaveBeenCalledWith(20);
  expect(host.emit).toHaveBeenCalledWith({ type: 'plan-list', plans: [host.current()] });
  owner.cancelWorktreePlan(host);
  expect(host.current()?.state).toBe('cancelled');
  expect(host.save).toHaveBeenCalledOnce();
  owner.cancelWorktreePlan(host);
  expect(host.save).toHaveBeenCalledOnce();
});
