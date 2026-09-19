import { describe, expect, it } from 'vitest';

import * as agentRuntime from '@kernlang/agon-support-agent-runtime';
import {
  approvePlan as approveSupportPlan,
  sessionWorktreesDir,
  type Plan,
  type WorktreePlanRuntime,
  type WorktreeSessionRuntime,
} from '@kernlang/agon-support-worktree';
import { approvePlan as approveLegacyPlan } from '../../packages/core/src/blocks/plan.js';
import { PlanStateError } from '../../packages/core/src/models/errors.js';

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
  it('exports no process-global agent runtime configurator', () => {
    expect('configureAgentLoopRuntime' in agentRuntime).toBe(false);
    expect('configureAgentSessionRuntime' in agentRuntime).toBe(false);
  });

  it('keeps plan error capabilities invocation-scoped across import order', () => {
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
