import { describe, expect, it, vi, beforeEach } from 'vitest';

import { getCoreWorkflowRegistry, compileWorkflowSpec, verifyWorkflowExecutionPlanFlow, appendWorkflowPhaseEvent as actualAppendWorkflowPhaseEvent } from '../../packages/core/src/index.js';

const { dispatchAgentMock, dispatchMock, readOnlyDiffMock, diffLineCountMock, diffFileCountMock, spawnWithTimeoutMock, appendWorkflowPhaseEventMock } = vi.hoisted(() => ({
  dispatchAgentMock: vi.fn(),
  dispatchMock: vi.fn(),
  readOnlyDiffMock: vi.fn(),
  diffLineCountMock: vi.fn(),
  diffFileCountMock: vi.fn(),
  spawnWithTimeoutMock: vi.fn(),
  appendWorkflowPhaseEventMock: vi.fn(),
}));

vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-core')>();
  return {
    ...actual,
    ensureAgonHome: vi.fn(),
    resolveWorkingDir: vi.fn().mockReturnValue('/tmp/project'),
    scanProjectContext: vi.fn().mockReturnValue(''),
    formatChatContextForPrompt: vi.fn().mockReturnValue(''),
    readOnlyDiff: readOnlyDiffMock,
    diffLineCount: diffLineCountMock,
    diffFileCount: diffFileCountMock,
    appendMessage: vi.fn(),
    tracker: { record: vi.fn() },
    spawnWithTimeout: spawnWithTimeoutMock,
    appendWorkflowPhaseEvent: appendWorkflowPhaseEventMock,
    RUNS_DIR: '/tmp/runs',
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, mkdirSync: vi.fn() };
});

import { handlePipeline } from '../../packages/cli/src/handlers/pipeline.js';

describe('workflow-pipeline-slash — agon.build-review-fix@v1 wiring', () => {
  beforeEach(() => {
    dispatchAgentMock.mockReset();
    dispatchMock.mockReset();
    readOnlyDiffMock.mockReset();
    diffLineCountMock.mockReset();
    diffFileCountMock.mockReset();
    spawnWithTimeoutMock.mockReset();
    spawnWithTimeoutMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    appendWorkflowPhaseEventMock.mockReset();
    appendWorkflowPhaseEventMock.mockImplementation((...args: Parameters<typeof actualAppendWorkflowPhaseEvent>) => actualAppendWorkflowPhaseEvent(...args));
  });

  it('certified agon.build-review-fix@v1 spec is resolvable', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.resolve('agon.build-review-fix@v1');
    expect(spec).toBeDefined();
    expect(spec!.id).toBe('agon.build-review-fix');
    expect(spec!.version).toBe('v1');
    expect(spec!.phases.map((p) => p.id)).toEqual(['build', 'review', 'fix']);
  });

  it('certified spec compiles without conformance errors', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.require('agon.build-review-fix@v1');
    expect(() => compileWorkflowSpec(spec)).not.toThrow();
  });

  it('compiled plan passes flow verification', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.require('agon.build-review-fix@v1');
    const plan = compileWorkflowSpec(spec);
    const issues = verifyWorkflowExecutionPlanFlow(plan);
    expect(issues).toHaveLength(0);
  });

  it('plan phases are ordered build → review → fix with correct dependencies', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.require('agon.build-review-fix@v1');
    const plan = compileWorkflowSpec(spec);
    expect(plan.phases).toHaveLength(3);
    expect(plan.phases[0].id).toBe('build');
    expect(plan.phases[0].dependsOn).toEqual([]);
    expect(plan.phases[1].id).toBe('review');
    expect(plan.phases[1].dependsOn).toEqual(['build']);
    expect(plan.phases[2].id).toBe('fix');
    expect(plan.phases[2].dependsOn).toEqual(['review']);
  });

  it('handlePipeline emits workflow-run-start with correct workflowId', async () => {
    readOnlyDiffMock.mockReturnValue(null);
    diffLineCountMock.mockReturnValue(0);
    diffFileCountMock.mockReturnValue(0);

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const ctx = {
      registry: {
        agentCapableIds: () => ['claude'],
        get: () => ({ id: 'claude', timeout: 60 }),
        resolveId: (id: string) => id,
      },
      config: {},
      adapter: {
        dispatch: dispatchMock.mockResolvedValue({ stdout: '' }),
      },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    } as any;

    await handlePipeline('fix the auth bug', dispatch, ctx);

    const runStart = events.find((e) => e.type === 'workflow-run-start');
    expect(runStart).toBeDefined();
    expect(runStart.workflowId).toBe('agon.build-review-fix');
    expect(typeof runStart.runId).toBe('string');
    expect(typeof runStart.planId).toBe('string');
  });

  it('handlePipeline emits workflow-phase-started for build phase', async () => {
    readOnlyDiffMock.mockReturnValue('diff --git a/foo.ts b/foo.ts\n+line');
    diffLineCountMock.mockReturnValue(1);
    diffFileCountMock.mockReturnValue(1);

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const ctx = {
      registry: {
        agentCapableIds: () => ['claude', 'kimi'],
        get: () => ({ id: 'claude', timeout: 60 }),
        resolveId: (id: string) => id,
      },
      config: {},
      adapter: {
        dispatch: dispatchMock.mockResolvedValue({ stdout: '[]' }),
      },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    } as any;

    await handlePipeline('add logging', dispatch, ctx, undefined, { quiet: true });

    const buildStarted = events.find((e) => e.type === 'workflow-phase-started' && e.phaseId === 'build');
    expect(buildStarted).toBeDefined();
    expect(buildStarted.workflowId).toBe('agon.build-review-fix');

    const buildCompleted = events.find((e) => e.type === 'workflow-phase-completed' && e.phaseId === 'build');
    expect(buildCompleted).toBeDefined();
  });

  it('handlePipeline emits workflow-run-completed at end', async () => {
    readOnlyDiffMock.mockReturnValue(null);
    diffLineCountMock.mockReturnValue(0);
    diffFileCountMock.mockReturnValue(0);

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const ctx = {
      registry: {
        agentCapableIds: () => ['claude'],
        get: () => ({ id: 'claude', timeout: 60 }),
        resolveId: (id: string) => id,
      },
      config: {},
      adapter: {
        dispatch: dispatchMock.mockResolvedValue({ stdout: '' }),
      },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    } as any;

    await handlePipeline('fix the auth bug', dispatch, ctx);

    const runCompleted = events.find((e) => e.type === 'workflow-run-completed');
    expect(runCompleted).toBeDefined();
    expect(runCompleted.workflowId).toBe('agon.build-review-fix');
    expect(runCompleted.status).toBe('completed');
  });

  it('handlePipeline closes the workflow run as failed when no build agent is available', async () => {
    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const ctx = {
      registry: {
        agentCapableIds: () => [],
        get: () => ({ id: 'claude', timeout: 60 }),
        resolveId: (id: string) => id,
      },
      config: {},
      adapter: {
        dispatch: dispatchMock.mockResolvedValue({ stdout: '' }),
      },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    } as any;

    await handlePipeline('fix the auth bug', dispatch, ctx);

    const runCompleted = events.find((e) => e.type === 'workflow-run-completed');
    expect(runCompleted).toBeDefined();
    expect(runCompleted.status).toBe('failed');
    expect(runCompleted.reason).toBe('no-agent-capable-engines');
  });

  it('handlePipeline emits phase failure and failed terminal status on build errors', async () => {
    readOnlyDiffMock.mockReturnValue(null);
    diffLineCountMock.mockReturnValue(0);
    diffFileCountMock.mockReturnValue(0);

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const ctx = {
      registry: {
        agentCapableIds: () => ['claude'],
        get: () => ({ id: 'claude', timeout: 60 }),
        resolveId: (id: string) => id,
      },
      config: {},
      adapter: {
        dispatch: dispatchMock.mockRejectedValue(new Error('builder exploded')),
      },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    } as any;

    await handlePipeline('fix the auth bug', dispatch, ctx);

    const phaseFailed = events.find((e) => e.type === 'workflow-phase-failed' && e.phaseId === 'build');
    expect(phaseFailed).toBeDefined();
    const runCompleted = events.find((e) => e.type === 'workflow-run-completed');
    expect(runCompleted).toBeDefined();
    expect(runCompleted.status).toBe('failed');
    expect(runCompleted.reason).toBe('build-failed');
  });

  it('does not contradict a completed workflow run by re-running a just-passed final fitness check', async () => {
    readOnlyDiffMock.mockReturnValue('diff --git a/foo.ts b/foo.ts\n+line');
    diffLineCountMock.mockReturnValue(1);
    diffFileCountMock.mockReturnValue(1);
    spawnWithTimeoutMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'late failure' });

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const ctx = {
      registry: {
        agentCapableIds: () => ['claude', 'kimi'],
        get: () => ({ id: 'claude', timeout: 60 }),
        resolveId: (id: string) => id,
      },
      config: {},
      adapter: {
        dispatch: dispatchMock.mockResolvedValue({ stdout: '[]' }),
      },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    } as any;

    await handlePipeline('add logging', dispatch, ctx, 'npm test', { quiet: true });

    expect(spawnWithTimeoutMock).toHaveBeenCalledTimes(1);
    const runCompleted = events.find((e) => e.type === 'workflow-run-completed');
    expect(runCompleted).toMatchObject({
      status: 'completed',
      reason: 'fitness-passed',
      workflowStatus: 'completed',
    });
    expect(events.some((e) => e.type === 'workflow-phase-failed')).toBe(false);
  });

  it('emits terminal workflow failure when phase tracking violates conformance', async () => {
    readOnlyDiffMock.mockReturnValue('diff --git a/foo.ts b/foo.ts\n+line');
    diffLineCountMock.mockReturnValue(1);
    diffFileCountMock.mockReturnValue(1);
    const conformanceError = Object.assign(new Error('phase cannot advance'), {
      issues: [{ code: 'invalid-phase', message: 'phase cannot advance', path: 'phaseId' }],
    });
    appendWorkflowPhaseEventMock.mockImplementationOnce(() => {
      throw conformanceError;
    });

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const ctx = {
      registry: {
        agentCapableIds: () => ['claude', 'kimi'],
        get: () => ({ id: 'claude', timeout: 60 }),
        resolveId: (id: string) => id,
      },
      config: {},
      adapter: {
        dispatch: dispatchMock.mockResolvedValue({ stdout: '[]' }),
      },
      chatSession: { messages: [] },
      setActiveAbort: vi.fn(),
    } as any;

    await expect(handlePipeline('add logging', dispatch, ctx, undefined, { quiet: true })).resolves.toBeUndefined();

    const conformanceFailed = events.find((e) => e.type === 'workflow-run-conformance-failed');
    expect(conformanceFailed).toBeDefined();
    expect(conformanceFailed.issues).toEqual(conformanceError.issues);
    const runCompleted = events.find((e) => e.type === 'workflow-run-completed');
    expect(runCompleted).toMatchObject({
      status: 'failed',
      reason: 'workflow-conformance-failed',
      workflowStatus: 'failed',
    });
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'success')).toBe(false);
  });
});
