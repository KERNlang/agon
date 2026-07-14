import { describe, expect, it } from 'vitest';
import { promptDelegation } from '../../packages/cli/src/generated/cesar/escalation.js';
import { createTaskExecutionLease } from '../../packages/cli/src/generated/cesar/task-execution-lease.js';

describe('Cesar delegation autonomy', () => {
  it('never prompts for optional read-only thinking modes', async () => {
    const events: any[] = [];
    const ctx = { cesar: { taskExecutionLease: createTaskExecutionLease('help me decide', false, process.cwd()) } } as any;

    await expect(promptDelegation('tribunal', (event: any) => events.push(event), false, undefined, false, ctx, 'REST or GraphQL')).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(events).toEqual([]);
  });

  it('runs routine execution freely in AUTO but asks once for important work', async () => {
    const routineEvents: any[] = [];
    const routineCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('fix the recap', true, process.cwd()) } } as any;
    await expect(promptDelegation('forge', (event: any) => routineEvents.push(event), false, undefined, false, routineCtx, 'fix the recap')).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(routineEvents).toEqual([]);

    const importantEvents: any[] = [];
    const importantCtx = { cesar: { taskExecutionLease: createTaskExecutionLease('change the auth session contract', true, process.cwd()) } } as any;
    const first = promptDelegation('forge', (event: any) => importantEvents.push(event), false, undefined, false, importantCtx, 'change auth');
    expect(importantEvents).toHaveLength(1);
    importantEvents[0].resolve('y');
    await expect(first).resolves.toEqual(expect.objectContaining({ approved: true }));
    await expect(promptDelegation('agent', (event: any) => importantEvents.push(event), false, undefined, false, importantCtx, 'implement tests')).resolves.toEqual(expect.objectContaining({ approved: true }));
    expect(importantEvents).toHaveLength(1);
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

  it('asks at the actual Goal side-effect boundary even when Goal itself was explicit', async () => {
    const events: any[] = [];
    const ctx = { cesar: { taskExecutionLease: createTaskExecutionLease('launch goal for finish task', true, '/repo') } } as any;
    const pending = promptDelegation('goal', (event: any) => events.push(event), false, undefined, false, ctx, 'finish task', {
      queue: '/outside/tasks', gate: 'npm test', push: true,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ type: 'question', prompt: expect.stringContaining('Approve goal') }));
    events[0].resolve('n');
    await expect(pending).resolves.toEqual(expect.objectContaining({ approved: false }));
  });
});
