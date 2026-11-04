import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import * as owner from '../../packages/mod-plan/src/proposal-workflow.js';
import { createCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import type { CesarPlan } from '../../packages/mod-plan/src/execution-model.js';

afterEach(() => vi.restoreAllMocks());
function fixture(failure = '') {
  const prior = { ...createCesarPlan('old', []), id: 'old', state: 'awaiting_approval' as const };
  let proposed: CesarPlan | undefined = prior;
  const trace: string[] = [];
  const saved: CesarPlan[] = [];
  const host = {
    estimator: { estimate: () => ({ tokens: 123, costUsd: 0.5 }) },
    agenticAutoMode: () => false,
    markdownPath: (id: string) => `/fixture/${id}.md`,
    writeMarkdown: (_path: string, markdown: string) => {
      trace.push('markdown'); expect(markdown).toContain('new');
      if (failure === 'markdown') throw new Error('write refused');
    },
    persist: (plan: CesarPlan) => {
      trace.push(`persist:${plan.intent}:${plan.state}`);
      if (failure === 'persist' || (failure === 'supersede' && plan.id === 'old')) throw new Error('store refused');
      saved.push(plan);
    },
    proposed: () => proposed,
    active: () => null,
    clearProposal: () => { trace.push('clear'); proposed = undefined; },
    notify: (message: string) => trace.push(message),
    publish: (plan: CesarPlan, markdown: string) => {
      expect(markdown).toContain('new');
      trace.push(`publish:${plan.intent}`);
    },
  };
  return { prior, host, trace, saved };
}
const input = { intent: 'new', steps: [{ id: 'a', type: 'self', description: 'work', estimatedCostUsd: 0 }], planningCost: { tokens: 1, costUsd: 0 } };

it('owns the creation workflow outside the CLI', () => {
  expect(owner.publishPlanProposal).toBeTypeOf('function');
  const cli = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  const handler = cli.slice(cli.indexOf('export async function handleProposePlan('), cli.indexOf('export function handleExitPlanMode('));
  expect(handler).toContain('publishPlanProposal');
  expect(handler).not.toContain('cancelCesarPlan(');
  expect(handler).not.toContain("state: 'awaiting_approval'");
});

it('persists replacement before retiring the prior proposal and publishing', () => {
  const { host, trace, saved, prior } = fixture();
  const result = owner.publishPlanProposal(input, host);
  expect(trace).toEqual(['markdown', 'persist:new:awaiting_approval', 'persist:old:cancelled', 'clear', 'publish:new']);
  expect(result).toBe(saved[0]);
  expect(result.totalEstimatedTokens).toBe(123);
  expect(result.totalEstimatedCostUsd).toBe(0.5);
  expect(result.planningCost).toBeUndefined();
  expect(result.planFilePath).toBe(`/fixture/${result.id}.md`);
  expect(prior.state).toBe('awaiting_approval');
});

it.each(['markdown', 'persist'])('preserves the old proposal if %s fails', failure => {
  const { host, trace, prior } = fixture(failure);
  expect(() => owner.publishPlanProposal(input, host)).toThrow(/refused/);
  expect(host.proposed()).toBe(prior);
  expect(trace).not.toContain('clear');
  expect(trace).not.toContain('persist:old:cancelled');
  expect(trace).not.toContain('publish:new');
});

it('preserves best-effort supersede cleanup after the replacement is durable', () => {
  const { host, trace } = fixture('supersede');
  expect(owner.publishPlanProposal(input, host).intent).toBe('new');
  expect(trace.slice(-2)).toEqual(['clear', 'publish:new']);
});

it.each(['planning', 'running', 'paused', 'done', 'cancelled'] as const)('does not supersede an old %s plan', state => {
  const { host, trace, prior } = fixture();
  host.proposed = () => ({ ...prior, state });
  owner.publishPlanProposal(input, host);
  expect(trace).toEqual(['markdown', 'persist:new:awaiting_approval', 'publish:new']);
});

it.each([true, false])('preserves agentic auto mode=%s and explicit review flags', auto => {
  const { host } = fixture();
  host.agenticAutoMode = () => auto;
  const result = owner.publishPlanProposal({ ...input, selfReview: false }, host);
  expect(result.autoApprove).toBe(auto ? true : undefined);
  expect(result.selfReview).toBe(false);
  expect(result.state).toBe('awaiting_approval');
});

it('reports dropped model steps before publishing the sanitized proposal', () => {
  const { host, trace } = fixture();
  const result = owner.publishPlanProposal({ ...input, steps: [null, ...input.steps] }, host);
  expect(result.steps).toHaveLength(1);
  expect(trace[0]).toBe('Dropped 1 malformed plan step from the proposal.');
});

it('keeps same-ID proposed and active plans out of supersede cleanup', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const { host, prior, trace } = fixture();
  prior.id = 'cplan-1000-i';
  const result = owner.publishPlanProposal(input, { ...host, active: () => prior });
  expect(result.id).toBe(prior.id);
  expect(host.proposed()).toBe(prior);
  expect(trace).toEqual(['markdown', 'persist:new:awaiting_approval', 'publish:new']);
});

it('continues superseding the active plan if proposed-plan cleanup fails', () => {
  const { host, prior, trace } = fixture('supersede');
  owner.publishPlanProposal(input, { ...host, active: () => ({ ...prior, id: 'second', intent: 'second' }) });
  expect(trace).toEqual(['markdown', 'persist:new:awaiting_approval', 'persist:old:cancelled',
    'persist:second:cancelled', 'clear', 'publish:new']);
});

it.each(['estimator', 'notify', 'publish'])('preserves completed effects when %s throws', failure => {
  const { host, trace, prior } = fixture();
  const effects = {
    ...host,
    estimator: { estimate: () => {
      if (failure === 'estimator') throw new Error('estimate failed');
      return { tokens: 123, costUsd: 0.5 };
    } },
    notify: (message: string) => {
      if (failure === 'notify') throw new Error('notification failed');
      host.notify(message);
    },
    publish: () => { throw new Error('publication failed'); },
  };
  expect(() => owner.publishPlanProposal({ ...input, steps: [null, ...input.steps] }, effects)).toThrow(/failed/);
  if (failure === 'publish') {
    expect(trace).toEqual(['Dropped 1 malformed plan step from the proposal.', 'markdown',
      'persist:new:awaiting_approval', 'persist:old:cancelled', 'clear']);
    expect(host.proposed()).toBeUndefined();
  } else {
    expect(trace).toEqual([]);
    expect(host.proposed()).toBe(prior);
  }
});
