import { expect, it, vi } from 'vitest';
import * as owner from '@kernlang/agon-mod-plan';

it.each([true, false])('keeps a proposal pending when execution accepts=%s', async accepted => {
  expect(owner.activatePlanProposal).toBeTypeOf('function');
  const proposed = { ...owner.createCesarPlan('fixture', []), state: 'awaiting_approval' as const, planFilePath: '/fixture/plan.md' };
  const trace: unknown[] = [];
  await owner.activatePlanProposal(proposed, {
    policy: () => ({ approve: true, reason: 'fixture', adjustedCostUsd: 0 }),
    notify: (level, message) => { trace.push([level, message]); },
    execute: async plan => { expect(plan.state).toBe('running'); trace.push('execute'); return accepted; },
    setActive: plan => { expect(plan).toBe(proposed); trace.push('pending'); },
    clearProposal: id => { expect(id).toBe(proposed.id); trace.push('clear'); },
  });
  expect(trace).toEqual([
    ['info', 'Plan saved: /fixture/plan.md'], ['info', 'Plan auto-approved (fixture)'], 'execute',
    ...(accepted ? [] : ['pending', 'clear', ['info', 'Plan awaiting approval. Press Y to approve, N to reject — or type /approve / /cancel.']]),
  ]);
  expect(proposed.state).toBe('awaiting_approval');
});

it.each([true, false])('does not execute a policy-refused proposal with autoApprove=%s', async autoApprove => {
  expect(owner.activatePlanProposal).toBeTypeOf('function');
  const proposed = { ...owner.createCesarPlan('fixture', []), autoApprove };
  const execute = vi.fn(async () => true);
  const notify = vi.fn();
  const setActive = vi.fn();
  await owner.activatePlanProposal(proposed, {
    policy: () => ({ approve: false, reason: 'denied', adjustedCostUsd: 0 }),
    execute, notify, setActive, clearProposal: vi.fn(),
  });
  expect(execute).not.toHaveBeenCalled();
  expect(setActive).toHaveBeenCalledExactlyOnceWith(proposed);
  expect(notify).toHaveBeenCalledTimes(autoApprove ? 2 : 1);
  if (autoApprove) expect(notify).toHaveBeenCalledWith('info', 'Plan requested autoApprove but policy rejected: denied');
});

it.each(['none', 'persist', 'markdown', 'chat'])('cancels and records the outcome despite a %s failure', failure => {
  expect(owner.rejectPlanProposal).toBeTypeOf('function');
  const pending = { ...owner.createCesarPlan('fixture', []), state: 'awaiting_approval' as const, planFilePath: '/fixture/plan.md' };
  const trace: string[] = [];
  const attempt = (name: string) => { trace.push(name); if (failure === name) throw new Error('fixture failure'); };
  expect(owner.rejectPlanProposal(pending, {
    clearProposal: id => { expect(id).toBe(pending.id); trace.push('clear'); },
    setActive: plan => { expect(plan).toBeNull(); trace.push('inactive'); },
    persist: plan => { expect(plan.state).toBe('cancelled'); attempt('persist'); },
    writeMarkdown: () => attempt('markdown'),
    cancelled: plan => { expect(plan.state).toBe('cancelled'); trace.push('cancelled'); },
    notify: message => { expect(message).toBe(`Plan rejected — fixture (${pending.id}) cancelled.`); trace.push('notice'); },
    recordRejection: message => {
      expect(message).toBe(`[plan rejected] I rejected the proposed plan "fixture" (${pending.id}). Do not re-propose that same plan — ask what should change, or act on my next instruction.`);
      attempt('chat');
    },
    warn: message => { expect(message).toContain('fixture failure'); trace.push('warn'); },
  })).toBe(true);
  const expected = ['clear', 'inactive', 'persist', 'markdown', 'cancelled', 'notice', 'chat'];
  if (failure !== 'none') expected.splice(expected.indexOf(failure) + 1, 0, 'warn');
  expect(trace).toEqual(expected);
  expect(pending.state).toBe('awaiting_approval');
});

it('does nothing when no proposal exists', () => {
  expect(owner.rejectPlanProposal).toBeTypeOf('function');
  const effects = new Proxy({}, { get: () => { throw new Error('unexpected effect'); } });
  expect(owner.rejectPlanProposal(null, effects as owner.PlanRejectionEffects)).toBe(false);
});

it.each([false, true])('omits missing Markdown and propagates dispatch failure=%s', fails => {
  const pending = { ...owner.createCesarPlan('fixture', []), state: 'awaiting_approval' as const };
  const trace: string[] = [];
  let saved: owner.CesarPlan | undefined;
  const run = () => owner.rejectPlanProposal(pending, {
    clearProposal: () => { trace.push('clear'); },
    setActive: () => { trace.push('inactive'); },
    persist: plan => { saved = plan; trace.push('persist'); },
    writeMarkdown: () => { throw new Error('unexpected Markdown effect'); },
    cancelled: plan => {
      expect(plan).toBe(saved);
      expect(plan.state).toBe('cancelled');
      trace.push('cancelled');
      if (fails) throw new Error('dispatch failed');
    },
    notify: () => { trace.push('notify'); },
    recordRejection: () => { trace.push('chat'); },
    warn: () => { throw new Error('unexpected best-effort warning'); },
  });
  if (fails) expect(run).toThrow('dispatch failed');
  else expect(run()).toBe(true);
  expect(trace).toEqual(['clear', 'inactive', 'persist', 'cancelled', ...(fails ? [] : ['notify', 'chat'])]);
});
