import { describe, expect, it } from 'vitest';

import { compileWorkflowSpec } from '../../packages/core/src/generated/workflows/compiler.js';
import {
  appendWorkflowPhaseEvent,
  cancelWorkflowRun,
  createWorkflowRun,
} from '../../packages/core/src/index.js';

describe('workflow execution runs', () => {
  it('generates isolated run ids by default', () => {
    const plan = compileWorkflowSpec({
      id: 'isolated',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });

    const first = createWorkflowRun(plan);
    const second = createWorkflowRun(plan);

    expect(first.id).not.toBe(second.id);
  });

  it('rejects phase events outside the execution plan', () => {
    const plan = compileWorkflowSpec({
      id: 'known-phases',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });

    expect(() => appendWorkflowPhaseEvent(createWorkflowRun(plan, 'run-1'), 'missing', 'started')).toThrow(
      /Workflow phase event failed conformance/,
    );
  });

  it('does not complete until every planned phase is closed', () => {
    const plan = compileWorkflowSpec({
      id: 'multi-terminal',
      version: '1.0.0',
      phases: [{ id: 'inspect' }, { id: 'verify' }],
    });

    let run = createWorkflowRun(plan, 'run-2');
    run = appendWorkflowPhaseEvent(run, 'verify', 'started');
    run = appendWorkflowPhaseEvent(run, 'verify', 'completed');

    expect(run.status).toBe('running');

    run = appendWorkflowPhaseEvent(run, 'inspect', 'started');
    run = appendWorkflowPhaseEvent(run, 'inspect', 'skipped');

    expect(run.status).toBe('completed');
    expect(run.currentPhaseId).toBeNull();
  });

  it('rejects duplicate closure and dependency-order violations', () => {
    const plan = compileWorkflowSpec({
      id: 'ordered',
      version: '1.0.0',
      phases: [{ id: 'inspect' }, { id: 'verify', dependsOn: ['inspect'] }],
    });

    let run = createWorkflowRun(plan, 'run-ordered');
    expect(() => appendWorkflowPhaseEvent(run, 'verify', 'completed')).toThrow(
      /Workflow phase event failed conformance/,
    );

    run = appendWorkflowPhaseEvent(run, 'inspect', 'started');
    run = appendWorkflowPhaseEvent(run, 'inspect', 'completed');
    expect(() => appendWorkflowPhaseEvent(run, 'inspect', 'skipped')).toThrow(
      /Workflow phase event failed conformance/,
    );
  });

  it('does not allow phase events after terminal states', () => {
    const plan = compileWorkflowSpec({
      id: 'terminal',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });

    const failed = appendWorkflowPhaseEvent(createWorkflowRun(plan, 'run-3'), 'inspect', 'failed');
    expect(() => appendWorkflowPhaseEvent(failed, 'inspect', 'completed')).toThrow(
      /Workflow phase event failed conformance/,
    );

    let completed = appendWorkflowPhaseEvent(createWorkflowRun(plan, 'run-4'), 'inspect', 'started');
    completed = appendWorkflowPhaseEvent(completed, 'inspect', 'completed');
    expect(() => appendWorkflowPhaseEvent(completed, 'inspect', 'failed')).toThrow(
      /Workflow phase event failed conformance/,
    );
  });

  it('transitions to cancelled through cancelled phase events', () => {
    const plan = compileWorkflowSpec({
      id: 'cancel-event',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });

    const run = appendWorkflowPhaseEvent(createWorkflowRun(plan, 'run-6'), 'inspect', 'cancelled');

    expect(run.status).toBe('cancelled');
    expect(run.currentPhaseId).toBeNull();
  });

  it('can cancel non-terminal runs', () => {
    const plan = compileWorkflowSpec({
      id: 'cancelable',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });

    const run = cancelWorkflowRun(createWorkflowRun(plan, 'run-5'), 'user stopped');

    expect(run.status).toBe('cancelled');
    expect(run.finishedAt).toBeDefined();
    expect(run.events.at(-1)?.type).toBe('cancelled');
    expect(run.events.at(-1)?.data).toEqual({ cancelled: true });
  });
});
