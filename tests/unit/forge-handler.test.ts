import { beforeEach, describe, expect, it, vi } from 'vitest';

const runForgeMock = vi.fn();
const askQuestionMock = vi.fn();
const dispatchMock = vi.fn();
const setCurrentPlanMock = vi.fn();
const setActiveAbortMock = vi.fn();
const savePlanMock = vi.fn();
const createPlanMock = vi.fn();
const dispatchAgentMock = vi.fn();

vi.mock('@kernlang/agon-forge', () => ({
  runForge: (...args: any[]) => runForgeMock(...args),
}));

vi.mock('@kernlang/agon-core', async () => ({
  ensureAgonHome: vi.fn(),
  RUNS_DIR: '/tmp/agon-runs',
  appendMessage: vi.fn(),
  tracker: { record: vi.fn() },
  StreamParser: class {
    feed() { return []; }
    flush() { return []; }
  },
  createPlan: (...args: any[]) => createPlanMock(...args),
  approvePlan: (plan: any) => ({ ...plan, state: 'approved' }),
  startPlan: (plan: any) => ({ ...plan, state: 'running' }),
  mergeStepResult: (plan: any) => plan,
  cancelPlan: (plan: any) => ({ ...plan, state: 'cancelled' }),
  failPlan: (plan: any) => ({ ...plan, state: 'failed' }),
  savePlan: (...args: any[]) => savePlanMock(...args),
  scanProjectContext: vi.fn(() => ''),
  buildKernContextSpine: vi.fn(async () => ''),
  getActiveWorkspace: vi.fn(() => null),
  snapshotWorkspace: vi.fn(() => ({ id: 'cwd', path: '/repo', headSha: 'abc', branch: 'main', dirty: false })),
  resolveWorkingDir: vi.fn(() => '/repo'),
  loadOrCreateActiveThread: vi.fn(() => ({ append: vi.fn(), save: vi.fn() })),
  applyPatchWithUndo: vi.fn(() => ({ ok: true, undoToken: 'undo-test' })),
  formatChatHistoryForPrompt: vi.fn(() => ''),
  formatChatContextForPrompt: vi.fn(() => ''),
  updateChatSummary: vi.fn(() => false),
}));

vi.mock('../../packages/cli/src/generated/cesar/brain.js', () => ({
  cesarJudgeForge: vi.fn(async () => null),
  cesarConvergeForge: vi.fn(async () => null),
}));

vi.mock('../../packages/cli/src/generated/models/session-results.js', () => ({
  sessionResultStore: { add: vi.fn() },
}));

vi.mock('../../packages/cli/src/generated/handlers/agent.js', () => ({
  buildAgentApprovalCallback: vi.fn(() => undefined),
}));

describe('handleForge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPlanMock.mockReturnValue({
      id: 'plan-1',
      state: 'draft',
      steps: [
        { id: 'baseline', result: { state: 'pending' } },
        { id: 'dispatch', result: { state: 'pending' } },
        { id: 'score', result: { state: 'pending' } },
        { id: 'winner', result: { state: 'pending' } },
      ],
    });
    runForgeMock.mockResolvedValue({
      results: {
        codex: { pass: true, score: 91, diffLines: 12, filesChanged: 2, durationSec: 5 },
      },
      winner: 'codex',
      patches: { codex: '/tmp/winner.patch' },
    });
    dispatchAgentMock.mockResolvedValue({ stdout: 'done', diff: '', filesChanged: 0, diffLines: 0 });
  });

  it('skips the internal plan approval prompt when already approved upstream', async () => {
    const { handleForge } = await import('../../packages/cli/src/generated/handlers/forge.js');

    const ctx: any = {
      askQuestion: askQuestionMock,
      activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeEnableSynthesis: false },
      registry: { get: vi.fn(() => ({})) },
      adapter: {},
      currentPlan: null,
      setCurrentPlan: setCurrentPlanMock,
      setActiveAbort: setActiveAbortMock,
      chatSession: {},
      cesarSession: null,
    };

    await handleForge('fix login bug', 'npm test', dispatchMock, ctx, undefined, false, true);

    expect(askQuestionMock).not.toHaveBeenCalledWith('Approve plan? [Y/n]');
    expect(runForgeMock).toHaveBeenCalled();
  });

  it('uses Cesar to prepare missing forge fitness before falling back', async () => {
    const { handleForge } = await import('../../packages/cli/src/generated/handlers/forge.js');
    const adapterDispatchMock = vi.fn(async () => ({
      stdout: '{"fitnessCmd":"npm run test:ts -- tests/unit/intent.test.ts","reason":"focused parser regression"}',
    }));

    const ctx: any = {
      askQuestion: askQuestionMock,
      activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeEnableSynthesis: false, cesarEngine: 'codex', timeout: 90 },
      registry: { get: vi.fn(() => ({ id: 'codex' })) },
      adapter: { dispatch: adapterDispatchMock },
      currentPlan: null,
      setCurrentPlan: setCurrentPlanMock,
      setActiveAbort: setActiveAbortMock,
      chatSession: {},
      cesarSession: null,
    };

    await handleForge('forge a small CLI UX fix', null, dispatchMock, ctx, undefined, false, true);

    expect(adapterDispatchMock).toHaveBeenCalled();
    expect(runForgeMock).toHaveBeenCalledWith(expect.objectContaining({
      fitnessCmd: 'npm run test:ts -- tests/unit/intent.test.ts',
    }), expect.anything(), expect.anything(), expect.anything());
  });

  it('skips the internal build approval prompt when already approved upstream', async () => {
    const { handleBuild } = await import('../../packages/cli/src/generated/handlers/build.js');

    const ctx: any = {
      askQuestion: askQuestionMock,
      activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeFixedStarter: 'codex', agentTimeout: 60 },
      registry: {
        agentCapableIds: () => ['codex'],
        get: vi.fn(() => ({ timeout: 60 })),
      },
      adapter: { dispatchAgent: dispatchAgentMock },
      currentPlan: null,
      setCurrentPlan: setCurrentPlanMock,
      setActiveAbort: setActiveAbortMock,
      chatSession: { messages: [] },
    };

    await handleBuild('fix login bug', dispatchMock, ctx, undefined, true);

    expect(askQuestionMock).not.toHaveBeenCalledWith('Approve build plan? [Y/n]');
    expect(dispatchAgentMock).toHaveBeenCalled();
  });
});
