import { describe, expect, it } from 'vitest';

import { compileWorkflowSpec } from '../../packages/core/src/generated/workflows/compiler.js';
import {
  appendWorkflowPhaseEvent,
  createWorkflowRun,
  verifyWorkflowExecutionPlanFlow,
  verifyWorkflowRunFlow,
} from '../../packages/core/src/index.js';
import type { WorkflowRun } from '../../packages/core/src/index.js';

function makeRun(planId: string, runId: string, phaseSpecs: { id: string; dependsOn?: string[] }[]): WorkflowRun {
  const plan = compileWorkflowSpec({
    id: planId,
    version: '1.0.0',
    phases: phaseSpecs.map((p) => ({ id: p.id, dependsOn: p.dependsOn })),
  });
  return createWorkflowRun(plan, runId);
}

describe('verifyWorkflowRunFlow', () => {
  it('returns no issues for a valid completed run', () => {
    let run = makeRun('valid', 'run-valid', [{ id: 'inspect' }, { id: 'verify', dependsOn: ['inspect'] }]);
    run = appendWorkflowPhaseEvent(run, 'inspect', 'started');
    run = appendWorkflowPhaseEvent(run, 'inspect', 'completed');
    run = appendWorkflowPhaseEvent(run, 'verify', 'started');
    run = appendWorkflowPhaseEvent(run, 'verify', 'completed');

    expect(run.status).toBe('completed');
    expect(verifyWorkflowRunFlow(run)).toEqual([]);
  });

  it('reports missing closure events for a completed run', () => {
    const plan = compileWorkflowSpec({
      id: 'missing-close',
      version: '1.0.0',
      phases: [{ id: 'inspect' }, { id: 'verify', dependsOn: ['inspect'] }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-missing'),
      status: 'completed',
      events: [
        { runId: 'run-missing', workflowId: 'missing-close', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:00Z' },
        { runId: 'run-missing', workflowId: 'missing-close', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:01Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('missing-node');
    expect(issues[0].path).toBe('phases[1]');
    expect(issues[0].message).toContain('verify');
  });

  it('reports out-of-order dependency events', () => {
    const plan = compileWorkflowSpec({
      id: 'ordered',
      version: '1.0.0',
      phases: [{ id: 'inspect' }, { id: 'verify', dependsOn: ['inspect'] }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-ordered'),
      status: 'running',
      events: [
        { runId: 'run-ordered', workflowId: 'ordered', phaseId: 'verify', type: 'started', at: '2026-01-01T00:00:00Z' },
        { runId: 'run-ordered', workflowId: 'ordered', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:01Z' },
        { runId: 'run-ordered', workflowId: 'ordered', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:02Z' },
        { runId: 'run-ordered', workflowId: 'ordered', phaseId: 'verify', type: 'completed', at: '2026-01-01T00:00:03Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('invalid-phase');
    expect(issues.some((i) => i.message.includes('cannot start before dependency "inspect"'))).toBe(true);
  });

  it('does not let out-of-order starts mutate iteration state', () => {
    const plan = compileWorkflowSpec({
      id: 'out-of-order-loop',
      version: '1.0.0',
      phases: [{ id: 'inspect' }, { id: 'verify', dependsOn: ['inspect'] }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-out-of-order-loop'),
      status: 'running',
      events: [
        { runId: 'run-out-of-order-loop', workflowId: 'out-of-order-loop', phaseId: 'verify', type: 'started', at: '2026-01-01T00:00:00Z', data: { iterationLimit: 1 } },
        { runId: 'run-out-of-order-loop', workflowId: 'out-of-order-loop', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:01Z' },
        { runId: 'run-out-of-order-loop', workflowId: 'out-of-order-loop', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:02Z' },
        { runId: 'run-out-of-order-loop', workflowId: 'out-of-order-loop', phaseId: 'verify', type: 'started', at: '2026-01-01T00:00:03Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.message.includes('cannot start before dependency'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('exceeded iteration limit'))).toBe(false);
  });

  it('reports duplicate starts and closes', () => {
    const plan = compileWorkflowSpec({
      id: 'duplicates',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-dup'),
      status: 'running',
      events: [
        { runId: 'run-dup', workflowId: 'duplicates', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:00Z' },
        { runId: 'run-dup', workflowId: 'duplicates', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:01Z' },
        { runId: 'run-dup', workflowId: 'duplicates', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:02Z' },
        { runId: 'run-dup', workflowId: 'duplicates', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:03Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    const duplicateIssues = issues.filter((i) => i.code === 'duplicate-id');
    expect(duplicateIssues).toHaveLength(2);
    expect(duplicateIssues.some((i) => i.message.includes('already started'))).toBe(true);
    expect(duplicateIssues.some((i) => i.message.includes('already closed'))).toBe(true);
  });

  it('does not count rejected duplicate starts toward bounded loop limits', () => {
    const plan = compileWorkflowSpec({
      id: 'duplicate-start-limit',
      version: '1.0.0',
      phases: [{ id: 'iterate' }],
    });
    const baseEvent = { runId: 'run-dup-limit', workflowId: 'duplicate-start-limit', phaseId: 'iterate' };
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-dup-limit'),
      status: 'running',
      events: [
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:00Z', data: { iterationLimit: 1 } },
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:01Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.message.includes('already started'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('exceeded iteration limit'))).toBe(false);
  });

  it('reports bounded composite loop phase counts from event data', () => {
    const plan = compileWorkflowSpec({
      id: 'loop-bounded',
      version: '1.0.0',
      phases: [{ id: 'iterate' }],
    });
    const baseEvent = { runId: 'run-loop', workflowId: 'loop-bounded', phaseId: 'iterate' };
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-loop'),
      status: 'running',
      events: [
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:00Z', data: { iterationLimit: 2 } },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:01Z' },
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:02Z' },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:03Z' },
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:04Z' },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:05Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid-phase');
    expect(issues[0].path).toBe('phases[0]');
    expect(issues[0].message).toContain('exceeded iteration limit');
    expect(issues[0].message).toContain('3 > 2');
  });

  it('uses the strictest iteration limit seen in the event stream', () => {
    const plan = compileWorkflowSpec({
      id: 'loop-tightened',
      version: '1.0.0',
      phases: [{ id: 'iterate' }],
    });
    const baseEvent = { runId: 'run-tight-loop', workflowId: 'loop-tightened', phaseId: 'iterate' };
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-tight-loop'),
      status: 'running',
      events: [
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:00Z', data: { iterationLimit: 3 } },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:01Z' },
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:02Z', data: { iterationLimit: 1 } },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:03Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.message.includes('2 > 1'))).toBe(true);
  });

  it('reports repeated phase cycles without an iteration limit', () => {
    const plan = compileWorkflowSpec({
      id: 'loop-unbounded',
      version: '1.0.0',
      phases: [{ id: 'iterate' }],
    });
    const baseEvent = { runId: 'run-unbounded-loop', workflowId: 'loop-unbounded', phaseId: 'iterate' };
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-unbounded-loop'),
      status: 'running',
      events: [
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:00Z' },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:01Z' },
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:02Z' },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:03Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.message.includes('repeated without an iteration limit'))).toBe(true);
  });

  it('reports completed runs with reopened phases that are still open', () => {
    const plan = compileWorkflowSpec({
      id: 'completed-open-loop',
      version: '1.0.0',
      phases: [{ id: 'iterate' }],
    });
    const baseEvent = { runId: 'run-open-loop', workflowId: 'completed-open-loop', phaseId: 'iterate' };
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-open-loop'),
      status: 'completed',
      events: [
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:00Z', data: { iterationLimit: 2 } },
        { ...baseEvent, type: 'completed', at: '2026-01-01T00:00:01Z', data: { deferCompletion: true } },
        { ...baseEvent, type: 'started', at: '2026-01-01T00:00:02Z', data: { iterationLimit: 2 } },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.message.includes('still has open phase "iterate"'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('missing closure event for phase "iterate"'))).toBe(true);
  });

  it('allows a bounded build-review-fix-review loop when every reopened phase carries an iteration limit', () => {
    const plan = compileWorkflowSpec({
      id: 'build-review-fix-loop',
      version: '1.0.0',
      phases: [
        { id: 'build' },
        { id: 'review', dependsOn: ['build'] },
        { id: 'fix', dependsOn: ['review'] },
      ],
    });
    const base = { runId: 'run-build-review-fix-loop', workflowId: 'build-review-fix-loop' };
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-build-review-fix-loop'),
      status: 'completed',
      events: [
        { ...base, phaseId: 'build', type: 'started', at: '2026-01-01T00:00:00Z', data: { iterationLimit: 3 } },
        { ...base, phaseId: 'build', type: 'completed', at: '2026-01-01T00:00:01Z' },
        { ...base, phaseId: 'review', type: 'started', at: '2026-01-01T00:00:02Z', data: { iterationLimit: 3 } },
        { ...base, phaseId: 'review', type: 'completed', at: '2026-01-01T00:00:03Z', data: { deferCompletion: true } },
        { ...base, phaseId: 'fix', type: 'started', at: '2026-01-01T00:00:04Z', data: { iterationLimit: 3 } },
        { ...base, phaseId: 'fix', type: 'completed', at: '2026-01-01T00:00:05Z', data: { deferCompletion: true } },
        { ...base, phaseId: 'review', type: 'started', at: '2026-01-01T00:00:06Z', data: { iterationLimit: 3 } },
        { ...base, phaseId: 'review', type: 'completed', at: '2026-01-01T00:00:07Z' },
        { ...base, phaseId: 'fix', type: 'started', at: '2026-01-01T00:00:08Z', data: { iterationLimit: 3 } },
        { ...base, phaseId: 'fix', type: 'skipped', at: '2026-01-01T00:00:09Z' },
      ],
    };

    expect(verifyWorkflowRunFlow(run)).toEqual([]);
  });

  it('returns structured conformance issues with codes and paths', () => {
    const plan = compileWorkflowSpec({
      id: 'structured',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-structured'),
      status: 'completed',
      events: [],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue).toHaveProperty('code');
      expect(issue).toHaveProperty('message');
      expect(issue).toHaveProperty('path');
    }
  });

  it('reports run workflow identity that disagrees with the execution plan', () => {
    const plan = compileWorkflowSpec({
      id: 'plan-workflow',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-plan-mismatch'),
      workflowId: 'claimed-workflow',
      status: 'running',
      events: [
        { runId: 'run-plan-mismatch', workflowId: 'claimed-workflow', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:00Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.path === 'workflowId' && issue.code === 'invalid-phase')).toBe(true);
  });

  it('does not treat failed, blocked, and cancelled dependencies as successful closures', () => {
    const plan = compileWorkflowSpec({
      id: 'terminal-events',
      version: '1.0.0',
      phases: [{ id: 'inspect' }, { id: 'verify', dependsOn: ['inspect'] }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-terminal-events'),
      status: 'failed',
      events: [
        { runId: 'run-terminal-events', workflowId: 'terminal-events', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:00Z' },
        { runId: 'run-terminal-events', workflowId: 'terminal-events', phaseId: 'inspect', type: 'failed', at: '2026-01-01T00:00:01Z' },
        { runId: 'run-terminal-events', workflowId: 'terminal-events', phaseId: 'verify', type: 'started', at: '2026-01-01T00:00:02Z' },
        { runId: 'run-terminal-events', workflowId: 'terminal-events', phaseId: 'verify', type: 'cancelled', at: '2026-01-01T00:00:03Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.message.includes('cannot start before dependency'))).toBe(true);
  });

  it('does not treat failed or cancelled closure as successful completion for completed runs', () => {
    const plan = compileWorkflowSpec({
      id: 'successful-closure',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-successful-closure'),
      status: 'completed',
      events: [
        { runId: 'run-successful-closure', workflowId: 'successful-closure', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:00Z' },
        { runId: 'run-successful-closure', workflowId: 'successful-closure', phaseId: 'inspect', type: 'failed', at: '2026-01-01T00:00:01Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.code === 'missing-node' && issue.message.includes('inspect'))).toBe(true);
  });

  it('allows first-party cancellation of a pending run without a prior started event', () => {
    const plan = compileWorkflowSpec({
      id: 'pending-cancel',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-pending-cancel'),
      status: 'cancelled',
      events: [
        { runId: 'run-pending-cancel', workflowId: 'pending-cancel', phaseId: 'inspect', type: 'cancelled', at: '2026-01-01T00:00:00Z' },
      ],
    };

    expect(verifyWorkflowRunFlow(run)).toEqual([]);
  });

  it('does not let isolated events mutate phase closure state', () => {
    const plan = compileWorkflowSpec({
      id: 'isolation-state',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-isolation-state'),
      status: 'completed',
      events: [
        { runId: 'other-run', workflowId: 'isolation-state', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:00Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    expect(issues.some((issue) => issue.path === 'events[0].runId')).toBe(true);
    expect(issues.some((issue) => issue.message.includes('missing closure event'))).toBe(true);
  });

  it('reports malformed execution plans with unknown dependency ids', () => {
    const plan = compileWorkflowSpec({
      id: 'malformed-plan',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const malformed = {
      ...plan,
      phases: [{ ...plan.phases[0], dependsOn: ['missing'] }],
    };

    const issues = verifyWorkflowExecutionPlanFlow(malformed);
    expect(issues.some((issue) => issue.code === 'missing-node' && issue.message.includes('unknown phase'))).toBe(true);
  });
});
