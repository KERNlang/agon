import { describe, expect, it } from 'vitest';
import {
  approveTaskAction,
  authorizeTaskAction,
  buildTaskActionTarget,
  claimTaskActionPrompt,
  createTaskExecutionLease,
  evaluateTaskAction,
  isTaskFileMutationAction,
  isApprovedPermissionResponse,
  taskExplicitlyAuthorizes,
  taskExplicitlyRequestsAction,
} from '../../packages/cli/src/generated/cesar/task-execution-lease.js';

describe('Cesar task execution lease', () => {
  it('treats explicitly naming Goal or Conquer as the authority boundary despite target paraphrasing', () => {
    const conquer = createTaskExecutionLease('use conquer to fix the recap', true, '/repo');
    expect(taskExplicitlyRequestsAction(conquer, 'conquer')).toBe(true);
    expect(taskExplicitlyAuthorizes(conquer, 'conquer', 'repair this terminal summary cleanly')).toBe(false);

    const implicit = createTaskExecutionLease('fix the recap automatically', true, '/repo');
    expect(taskExplicitlyAuthorizes(implicit, 'conquer', 'fix the recap')).toBe(false);
  });

  it('binds delegation side effects into the authority target', () => {
    const lease = createTaskExecutionLease('launch goal for finish task', true, '/repo');
    const target = buildTaskActionTarget(lease, 'finish task', {
      queue: '/outside/tasks', gate: 'npm test', push: true, pr: true,
    });
    expect(target).toContain('external queue /outside/tasks');
    expect(target).toContain('gate npm test');
    expect(target).toContain('push');
    expect(target).toContain('pull request');
    expect(evaluateTaskAction(lease, 'goal', target).decision).toBe('ask_boundary_once');
  });

  it('inherits dangerous side effects across execution delegation actions', () => {
    const lease = createTaskExecutionLease('fix the recap automatically', true, '/repo');
    for (const action of ['Forge', 'Agent', 'Pipeline']) {
      expect(evaluateTaskAction(lease, action, 'fix recap\npush\npull request').decision).toBe('ask_boundary_once');
      expect(evaluateTaskAction(lease, action, 'fix recap\nexternal queue /outside/tasks').decision).toBe('ask_boundary_once');
    }
    // A source filename alone must not turn an ordinary edit into a dangerous boundary.
    expect(evaluateTaskAction(lease, 'Edit', '/repo/release.ts').decision).toBe('allow');
  });

  it('allows a routine AUTO implementation without per-tool prompts', () => {
    const lease = createTaskExecutionLease('fix the recap and run tests', true, '/repo');
    for (const [action, target] of [['Edit', '/repo/a.ts'], ['Write', '/repo/b.ts'], ['Bash', 'npm test'], ['Forge', 'recap fix']] as const) {
      expect(evaluateTaskAction(lease, action, target)).toEqual({ decision: 'allow', signature: expect.any(String), reason: 'routine_auto' });
    }
  });

  it('asks once for an important task and then covers matching task work', () => {
    const lease = createTaskExecutionLease('change the auth session contract', true, '/repo');
    const first = evaluateTaskAction(lease, 'Edit', '/repo/auth.ts');
    expect(first.decision).toBe('ask_task_once');
    expect(claimTaskActionPrompt(lease, first.signature)).toBe(true);
    expect(claimTaskActionPrompt(lease, first.signature)).toBe(false);
    approveTaskAction(lease, 'Edit', '/repo/auth.ts');
    expect(evaluateTaskAction(lease, 'Write', '/repo/auth.test.ts').decision).toBe('allow');
  });

  it('joins concurrent duplicate approval requests to one user decision', async () => {
    const lease = createTaskExecutionLease('change the auth session contract', true, '/repo');
    let resolveApproval!: (approved: boolean) => void;
    let prompts = 0;
    const requestApproval = () => {
      prompts += 1;
      return new Promise<boolean>((resolve) => { resolveApproval = resolve; });
    };

    const first = authorizeTaskAction(lease, 'Edit', '/repo/auth.ts', requestApproval);
    const duplicate = authorizeTaskAction(lease, 'Edit', '/repo/auth.ts', requestApproval);
    resolveApproval(true);

    await expect(first).resolves.toMatchObject({ decision: 'allow' });
    await expect(duplicate).resolves.toMatchObject({ decision: 'allow' });
    expect(prompts).toBe(1);
  });

  it('requires a dangerous boundary once unless action and target were explicit', () => {
    const implicit = createTaskExecutionLease('finish the release work', true, '/repo');
    expect(evaluateTaskAction(implicit, 'Edit', '/repo/release.ts').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(implicit, 'Forge', 'finish the implementation').decision).toBe('ask_boundary_once');
    expect(evaluateTaskAction(implicit, 'push', 'origin feature/x').decision).toBe('ask_boundary_once');
    approveTaskAction(implicit, 'push', 'origin feature/x');
    expect(evaluateTaskAction(implicit, 'push', 'origin feature/x').decision).toBe('allow');
    expect(evaluateTaskAction(implicit, 'push', 'origin main').decision).toBe('ask_boundary_once');

    const explicit = createTaskExecutionLease('push branch feature/x to origin', true, '/repo');
    expect(evaluateTaskAction(explicit, 'push', 'origin feature/x').decision).toBe('allow');
  });

  it('keeps hard deny floors and workspace escape closed in AUTO', () => {
    const lease = createTaskExecutionLease('do everything automatically', true, '/repo');
    expect(evaluateTaskAction(lease, 'Bash', 'rm -rf /', { hardDeny: true }).decision).toBe('deny');
    expect(evaluateTaskAction(lease, 'Write', '/outside/secrets.txt').decision).toBe('deny');
    expect(evaluateTaskAction(lease, 'Edit', '../outside/secrets.txt').decision).toBe('deny');
    expect(evaluateTaskAction(lease, 'NotebookEdit', '../outside/notebook.ipynb').decision).toBe('deny');
  });

  it('recognizes native and mapped file-mutation aliases', () => {
    for (const action of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'AgonEdit', 'AgonWrite', 'AgonMultiEdit']) {
      expect(isTaskFileMutationAction(action)).toBe(true);
    }
    expect(isTaskFileMutationAction('Read')).toBe(false);
  });

  it('normalizes REPL permission answers before the core gate sees them', () => {
    expect(isApprovedPermissionResponse('y')).toBe(true);
    expect(isApprovedPermissionResponse('a')).toBe(true);
    expect(isApprovedPermissionResponse(true)).toBe(true);
    expect(isApprovedPermissionResponse('n')).toBe(false);
    expect(isApprovedPermissionResponse(false)).toBe(false);
  });

  it('falls back to approval when AUTO is off', () => {
    const lease = createTaskExecutionLease('fix the recap', false, '/repo');
    expect(evaluateTaskAction(lease, 'Edit', '/repo/a.ts').decision).toBe('ask_boundary_once');
  });
});
