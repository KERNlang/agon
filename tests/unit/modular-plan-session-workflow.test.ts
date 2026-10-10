import { expect, it, vi } from 'vitest';
import * as plan from '@kernlang/agon-mod-plan';

it.each([
  ['cplan-saved', 'cplan-saved'],
  [' /tmp/plans/cplan-saved.json ', 'cplan-saved'],
  ['C:\\plans\\cplan-saved.json', 'cplan-saved'],
])('resumes only the explicitly selected persisted plan: %s', async (input, id) => {
  expect(plan.resumePlanSession).toBeTypeOf('function');
  const saved = plan.createCesarPlan('saved', []);
  const load = vi.fn(() => saved);
  const current = vi.fn(() => plan.createCesarPlan('other', []));
  const resume = vi.fn(async () => {});
  const notify = vi.fn();
  await plan.resumePlanSession(input, { load, current, resume, notify });
  expect(load).toHaveBeenCalledExactlyOnceWith(id);
  expect(current).not.toHaveBeenCalled();
  expect(resume).toHaveBeenCalledExactlyOnceWith(saved);
  expect(notify).not.toHaveBeenCalled();
});

it.each([undefined, '', '  '])('uses only session state without an explicit ID: %s', async input => {
  expect(plan.resumePlanSession).toBeTypeOf('function');
  const saved = plan.createCesarPlan('current', []);
  const load = vi.fn(() => { throw new Error('implicit disk discovery'); });
  const resume = vi.fn(async () => {});
  await plan.resumePlanSession(input, { load, current: () => saved, resume, notify: vi.fn() });
  expect(load).not.toHaveBeenCalled();
  expect(resume).toHaveBeenCalledExactlyOnceWith(saved);
});

it.each([undefined, 'missing'])('does not substitute another plan when selection fails: %s', async input => {
  expect(plan.resumePlanSession).toBeTypeOf('function');
  const resume = vi.fn(async () => {});
  const notify = vi.fn();
  await plan.resumePlanSession(input, { load: () => null, current: () => null, resume, notify });
  expect(resume).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledExactlyOnceWith(input ? 'warning' : 'info', input
    ? 'No plan found for id "missing". Tip: `ls ~/.agon/plans` to list saved plan IDs.'
    : 'No active plan in this session. Pass an ID to resume a saved plan: `/plan resume <plan-id>`.');
});

it.each([
  { proposed: true, job: false }, { proposed: true, job: true },
  { proposed: false, job: true }, { proposed: false, job: false },
])('preserves task setup and outcome ordering: %j', async ({ proposed, job }) => {
  expect(plan.startPlanTaskSession).toBeTypeOf('function');
  const trace: unknown[] = [];
  const draft = { ...plan.createCesarPlan('proposal', []), state: 'awaiting_approval' as const };
  const result = await plan.startPlanTaskSession('build parser', {
    setActive: value => { trace.push(value ? ['active', value.intent, value.state] : ['active', null]); },
    prepare: () => { trace.push('prepare'); },
    route: async input => { trace.push(['route', input]); return job; },
    proposed: () => proposed ? draft : undefined,
    acceptProposal: async value => { expect(value).toBe(draft); trace.push('proposal'); },
  });
  expect(trace).toEqual([
    ['active', 'build parser', 'planning'], 'prepare', ['route', '[PLAN MODE] build parser'],
    ...(proposed ? ['proposal'] : job ? [] : [['active', null]]),
  ]);
  expect(result).toEqual(proposed || !job ? { handled: true } : { handled: true, ranAsJob: true });
});

it.each(['prepare', 'route', 'accept'] as const)('preserves failure propagation without clearing session state: %s', async failure => {
  const draft = { ...plan.createCesarPlan('proposal', []), state: 'awaiting_approval' as const };
  const active = vi.fn();
  const prepare = vi.fn(() => { if (failure === 'prepare') throw new Error(failure); });
  const route = vi.fn(async () => { if (failure === 'route') throw new Error(failure); return false; });
  const accept = vi.fn(async () => { throw new Error('accept'); });
  await expect(plan.startPlanTaskSession('task', {
    setActive: active, prepare, route, proposed: () => draft, acceptProposal: accept,
  })).rejects.toThrow(failure);
  expect(active).toHaveBeenCalledOnce();
  expect(active).toHaveBeenCalledWith(expect.objectContaining({ state: 'planning', intent: 'task' }));
  expect(route).toHaveBeenCalledTimes(failure === 'prepare' ? 0 : 1);
  expect(accept).toHaveBeenCalledTimes(failure === 'accept' ? 1 : 0);
});

it('does not replace an explicit read failure with the current session plan', async () => {
  const current = vi.fn();
  const resume = vi.fn();
  await expect(plan.resumePlanSession('saved', {
    load: () => { throw new Error('storage unavailable'); }, current, resume, notify: vi.fn(),
  })).rejects.toThrow('storage unavailable');
  expect(current).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
});

it('does not fall back to an available current plan for a missing explicit ID', async () => {
  const current = vi.fn(() => plan.createCesarPlan('other', []));
  const resume = vi.fn(async () => {});
  await plan.resumePlanSession('missing', { load: () => null, current, resume, notify: vi.fn() });
  expect(current).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
});

it('awaits resume and propagates its rejection', async () => {
  const saved = plan.createCesarPlan('saved', []);
  let reject!: (reason: Error) => void;
  const deferred = new Promise<void>((_, fail) => { reject = fail; });
  let completed = false;
  const result = plan.resumePlanSession('saved', {
    load: () => saved, current: () => null, resume: () => deferred, notify: vi.fn(),
  });
  const checked = expect(result).rejects.toThrow('resume failed');
  void result.then(() => { completed = true; }, () => { completed = true; });
  await Promise.resolve();
  expect(completed).toBe(false);
  reject(new Error('resume failed'));
  await checked;
  expect(completed).toBe(true);
});

it.each([true, false])('ignores a non-pending proposal when routing returns %s', async job => {
  const active = vi.fn();
  const accept = vi.fn(async () => {});
  const draft = { ...plan.createCesarPlan('completed', []), state: 'done' as const };
  const result = await plan.startPlanTaskSession('task', {
    setActive: active, prepare: () => {}, route: async () => job,
    proposed: () => draft, acceptProposal: accept,
  });
  expect(accept).not.toHaveBeenCalled();
  expect(active).toHaveBeenCalledTimes(job ? 1 : 2);
  if (!job) expect(active).toHaveBeenLastCalledWith(null);
  expect(result).toEqual(job ? { handled: true, ranAsJob: true } : { handled: true });
});
