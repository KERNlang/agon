import { describe, expect, it, vi } from 'vitest';

import * as agentRuntime from '@kernlang/agon-support-agent-runtime';
import * as worktree from '@kernlang/agon-support-worktree';
import {
  approvePlan as approveSupportPlan,
  sessionWorktreesDir,
  type Plan,
  type WorktreePlanRuntime,
  type WorktreeSessionRuntime,
} from '@kernlang/agon-support-worktree';
import { approvePlan as approveLegacyPlan } from '../../packages/core/src/blocks/plan.js';
import { PlanStateError } from '../../packages/core/src/models/errors.js';
import { worktreePlanHost } from '../../packages/cli/src/blocks/worktree-plan-effects.js';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

function plan(state: Plan['state']): Plan {
  return {
    id: 'isolation-plan',
    action: { type: 'build', task: 'prove runtime isolation' },
    state,
    steps: [],
    workspace: { id: 'w', path: '/tmp/w', headSha: 'abc', branch: 'main', dirty: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    currentStepId: null,
  };
}

function sessionRuntime(home: string): WorktreeSessionRuntime {
  return {
    getAgonHome: () => home,
    ensureAgonHome: () => undefined,
    worktreeAddOnBranch: () => '',
    worktreeRemoveBestEffort: () => undefined,
    linkWorktreeNodeModules: () => undefined,
    hydrateWorktreeBuildArtifacts: () => undefined,
    absoluteGitDir: () => '',
    isDirty: () => false,
    worktreePrune: () => undefined,
  };
}

describe('S4 support runtime isolation', () => {
  it.each([
    ['approvePlan', 'draft'], ['startPlan', 'approved'],
    ['cancelPlan', ['draft', 'approved', 'running', 'paused', 'failed']],
    ['failPlan', ['running', 'paused']],
  ] as const)(
    'keeps the legacy typed error at the physical %s boundary', (transition, expected) => {
      expect(PlanStateError).toBe(worktree.PlanStateError);
      let caught: unknown;
      try { worktree[transition](plan('completed')); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(PlanStateError);
      expect(caught).toMatchObject({ expected, actual: 'completed', name: 'PlanStateError',
        message: `Invalid plan state: expected ${typeof expected === 'string' ? expected : expected.join(' | ')}, got completed` });
    },
  );

  it.each(['approvePlan', 'startPlan', 'cancelPlan', 'failPlan'] as const)(
    'preserves the invocation-scoped custom error for %s', transition => {
      const custom = new Error('custom transition error');
      const createStateError = vi.fn(() => custom);
      const invalid = plan('completed');
      const call = () => transition === 'failPlan'
        ? worktree.failPlan(invalid, 'failure detail', { createStateError })
        : worktree[transition](invalid, { createStateError });
      let caught: unknown;
      try { call(); } catch (error) { caught = error; }
      expect(caught).toBe(custom);
      const expected = transition === 'approvePlan' ? 'draft' : transition === 'startPlan' ? 'approved'
        : transition === 'cancelPlan' ? ['draft', 'approved', 'running', 'paused', 'failed'] : ['running', 'paused'];
      expect(createStateError).toHaveBeenCalledExactlyOnceWith(expected, 'completed');
    },
  );

  it('uses the physical default rather than a CLI error adapter', () => {
    const host = worktreePlanHost(vi.fn(), {} as HandlerContext);
    expect(host.stateRuntime).toBeUndefined();
  });

  it('exports no process-global agent runtime configurator', () => {
    expect('configureAgentLoopRuntime' in agentRuntime).toBe(false);
    expect('configureAgentSessionRuntime' in agentRuntime).toBe(false);
  });

  it('keeps plan error capabilities isolated across interleaved invocations', () => {
    const runtimeA: WorktreePlanRuntime = { createStateError: () => new Error('runtime-a') };
    const runtimeB: WorktreePlanRuntime = { createStateError: () => new Error('runtime-b') };

    expect(() => approveSupportPlan(plan('running'), runtimeA)).toThrow('runtime-a');
    expect(() => approveLegacyPlan(plan('running'))).toThrow(PlanStateError);
    expect(() => approveSupportPlan(plan('running'), runtimeB)).toThrow('runtime-b');
    expect(() => approveLegacyPlan(plan('running'))).toThrow(PlanStateError);
  });

  it('keeps duplicated worktree capability objects independent', () => {
    const a = sessionWorktreesDir('/tmp/repo', sessionRuntime('/tmp/agon-a'));
    const b = sessionWorktreesDir('/tmp/repo', sessionRuntime('/tmp/agon-b'));

    expect(a).toMatch(/^\/tmp\/agon-a\/worktrees\//);
    expect(b).toMatch(/^\/tmp\/agon-b\/worktrees\//);
    expect(a).not.toBe(b);
  });
});
