import { describe, expect, it } from 'vitest';
import { promptDelegation } from '../../packages/cli/src/cesar/escalation.js';
import { createTaskExecutionLease } from '../../packages/cli/src/cesar/task-execution-lease.js';

describe('Cesar delegation autonomy', () => {
  it('never prompts for optional read-only thinking modes', async () => {
    const events: any[] = [];
    const ctx = { cesar: { taskExecutionLease: createTaskExecutionLease('help me decide', false, process.cwd()) } } as any;

    await expect(promptDelegation('tribunal', (event: any) => events.push(event), false, undefined, false, ctx, 'REST or GraphQL')).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(events).toEqual([]);
  });

  it('runs routine AND important execution freely in AUTO, asking only at a destructive boundary', async () => {
    const routineEvents: any[] = [];
    const routineCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('fix the recap', true, process.cwd()) } } as any;
    await expect(promptDelegation('forge', (event: any) => routineEvents.push(event), false, undefined, false, routineCtx, 'fix the recap')).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(routineEvents).toEqual([]);

    // Retired important-task prompt: a turn that merely mentions auth/session
    // no longer gates its delegations (CC bypassPermissions parity).
    const importantEvents: any[] = [];
    const importantCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('change the auth session contract', true, process.cwd()) } } as any;
    await expect(promptDelegation('forge', (event: any) => importantEvents.push(event), false, undefined, false, importantCtx, 'change auth')).resolves.toEqual(expect.objectContaining({ approved: true }));
    await expect(promptDelegation('agent', (event: any) => importantEvents.push(event), false, undefined, false, importantCtx, 'implement tests')).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(importantEvents).toEqual([]);

    // A destructive payload inside the delegation target still asks once.
    const destructiveEvents: any[] = [];
    const destructiveCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('fix the recap', true, process.cwd()) } } as any;
    const pending = promptDelegation('forge', (event: any) => destructiveEvents.push(event), false, undefined, false, destructiveCtx, 'reset the sandbox with rm -rf /tmp/sandbox');
    expect(destructiveEvents).toHaveLength(1);
    destructiveEvents[0].resolve('y');
    await expect(pending).resolves.toEqual(expect.objectContaining({ approved: true }));
  });

  it('keeps Goal and Conquer explicit-user-only even in AUTO', async () => {
    const events: any[] = [];
    const implicitCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('finish this task automatically', true, process.cwd()) } } as any;
    await expect(promptDelegation('goal', (event: any) => events.push(event), false, undefined, false, implicitCtx, 'finish this task')).resolves.toEqual(expect.objectContaining({ approved: false }));
    await expect(promptDelegation('conquer', (event: any) => events.push(event), false, undefined, false, implicitCtx, 'finish this task')).resolves.toEqual(expect.objectContaining({ approved: false }));
    expect(events).toEqual([
      expect.objectContaining({ type: 'info', message: expect.stringContaining('Goal requires an explicit user request') }),
      expect.objectContaining({ type: 'info', message: expect.stringContaining('Conquer requires an explicit user request') }),
    ]);

    const explicitCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('launch goal for finish task', true, process.cwd()) } } as any;
    await expect(promptDelegation('goal', (event: any) => events.push(event), false, undefined, false, explicitCtx, 'finish task')).resolves.toEqual(expect.objectContaining({ approved: true }));
  });

  it('asks at a destructive Goal side effect even when Goal itself was explicit', async () => {
    // Push/PR/external-queue side effects now ride mode auto (the broad
    // dangerous-text boundary is retired); Goal/Conquer keep their separate
    // explicit-user-request gate, asserted in the test above.
    const plainEvents: any[] = [];
    const plainCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('launch goal for finish task', true, '/repo') } } as any;
    await expect(promptDelegation('goal', (event: any) => plainEvents.push(event), false, undefined, false, plainCtx, 'finish task', {
      queue: '/outside/tasks', gate: 'npm test', push: true,
    })).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(plainEvents).toEqual([]);

    const events: any[] = [];
    const ctx = { cesar: { taskExecutionLease: createTaskExecutionLease('launch goal for finish task', true, '/repo') } } as any;
    const pending = promptDelegation('goal', (event: any) => events.push(event), false, undefined, false, ctx, 'finish task', {
      queue: '/outside/tasks', gate: 'rm -rf /tmp/agon-goal', push: true,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ type: 'question', prompt: expect.stringContaining('Approve goal') }));
    events[0].resolve('n');
    await expect(pending).resolves.toEqual(expect.objectContaining({ approved: false }));
  });
});
