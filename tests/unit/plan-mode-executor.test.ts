import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { handleCesarBrainMock, runDelegateMock, runForgeMock } = vi.hoisted(() => ({
  handleCesarBrainMock: vi.fn(),
  runDelegateMock: vi.fn(),
  runForgeMock: vi.fn(),
}));

vi.mock('../../packages/cli/src/generated/cesar/brain.js', () => ({
  handleCesarBrain: handleCesarBrainMock,
}));

vi.mock('@kernlang/agon-forge', () => ({
  runForge: runForgeMock,
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
  let originalAgonHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    originalAgonHome = process.env.AGON_HOME;
    tempHome = mkdtempSync(join(tmpdir(), 'agon-plan-mode-'));
    process.env.AGON_HOME = tempHome;
    handleCesarBrainMock.mockReset();
    runDelegateMock.mockReset();
    runForgeMock.mockReset();
  });

  afterEach(() => {
    if (originalAgonHome === undefined) {
      delete process.env.AGON_HOME;
    } else {
      process.env.AGON_HOME = originalAgonHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
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

  it('uses active engines and streams progress for plan forge steps without explicit engines', async () => {
    const events: any[] = [];
    runForgeMock.mockImplementation(async (options: any, _registry: any, _adapter: any, onEvent?: (event: any) => void) => {
      expect(options.engines).toEqual(['claude', 'gemini', 'kimi']);
      expect(existsSync(options.forgeDir)).toBe(true);
      onEvent?.({ type: 'stage1:dispatch', engineId: 'gemini' });
      onEvent?.({ type: 'engine:worktree', engineId: 'gemini', data: { engineId: 'gemini', worktreePath: `${options.forgeDir}/wt-gemini`, phase: 'stage1' } });
      onEvent?.({ type: 'stage1:score', engineId: 'gemini', data: { score: 91 } });
      return { winner: null, results: {} };
    });

    const executors = buildStepExecutors(makeCtx({ activeEngines: () => ['claude', 'gemini', 'kimi'] }), (event: any) => events.push(event));
    const result = await executors.forge.execute({
      id: 'forge-step',
      type: 'forge',
      description: 'build a status dashboard',
      fitnessCmd: 'npm test',
      state: 'pending',
    } as any, {});

    expect(runForgeMock).toHaveBeenCalledOnce();
    expect(result.result.status).toBe('failure');
    expect(events.some((event) => event.type === 'info' && String(event.message).includes('claude, gemini, kimi'))).toBe(true);
    expect(events.some((event) => event.type === 'info' && String(event.message).includes('Forge run dir:'))).toBe(true);
    expect(events.some((event) => event.type === 'info' && String(event.message).includes('Forge worktree gemini:'))).toBe(true);
    const firstProgress = events.find((event) => event.type === 'progress-update');
    expect(firstProgress?.engines.every((engine: any) => engine.status === 'preparing')).toBe(true);
    expect(events.some((event) => event.type === 'progress-update' && event.engines?.some((engine: any) => engine.id === 'gemini' && engine.done === true && engine.score === '91'))).toBe(true);
    expect(events.some((event) => event.type === 'progress-clear')).toBe(true);
  });

  it('treats a baseline-passing no-op forge result as an already satisfied plan step', async () => {
    runForgeMock.mockResolvedValue({
      winner: null,
      baselinePasses: true,
      results: {
        codex: {
          engineId: 'codex',
          pass: false,
          score: 0,
          diffLines: 0,
          filesChanged: 0,
          durationSec: 12,
          lintWarnings: 0,
          styleScore: 100,
          fitnessLogPath: '/tmp/codex-fitness.txt',
          dispatchStdout: 'Already implemented; no edits needed.',
        },
        kimi: {
          engineId: 'kimi',
          pass: false,
          score: 0,
          diffLines: 0,
          filesChanged: 0,
          durationSec: 12,
          lintWarnings: 0,
          styleScore: 100,
          fitnessLogPath: '/tmp/kimi-fitness.txt',
          dispatchStdout: '',
        },
      },
    });

    const executors = buildStepExecutors(makeCtx({ activeEngines: () => ['codex', 'kimi'] }), () => {});
    const result = await executors.forge.execute({
      id: 'forge-step',
      type: 'forge',
      description: 'build telemetry service',
      fitnessCmd: 'npm test',
      state: 'pending',
    } as any, {});

    expect(result.result.status).toBe('success');
    expect(result.result.output).toContain('Already satisfied');
    expect(result.contextExport).toContain('already satisfied');
  });

  it('does not treat dispatch crashes as already satisfied no-op forge results', async () => {
    runForgeMock.mockResolvedValue({
      winner: null,
      baselinePasses: true,
      results: {
        claude: {
          engineId: 'claude',
          pass: false,
          score: 0,
          diffLines: 0,
          filesChanged: 0,
          durationSec: 0,
          lintWarnings: 0,
          styleScore: 0,
          dispatchStdout: 'ERROR: dispatch timed out',
        },
      },
    });

    const executors = buildStepExecutors(makeCtx({ activeEngines: () => ['claude'] }), () => {});
    const result = await executors.forge.execute({
      id: 'forge-step',
      type: 'forge',
      description: 'build telemetry service',
      fitnessCmd: 'npm test',
      state: 'pending',
    } as any, {});

    expect(result.result.status).toBe('failure');
    expect(result.result.error).toBe('No winner');
  });
});
