import { expect, it, vi } from 'vitest';
import * as owner from '@kernlang/agon-mod-plan';

function fixture(): owner.CesarPlan {
  return { ...owner.createCesarPlan('fixture', []), state: 'paused', steps: [{
    id: 'completed', type: 'self', description: 'finished work', state: 'done',
    estimatedTokens: 1, estimatedCostUsd: 1,
    result: { status: 'success', output: 'kept', actualTokens: 1, actualCostUsd: 1, durationMs: 1 },
  }], totalActualTokens: 1, totalActualCostUsd: 1 };
}

it.each(['1', 'resume', '2', 'r', 'restart', ' RESTART '])('executes only the selected resume mode: %s', async answer => {
  expect(owner.runPlanResumeApproval).toBeTypeOf('function');
  const saved = fixture();
  const snapshot = structuredClone(saved);
  const trace: string[] = [];
  const execute = vi.fn(async () => { trace.push('execute'); });
  await owner.runPlanResumeApproval(saved, {
    available: () => { trace.push('authority'); return true; },
    notify: () => { trace.push('notice'); },
    choose: async (prompt, choices, defaultKey) => {
      expect(prompt).toBe('Resume this plan?');
      expect(choices.map(choice => choice.key)).toEqual(['1', '2', '3']);
      expect(defaultKey).toBe('1');
      trace.push('prompt'); return answer;
    }, execute,
  });
  const restart = ['2', 'r', 'restart'].includes(answer.trim().toLowerCase());
  expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    state: 'running', totalActualTokens: restart ? 0 : 1,
    steps: [expect.objectContaining({ state: restart ? 'pending' : 'skipped' })],
  }));
  expect(trace).toEqual(['authority', 'notice', 'prompt', 'authority', 'notice', 'execute']);
  expect(saved).toEqual(snapshot);
});

it.each(['', ' ', '3', 'cancel', 'yes', 'yes please', 'resume please', 'restart.'])('does not execute a dismissed or unknown choice: %j', async answer => {
  expect(owner.runPlanResumeApproval).toBeTypeOf('function');
  const execute = vi.fn(async () => {});
  const notify = vi.fn();
  await owner.runPlanResumeApproval(fixture(), { available: () => true, notify, choose: async () => answer, execute });
  expect(execute).not.toHaveBeenCalled();
  expect(notify).toHaveBeenLastCalledWith('info', 'Plan resume cancelled.');
});

it.each(['before', 'after'])('refuses unavailable authority %s the question', async boundary => {
  expect(owner.runPlanResumeApproval).toBeTypeOf('function');
  const execute = vi.fn(async () => {});
  const choose = vi.fn(async () => '1');
  const notify = vi.fn();
  let calls = 0;
  await owner.runPlanResumeApproval(fixture(), {
    available: () => ++calls === 1 && boundary === 'after', notify, choose, execute,
  });
  expect(execute).not.toHaveBeenCalled();
  expect(choose).toHaveBeenCalledTimes(boundary === 'before' ? 0 : 1);
  expect(notify).toHaveBeenCalledTimes(boundary === 'before' ? 0 : 1);
});

it('keeps exact summary, choices and restart notice', async () => {
  const plan = fixture();
  plan.steps[0] = { ...plan.steps[0], state: 'failed', estimatedTokens: 1200, estimatedCostUsd: 2.5,
    result: { ...plan.steps[0].result!, status: 'failure', error: 'failed locally' } };
  const notify = vi.fn();
  const choose = vi.fn(async () => '2');
  await owner.runPlanResumeApproval(plan, { available: () => true, notify, choose, execute: async () => {} });
  expect(notify.mock.calls).toEqual([
    ['info', 'Resume plan: fixture\n0/1 steps completed · 1 remaining\nFailed step: finished work — failed locally\nEstimated cost to finish: ~1,200 tokens · $2.50'],
    ['info', 'Restarting plan from step 1: fixture'],
  ]);
  expect(choose).toHaveBeenCalledExactlyOnceWith('Resume this plan?', [
    { key: '1', label: 'Resume — continue from where it stopped', color: '#4ade80' },
    { key: '2', label: 'Restart — rerun all steps from the beginning', color: '#fbbf24' },
    { key: '3', label: 'Cancel — keep the plan paused', color: '#ef4444' },
  ], '1');
});

it.each(['available', 'notify', 'choose', 'execute'] as const)('propagates a failed %s effect without later effects', async failure => {
  const trace: string[] = [];
  const error = Error(failure);
  const effect = (name: string) => { trace.push(name); if (name === failure) throw error; };
  await expect(owner.runPlanResumeApproval(fixture(), {
    available: () => { effect('available'); return true; },
    notify: () => effect('notify'),
    choose: async () => { effect('choose'); return '1'; },
    execute: async () => effect('execute'),
  })).rejects.toBe(error);
  expect(trace).toEqual({
    available: ['available'],
    notify: ['available', 'notify'],
    choose: ['available', 'notify', 'choose'],
    execute: ['available', 'notify', 'choose', 'available', 'notify', 'execute'],
  }[failure]);
});

it('cancels a dismissed prompt without checking stale authority again', async () => {
  let current = true;
  const available = vi.fn(() => current);
  const notify = vi.fn();
  const execute = vi.fn(async () => {});
  await owner.runPlanResumeApproval(fixture(), {
    available, notify, execute, choose: async () => { current = false; return ''; },
  });
  expect(available).toHaveBeenCalledTimes(1);
  expect(execute).not.toHaveBeenCalled();
  expect(notify).toHaveBeenLastCalledWith('info', 'Plan resume cancelled.');
});

it('waits for the accepted execution to settle', async () => {
  let finish!: () => void;
  let entered!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let settled = false;
  const result = owner.runPlanResumeApproval(fixture(), {
    available: () => true, notify: () => {}, choose: async () => '1',
    execute: () => { entered(); return running; },
  }).then(() => { settled = true; });
  await started;
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await result;
  expect(settled).toBe(true);
});
