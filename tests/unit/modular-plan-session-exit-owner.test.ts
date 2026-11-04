import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import * as owner from '../../packages/mod-plan/src/session-workflow.js';
import { createCesarPlan } from '../../packages/mod-plan/src/execution-state.js';

it('owns exit decisions outside the CLI host', () => {
  expect(owner.exitPlanSession).toBeTypeOf('function');
  const source = readFileSync(new URL('../../packages/cli/src/handlers/plan-mode.ts', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('export function handleExitPlanMode('), source.indexOf('export function buildStepExecutors('));
  expect(handler).toContain('exitPlanSession');
  expect(handler).not.toContain("state === 'running'");
  expect(handler).not.toContain('exitCesarPlan(');
});

it('refuses to abandon running work without any host effects', () => {
  const host = new Proxy({}, { get: () => { throw new Error('unexpected effect'); } });
  const plan = { ...createCesarPlan('active', []), state: 'running' as const };
  expect(owner.exitPlanSession('changed mind', plan, host as owner.PlanExitSessionEffects)).toContain('[BLOCKED]');
});

it.each(['planning', 'awaiting_approval', 'paused'] as const)('leaves a %s session despite archive failure', state => {
  const plan = { ...createCesarPlan('task', []), state };
  const trace: string[] = [];
  const result = owner.exitPlanSession('  changed mind  ', plan, {
    persist: archived => { expect(archived.exitReason).toBe('changed mind'); trace.push('archive'); throw new Error('disk full'); },
    clearProposalAndMarkExited: () => { trace.push('clear'); },
    setInactive: () => { trace.push('inactive'); },
    cancelled: original => { expect(original).toBe(plan); trace.push('cancelled'); },
    notify: message => { expect(message).toBe('Left plan mode — changed mind'); trace.push('info'); },
  });
  expect(result).toContain('[PLAN_EXITED]');
  expect(trace).toEqual(['archive', 'clear', 'inactive', 'cancelled', 'info']);
  expect(plan.state).toBe(state);
});

it.each([undefined, 'done', 'cancelled'] as const)('does not arm the exit guard for %s', state => {
  const effect = vi.fn();
  const notify = vi.fn();
  const current = state ? { ...createCesarPlan('task', []), state } : undefined;
  const result = owner.exitPlanSession('   ', current, {
    persist: effect, clearProposalAndMarkExited: effect, setInactive: effect, cancelled: effect, notify,
  });
  expect(result).toContain('(no reason given)');
  expect(effect).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledExactlyOnceWith('Left plan mode — no reason given');
});
