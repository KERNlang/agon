import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleCesarBrainMock, runDelegateMock } = vi.hoisted(() => ({
  handleCesarBrainMock: vi.fn(),
  runDelegateMock: vi.fn(),
}));

vi.mock('../../packages/cli/src/generated/cesar/brain.js', () => ({
  handleCesarBrain: handleCesarBrainMock,
}));

vi.mock('@agon/forge', () => ({
  runForge: vi.fn(),
  runBrainstorm: vi.fn(),
  runTribunal: vi.fn(),
  runCampfire: vi.fn(),
  runDelegate: runDelegateMock,
}));

import { buildStepExecutors } from '../../packages/cli/src/generated/handlers/plan-mode.js';

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    registry: {},
    adapter: {},
    activeEngines: () => ['cesar'],
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

const selfStep = {
  id: 's1',
  type: 'self',
  description: 'inspect and edit the dashboard',
  estimatedTokens: 1000,
  estimatedCostUsd: 0.01,
  state: 'pending',
} as any;

describe('plan-mode self executor', () => {
  beforeEach(() => {
    handleCesarBrainMock.mockReset();
    runDelegateMock.mockReset();
  });

  it('executes self steps through Cesar brain when live dispatch is available', async () => {
    const events: any[] = [];
    handleCesarBrainMock.mockImplementation(async (prompt: string, dispatch: (event: any) => void) => {
      expect(prompt).toContain('[APPROVED PLAN STEP]');
      expect(prompt).toContain('Do not call ProposePlan');
      expect(prompt).toContain('Use the available tools directly');
      dispatch({ type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'file content' });
      dispatch({ type: 'engine-block', engineId: 'cesar', content: 'updated the dashboard' });
      return { delegated: false, responded: true, decisionReason: 'self-executed' };
    });

    const executors = buildStepExecutors(makeCtx(), (event: any) => events.push(event));
    const result = await executors.self.execute(selfStep, {});

    expect(handleCesarBrainMock).toHaveBeenCalledOnce();
    expect(runDelegateMock).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'tool-call' && event.tool === 'Read')).toBe(true);
    expect(result.result.status).toBe('success');
    expect(result.result.output).toContain('[tool:Read:done]');
    expect(result.result.output).toContain('updated the dashboard');
  });

  it('falls back to delegate dispatch when no live dispatch exists', async () => {
    runDelegateMock.mockResolvedValue({ response: 'delegate response' });

    const executors = buildStepExecutors(makeCtx({ cesar: undefined }));
    const result = await executors.self.execute(selfStep, {});

    expect(handleCesarBrainMock).not.toHaveBeenCalled();
    expect(runDelegateMock).toHaveBeenCalledOnce();
    expect(result.result.status).toBe('success');
    expect(result.result.output).toBe('delegate response');
  });
});
