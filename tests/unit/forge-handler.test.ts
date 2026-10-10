import { beforeEach, describe, expect, it, vi } from 'vitest';

const runForgeMock = vi.fn();
const askQuestionMock = vi.fn();
const dispatchMock = vi.fn();
const setCurrentPlanMock = vi.fn();
const setActiveAbortMock = vi.fn();
const savePlanMock = vi.fn();
const createPlanMock = vi.fn();
const dispatchAgentMock = vi.fn();
const dispatchAgentStreamMock = vi.fn();
const judgeMock = vi.fn();
const convergeMock = vi.fn();

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
  // With no matching bookmark (getActiveWorkspace → null), handleForge now
  // snapshots the grounded cwd directly via snapshotPath.
  snapshotPath: vi.fn(() => ({ id: 'cwd', path: '/repo', headSha: 'abc', branch: 'main', dirty: false })),
  resolveWorkingDir: vi.fn(() => '/repo'),
  loadOrCreateActiveThread: vi.fn(() => ({ append: vi.fn(), save: vi.fn() })),
  applyPatchWithUndo: vi.fn(() => ({ ok: true, undoToken: 'undo-test' })),
  formatChatHistoryForPrompt: vi.fn(() => ''),
  formatChatContextForPrompt: vi.fn(() => ''),
  updateChatSummary: vi.fn(() => false),
}));

vi.mock('../../packages/cli/src/cesar/brain.js', () => ({
  cesarJudgeForge: vi.fn(async () => null),
  cesarConvergeForge: vi.fn(async () => null),
}));

vi.mock('../../packages/cli/src/handlers/cesar-brain.js', () => ({
  cesarJudgeForge: (...args: any[]) => judgeMock(...args),
  cesarConvergeForge: (...args: any[]) => convergeMock(...args),
  cesarReviewForgeOutcome: vi.fn(),
}));

vi.mock('../../packages/cli/src/models/session-results.js', () => ({
  sessionResultStore: { add: vi.fn() },
}));

vi.mock('../../packages/cli/src/handlers/agent.js', () => ({
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
    const { handleForge } = await import('../../packages/cli/src/handlers/forge.js');

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

  it.each(['', ' ', 'no', 'cancel', 'yikes', 'yes please'])('refuses build and forge execution for %j', async answer => {
    const { handleForge } = await import('../../packages/cli/src/handlers/forge.js');
    const { handleBuild } = await import('../../packages/cli/src/handlers/build.js');
    askQuestionMock.mockResolvedValue(answer);
    const ctx: any = {
      askQuestion: askQuestionMock, activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeEnableSynthesis: false, forgeFixedStarter: 'codex' },
      registry: { get: vi.fn(() => ({ timeout: 60 })), agentCapableIds: () => ['codex'] },
      adapter: { dispatchAgent: dispatchAgentMock }, currentPlan: null,
      setCurrentPlan: setCurrentPlanMock, setActiveAbort: setActiveAbortMock,
      chatSession: { messages: [] }, cesarSession: null,
    };
    await handleBuild('fix fixture', dispatchMock, ctx);
    await handleForge('fix fixture', 'npm test', dispatchMock, ctx);
    expect(askQuestionMock).toHaveBeenCalledTimes(2);
    expect(dispatchAgentMock).not.toHaveBeenCalled();
    expect(runForgeMock).not.toHaveBeenCalled();
    if (!answer.trim()) {
      expect(savePlanMock).toHaveBeenCalledTimes(2);
      expect(savePlanMock.mock.calls.every(([plan]) => plan.state === 'draft')).toBe(true);
      expect(setCurrentPlanMock.mock.calls.every(([plan]) => plan.state === 'draft')).toBe(true);
    } else {
      expect(savePlanMock).toHaveBeenCalledTimes(2);
      expect(savePlanMock.mock.calls.every(([plan]) => plan.state === 'cancelled')).toBe(true);
    }
  });

  it.each(['y', ' YES '])('accepts explicit build and forge approval %j', async answer => {
    const { handleForge } = await import('../../packages/cli/src/handlers/forge.js');
    const { handleBuild } = await import('../../packages/cli/src/handlers/build.js');
    askQuestionMock.mockResolvedValue(answer);
    const ctx: any = {
      askQuestion: askQuestionMock, activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeEnableSynthesis: false, forgeFixedStarter: 'codex' },
      registry: { get: vi.fn(() => ({ timeout: 60 })), agentCapableIds: () => ['codex'] },
      adapter: { dispatchAgent: dispatchAgentMock }, currentPlan: null,
      setCurrentPlan: setCurrentPlanMock, setActiveAbort: setActiveAbortMock,
      chatSession: { messages: [] }, cesarSession: null,
    };
    await handleBuild('fix fixture', dispatchMock, ctx);
    await handleForge('fix fixture', 'npm test', dispatchMock, ctx);
    expect(dispatchAgentMock).toHaveBeenCalledOnce();
    expect(runForgeMock).toHaveBeenCalledOnce();
  });

  it.each(['build', 'forge'].flatMap(kind => ['', 'y', 'n'].flatMap(answer =>
    ['cancel', 'replace', 'mutate'].map(change => [kind, answer, change]))))(
    'does not revive a stale %s draft after answer %j and %s', async (kind, answer, change) => {
    const { handleBuild } = await import('../../packages/cli/src/handlers/build.js');
    const { handleForge } = await import('../../packages/cli/src/handlers/forge.js');
    let showQuestion!: () => void;
    let answerQuestion!: (value: string) => void;
    const shown = new Promise<void>(resolve => { showQuestion = resolve; });
    const pendingAnswer = new Promise<string>(resolve => { answerQuestion = resolve; });
    askQuestionMock.mockImplementation(() => { showQuestion(); return pendingAnswer; });
    const ctx: any = {
      askQuestion: askQuestionMock, activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeEnableSynthesis: false, forgeFixedStarter: 'codex' },
      registry: { get: vi.fn(() => ({ timeout: 60 })), agentCapableIds: () => ['codex'] },
      adapter: { dispatchAgent: dispatchAgentMock }, currentPlan: null,
      setCurrentPlan: (plan: unknown) => { ctx.currentPlan = plan; },
      setActiveAbort: setActiveAbortMock, chatSession: { messages: [] }, cesarSession: null,
    };
    const pending = kind === 'build'
      ? handleBuild('fixture', dispatchMock, ctx)
      : handleForge('fixture', 'npm test', dispatchMock, ctx);
    await shown;
    const changed = change === 'mutate' ? ctx.currentPlan : { ...ctx.currentPlan };
    if (change === 'replace') changed.id = 'replacement-draft';
    else changed.state = 'cancelled';
    ctx.currentPlan = changed;
    answerQuestion(answer);
    await pending;
    expect(ctx.currentPlan).toBe(changed);
    expect(savePlanMock).not.toHaveBeenCalled();
    expect(dispatchAgentMock).not.toHaveBeenCalled();
    expect(runForgeMock).not.toHaveBeenCalled();
  });

  it.each(['auto', 'upstream', 'existing'])('preserves the %s approval route', async route => {
    const { handleForge } = await import('../../packages/cli/src/handlers/forge.js');
    const { handleBuild } = await import('../../packages/cli/src/handlers/build.js');
    askQuestionMock.mockImplementation(() => { throw new Error('Unexpected approval question'); });
    const ctx: any = {
      askQuestion: askQuestionMock, activeEngines: () => ['codex'],
      config: { approvalLevel: route === 'auto' ? 'auto' : 'plan', forgeEnableSynthesis: false, forgeFixedStarter: 'codex' },
      registry: { get: vi.fn(() => ({ timeout: 60 })), agentCapableIds: () => ['codex'] },
      adapter: { dispatchAgent: dispatchAgentMock }, currentPlan: null,
      setCurrentPlan: setCurrentPlanMock, setActiveAbort: setActiveAbortMock,
      chatSession: { messages: [] }, cesarSession: null,
    };
    const existing = route === 'existing' ? { ...createPlanMock(), state: 'approved' } : undefined;
    await handleBuild('fixture', dispatchMock, ctx, existing, route === 'upstream');
    await handleForge('fixture', 'npm test', dispatchMock, ctx, existing, false, route === 'upstream');
    expect(askQuestionMock).not.toHaveBeenCalled();
    expect(dispatchAgentMock).toHaveBeenCalledOnce();
    expect(runForgeMock).toHaveBeenCalledOnce();
  });

  it.each(['', 'no', 'cancel', 'yes please', 'y', ' YES '])('requires explicit convergence approval %j', async answer => {
    const { handleForge } = await import('../../packages/cli/src/handlers/forge.js');
    askQuestionMock.mockResolvedValue(answer);
    judgeMock.mockResolvedValue({ winner: 'codex', shouldConverge: true, convergencePlan: ['fixture'] });
    convergeMock.mockResolvedValue(null);
    runForgeMock.mockResolvedValue({ results: { codex: { pass: true }, fixture: { pass: true } }, winner: 'codex', patches: {} });
    const ctx: any = {
      askQuestion: askQuestionMock, activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeEnableSynthesis: false },
      registry: { get: vi.fn(() => ({})) }, adapter: {}, currentPlan: null,
      setCurrentPlan: setCurrentPlanMock, setActiveAbort: setActiveAbortMock,
      chatSession: {}, cesarSession: {},
    };
    await handleForge('fixture', 'npm test', dispatchMock, ctx, undefined, false, true);
    expect(askQuestionMock).toHaveBeenCalledOnce();
    expect(convergeMock).toHaveBeenCalledTimes(['y', ' YES '].includes(answer) ? 1 : 0);
  });

  it('uses Cesar to prepare missing forge fitness before falling back', async () => {
    const { handleForge } = await import('../../packages/cli/src/handlers/forge.js');
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
    const { handleBuild } = await import('../../packages/cli/src/handlers/build.js');

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

  it('fails the build plan when a streamed agent returns a nonzero terminal result', async () => {
    const { handleBuild } = await import('../../packages/cli/src/handlers/build.js');
    dispatchAgentStreamMock.mockImplementation(async function* () {
      yield `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial work' }] } })}\n`;
      return {
        exitCode: 124,
        stdout: 'partial work',
        stderr: 'agent deadline exceeded',
        durationMs: 50,
        timedOut: true,
        diff: '',
        diffLines: 0,
        filesChanged: 0,
      };
    });

    const ctx: any = {
      askQuestion: askQuestionMock,
      activeEngines: () => ['codex'],
      config: { approvalLevel: 'plan', forgeFixedStarter: 'codex', agentTimeout: 60 },
      registry: {
        agentCapableIds: () => ['codex'],
        get: vi.fn(() => ({ timeout: 60 })),
      },
      adapter: { dispatchAgentStream: dispatchAgentStreamMock },
      currentPlan: null,
      setCurrentPlan: setCurrentPlanMock,
      setActiveAbort: setActiveAbortMock,
      chatSession: { messages: [] },
    };

    await handleBuild('fix login bug', dispatchMock, ctx, undefined, true);

    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('agent deadline exceeded'),
    }));
    expect(setCurrentPlanMock).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed' }));
  });
});
