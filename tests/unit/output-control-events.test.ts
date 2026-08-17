import { describe, expect, it, vi } from 'vitest';

// Mock @kernlang/agon-core before importing output (which imports loadConfig/configSet)
const { loadConfigMock, configSetMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn().mockReturnValue({}),
  configSetMock: vi.fn(),
}));

vi.mock('@kernlang/agon-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@kernlang/agon-core');
  return { ...actual, loadConfig: loadConfigMock, configSet: configSetMock };
});

// Stub markdown/code-buffer transitive deps to avoid side effects.
// output.ts imports markdown from ../blocks/markdown.js — mock the module it
// actually resolves (generated/blocks), not the hand-TS facade.
vi.mock('../../packages/cli/src/generated/blocks/markdown.js', () => ({
  parseMarkdownBlocks: () => [],
  cleanEngineOutput: (s: string) => s,
}));
vi.mock('../../packages/cli/src/code-buffer.js', () => ({
  codeBlockBuffer: { recordFromSegments: () => {}, clear: () => {} },
}));

// Source of truth: packages/cli/src/kern/signals/output.kern
import { handleOutputEvent } from '../../packages/cli/src/generated/signals/output.js';
import type { OutputActions, OutputState } from '../../packages/cli/src/generated/signals/output.js';

function createMockActions(): OutputActions & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { addBlock: [], flushStream: [] };
  return {
    calls,
    setQuestionState: vi.fn(),
    addBlock: vi.fn((...args) => calls.addBlock.push(args)),
    setLiveSpinner: vi.fn(),
    setLiveProgress: vi.fn(),
    setStreamingText: vi.fn(),
    setLiveToolStreams: vi.fn(),
    clearBlocks: vi.fn(),
    setReviewEvent: vi.fn(),
    setPendingPlanProposal: vi.fn(),
    setChatStartTime: vi.fn(),
    flushStream: vi.fn((...args) => calls.flushStream.push(args)),
    getEngineColor: vi.fn(() => 245),
    setAgentProgress: vi.fn(),
    replaceBlocksOfType: vi.fn(),
    setCesarConfidence: vi.fn(),
    setCesarContext: vi.fn(),
    setLiveScoreboard: vi.fn(),
    setLiveRationale: vi.fn(),
    clearAgentProgressByTeam: vi.fn(),
    setTodos: vi.fn(),
  };
}

function emptyState(): OutputState {
  return { liveSpinner: null, liveProgress: null, streamingText: {}, liveToolStreams: {}, agentProgress: {}, todos: [] };
}

describe('handleOutputEvent — control-plane events never render', () => {
  it('swallows engine-pid and engine-pid-clear instead of committing "[engine-pid-clear]" blocks', () => {
    const actions = createMockActions();
    handleOutputEvent({ type: 'engine-pid', engineId: 'codex', pid: 1234 } as any, emptyState(), actions, 'agent', 0);
    handleOutputEvent({ type: 'engine-pid-clear', engineId: 'codex' } as any, emptyState(), actions, 'agent', 0);
    expect(actions.calls.addBlock).toHaveLength(0);
    expect(actions.calls.flushStream).toHaveLength(0);
  });
});

describe('handleOutputEvent — plan proposal splits body from the approval question', () => {
  const proposal = {
    type: 'plan-proposal',
    plan: { id: 'plan-123', intent: 'Do the thing', steps: [{ id: 's1', type: 'self', description: 'step one' }] },
    markdown: '# Plan\n\nStatus: awaiting_approval\n\n1. step one\n',
  } as any;

  it('commits the plan body to the transcript with the controls suppressed, and pins the proposal', () => {
    const actions = createMockActions();
    handleOutputEvent(proposal, emptyState(), actions, 'chat', 0);

    // Body → scrollback (scrollable), so a multi-screen plan never buries the
    // question that now lives in the bottom chrome.
    expect(actions.calls.addBlock).toHaveLength(1);
    const body = actions.calls.addBlock[0][0] as any;
    expect(body.type).toBe('plan-proposal');
    expect(body.markdown).toBe(proposal.markdown);
    expect(body.hideApproval).toBe(true);
    expect(body.committed).toBeUndefined();

    // Question → pinned live slot (PlanApprovalPrompt above the composer).
    expect(actions.setPendingPlanProposal).toHaveBeenCalledWith(proposal);
  });

  it('records the superseded outcome on dismiss without duplicating the plan body', () => {
    const actions = createMockActions();
    handleOutputEvent(proposal, emptyState(), actions, 'chat', 0);
    handleOutputEvent({ type: 'plan-dismiss' } as any, emptyState(), actions, 'chat', 0);

    // Two blocks: the body (once) plus a one-line outcome record. The body's
    // 'Status: awaiting_approval' snapshot can never be rewritten in place —
    // Ink's <Static> is append-only and the sealed rows are already painted —
    // so the correction has to be appended or the transcript keeps claiming the
    // plan is still pending.
    expect(actions.calls.addBlock).toHaveLength(2);
    expect(actions.calls.addBlock.filter(([b]: any[]) => b.type === 'plan-proposal')).toHaveLength(1);
    const record = actions.calls.addBlock[1][0] as any;
    expect(record.type).toBe('info');
    expect(record.message).toContain('plan-123');
    expect(record.message).toContain('superseded');
    expect(actions.setPendingPlanProposal).toHaveBeenLastCalledWith(null);
  });

  it('stays silent on dismiss when this turn IS the approval (plan-execution is the record)', () => {
    const actions = createMockActions();
    handleOutputEvent(proposal, emptyState(), actions, 'chat', 0);
    handleOutputEvent({ type: 'plan-dismiss', outcome: 'approved' } as any, emptyState(), actions, 'chat', 0);

    expect(actions.calls.addBlock).toHaveLength(1);
    expect(actions.setPendingPlanProposal).toHaveBeenLastCalledWith(null);
  });

  it('adds no outcome record when nothing is pinned', () => {
    const actions = createMockActions();
    // The pinned-proposal ref is a module singleton; plan-cancelled clears it
    // unconditionally, so this makes the unpinned start state order-independent.
    handleOutputEvent({ type: 'plan-cancelled', plan: null } as any, emptyState(), actions, 'chat', 0);
    handleOutputEvent({ type: 'plan-dismiss' } as any, emptyState(), actions, 'chat', 0);

    expect(actions.calls.addBlock).toHaveLength(0);
  });

  it('releases the pinned question on rejection without adding a second block', () => {
    const actions = createMockActions();
    handleOutputEvent(proposal, emptyState(), actions, 'chat', 0);
    handleOutputEvent({ type: 'plan-cancelled', plan: proposal.plan } as any, emptyState(), actions, 'chat', 0);

    expect(actions.calls.addBlock).toHaveLength(1);
    expect(actions.setPendingPlanProposal).toHaveBeenLastCalledWith(null);
  });
});
