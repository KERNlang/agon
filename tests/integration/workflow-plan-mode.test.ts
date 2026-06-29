import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getCoreWorkflowRegistry, compileWorkflowSpec, verifyWorkflowExecutionPlanFlow, appendWorkflowPhaseEvent as actualAppendWorkflowPhaseEvent } from '../../packages/core/src/index.js';

const { handleCesarBrainMock, runDelegateMock, runForgeMock, runBrainstormMock, runTribunalMock, appendWorkflowPhaseEventMock } = vi.hoisted(() => ({
  handleCesarBrainMock: vi.fn(),
  runDelegateMock: vi.fn(),
  runForgeMock: vi.fn(),
  runBrainstormMock: vi.fn(),
  runTribunalMock: vi.fn(),
  appendWorkflowPhaseEventMock: vi.fn(),
}));

vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-core')>();
  return {
    ...actual,
    appendWorkflowPhaseEvent: appendWorkflowPhaseEventMock,
  };
});

vi.mock('../../packages/cli/src/generated/cesar/brain.js', () => ({
  handleCesarBrain: handleCesarBrainMock,
}));

vi.mock('@kernlang/agon-forge', () => ({
  runForge: runForgeMock,
  runBrainstorm: runBrainstormMock,
  runTribunal: runTribunalMock,
  runCampfire: vi.fn(),
  runDelegate: runDelegateMock,
}));

import { buildStepExecutors } from '../../packages/cli/src/generated/handlers/plan-mode.js';

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    registry: {},
    adapter: {},
    activeEngines: () => ['claude'],
    config: {},
    chatSession: { messages: [] },
    currentPlan: null,
    setCurrentPlan: () => {},
    setActiveAbort: () => {},
    askQuestion: async () => '',
    cesarSession: null,
    setCesarSession: () => {},
    explorationMode: false,
    setExplorationMode: () => {},
    neroMode: false,
    setNeroMode: () => {},
    cesarMemory: {},
    cesar: {},
    ...overrides,
  } as any;
}

describe('workflow-plan-mode — agon.brainstorm-forge-tribunal@v1 wiring', () => {
  let originalAgonHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    originalAgonHome = process.env.AGON_HOME;
    tempHome = mkdtempSync(join(tmpdir(), 'agon-workflow-plan-'));
    process.env.AGON_HOME = tempHome;
    handleCesarBrainMock.mockReset();
    runDelegateMock.mockReset();
    runForgeMock.mockReset();
    runBrainstormMock.mockReset();
    runTribunalMock.mockReset();
    appendWorkflowPhaseEventMock.mockReset();
    appendWorkflowPhaseEventMock.mockImplementation((...args: Parameters<typeof actualAppendWorkflowPhaseEvent>) => actualAppendWorkflowPhaseEvent(...args));
  });

  afterEach(() => {
    if (originalAgonHome === undefined) {
      delete process.env.AGON_HOME;
    } else {
      process.env.AGON_HOME = originalAgonHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('certified agon.brainstorm-forge-tribunal@v1 is resolvable via core registry', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.resolve('agon.brainstorm-forge-tribunal@v1');
    expect(spec).toBeDefined();
    expect(spec!.id).toBe('agon.brainstorm-forge-tribunal');
    expect(spec!.version).toBe('v1');
  });

  it('certified spec compiles and flow-verifies without issues', () => {
    const registry = getCoreWorkflowRegistry();
    const spec = registry.require('agon.brainstorm-forge-tribunal@v1');
    const plan = compileWorkflowSpec(spec);
    const issues = verifyWorkflowExecutionPlanFlow(plan);
    expect(issues).toHaveLength(0);
  });

  it('plan-mode pipeline step emits workflow-run-start before executing', async () => {
    runBrainstormMock.mockResolvedValue({ response: 'approach X' });
    runForgeMock.mockResolvedValue({
      winner: 'claude',
      baselinePasses: false,
      results: {
        claude: {
          engineId: 'claude',
          pass: true,
          score: 90,
          diffLines: 5,
          filesChanged: 1,
          durationSec: 10,
          lintWarnings: 0,
          styleScore: 95,
          dispatchStdout: 'done',
        },
      },
    });
    runTribunalMock.mockResolvedValue({ summary: 'Looks good', rounds: [] });

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const executors = buildStepExecutors(makeCtx(), dispatch);

    await executors.pipeline.execute(
      {
        id: 'pipe-step',
        type: 'pipeline',
        description: 'build the auth service',
        fitnessCmd: 'npm test',
        state: 'pending',
      } as any,
      {},
    );

    const runStart = events.find((e) => e.type === 'workflow-run-start');
    expect(runStart).toBeDefined();
    expect(runStart.workflowId).toBe('agon.brainstorm-forge-tribunal');
    expect(typeof runStart.runId).toBe('string');
    expect(typeof runStart.planId).toBe('string');
  });

  it('plan-mode pipeline step emits phase events for brainstorm, forge, tribunal', async () => {
    runBrainstormMock.mockResolvedValue({ response: 'approach X' });
    runForgeMock.mockResolvedValue({
      winner: 'claude',
      baselinePasses: false,
      results: {
        claude: {
          engineId: 'claude',
          pass: true,
          score: 90,
          diffLines: 5,
          filesChanged: 1,
          durationSec: 10,
          lintWarnings: 0,
          styleScore: 95,
          dispatchStdout: 'done',
        },
      },
    });
    runTribunalMock.mockResolvedValue({ summary: 'Approved', rounds: [] });

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const executors = buildStepExecutors(makeCtx(), dispatch);

    await executors.pipeline.execute(
      {
        id: 'pipe-step',
        type: 'pipeline',
        description: 'build auth',
        fitnessCmd: 'npm test',
        state: 'pending',
      } as any,
      {},
    );

    const phaseEvents = events.filter((e) => e.type === 'workflow-phase-started' || e.type === 'workflow-phase-completed');
    const phaseIds = phaseEvents.map((e) => `${e.type}:${e.phaseId}`);
    expect(phaseIds).toContain('workflow-phase-started:brainstorm');
    expect(phaseIds).toContain('workflow-phase-completed:brainstorm');
    expect(phaseIds).toContain('workflow-phase-started:forge');
    expect(phaseIds).toContain('workflow-phase-completed:forge');
    expect(phaseIds).toContain('workflow-phase-started:tribunal');
    expect(phaseIds).toContain('workflow-phase-completed:tribunal');
  });

  it('plan-mode pipeline step result output contains workflow id when successful', async () => {
    runBrainstormMock.mockResolvedValue({ response: 'use redis' });
    runForgeMock.mockResolvedValue({
      winner: 'codex',
      baselinePasses: false,
      results: {
        codex: {
          engineId: 'codex',
          pass: true,
          score: 88,
          diffLines: 10,
          filesChanged: 2,
          durationSec: 15,
          lintWarnings: 0,
          styleScore: 90,
          dispatchStdout: 'shipped',
        },
      },
    });
    runTribunalMock.mockResolvedValue({ summary: 'Ship it', rounds: [] });

    const executors = buildStepExecutors(makeCtx(), () => {});
    const result = await executors.pipeline.execute(
      {
        id: 'pipe-step',
        type: 'pipeline',
        description: 'add caching layer',
        fitnessCmd: 'npm test',
        state: 'pending',
      } as any,
      {},
    );

    expect(result.result.status).toBe('success');
    expect(result.result.output).toContain('agon.brainstorm-forge-tribunal');
  });

  it('plan-mode pipeline step emits workflow-run-completed', async () => {
    runBrainstormMock.mockResolvedValue({ response: 'plan' });
    runForgeMock.mockResolvedValue({
      winner: 'claude',
      baselinePasses: false,
      results: {
        claude: { engineId: 'claude', pass: true, score: 80, diffLines: 3, filesChanged: 1, durationSec: 5, lintWarnings: 0, styleScore: 85, dispatchStdout: 'ok' },
      },
    });
    runTribunalMock.mockResolvedValue({ summary: 'OK', rounds: [] });

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const executors = buildStepExecutors(makeCtx(), dispatch);

    await executors.pipeline.execute(
      { id: 'ps', type: 'pipeline', description: 'task', fitnessCmd: 'true', state: 'pending' } as any,
      {},
    );

    const runDone = events.find((e) => e.type === 'workflow-run-completed');
    expect(runDone).toBeDefined();
    expect(runDone.workflowId).toBe('agon.brainstorm-forge-tribunal');
    expect(runDone.status).toBe('completed');
  });

  it('plan-mode pipeline step emits phase failure and failed run status on exceptions', async () => {
    runBrainstormMock.mockRejectedValue(new Error('brainstorm failed'));

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const executors = buildStepExecutors(makeCtx(), dispatch);

    const result = await executors.pipeline.execute(
      { id: 'ps', type: 'pipeline', description: 'task', fitnessCmd: 'true', state: 'pending' } as any,
      {},
    );

    expect(result.result.status).toBe('failure');
    const phaseFailed = events.find((e) => e.type === 'workflow-phase-failed' && e.phaseId === 'brainstorm');
    expect(phaseFailed).toBeDefined();
    const runDone = events.find((e) => e.type === 'workflow-run-completed');
    expect(runDone).toBeDefined();
    expect(runDone.status).toBe('failed');
  });

  it('plan-mode pipeline step marks the run failed when forge produces no winner', async () => {
    runBrainstormMock.mockResolvedValue({ response: 'plan' });
    runForgeMock.mockResolvedValue({
      winner: null,
      baselinePasses: false,
      results: {},
    });

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const executors = buildStepExecutors(makeCtx(), dispatch);

    const result = await executors.pipeline.execute(
      { id: 'ps', type: 'pipeline', description: 'task', fitnessCmd: 'true', state: 'pending' } as any,
      {},
    );

    expect(result.result.status).toBe('failure');
    const phaseFailed = events.find((e) => e.type === 'workflow-phase-failed' && e.phaseId === 'forge');
    expect(phaseFailed).toBeDefined();
    const runDone = events.find((e) => e.type === 'workflow-run-completed');
    expect(runDone).toBeDefined();
    expect(runDone.status).toBe('failed');
    expect(runDone.reason).toBe('forge-produced-no-winner');
  });

  it('plan-mode pipeline closes the workflow run when phase tracking violates conformance', async () => {
    const conformanceError = Object.assign(new Error('phase tracking failed'), {
      issues: [{ code: 'invalid-phase', message: 'phase tracking failed', path: 'phaseId' }],
    });
    appendWorkflowPhaseEventMock.mockImplementationOnce(() => {
      throw conformanceError;
    });

    const events: any[] = [];
    const dispatch = (event: any) => events.push(event);
    const executors = buildStepExecutors(makeCtx(), dispatch);

    const result = await executors.pipeline.execute(
      { id: 'ps', type: 'pipeline', description: 'task', fitnessCmd: 'true', state: 'pending' } as any,
      {},
    );

    expect(result.result.status).toBe('failure');
    expect(result.result.error).toBe('workflow-conformance-failed');
    expect(runBrainstormMock).not.toHaveBeenCalled();
    const conformanceFailed = events.find((e) => e.type === 'workflow-run-conformance-failed');
    expect(conformanceFailed).toBeDefined();
    expect(conformanceFailed.issues).toEqual(conformanceError.issues);
    const runDone = events.find((e) => e.type === 'workflow-run-completed');
    expect(runDone).toMatchObject({
      status: 'failed',
      reason: 'workflow-conformance-failed',
      workflowStatus: 'failed',
    });
  });
});
