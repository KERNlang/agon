import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @agon/core before importing app-output (which imports loadConfig/configSet)
// vi.mock is hoisted — cannot reference outer variables in factory, so use vi.hoisted
const { loadConfigMock, configSetMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn().mockReturnValue({}),
  configSetMock: vi.fn(),
}));

vi.mock('@agon/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@agon/core');
  return { ...actual, loadConfig: loadConfigMock, configSet: configSetMock };
});

// Stub markdown/code-buffer transitive deps to avoid side effects
vi.mock('../../packages/cli/src/markdown.js', () => ({
  parseMarkdownBlocks: () => [],
  cleanEngineOutput: (s: string) => s,
}));
vi.mock('../../packages/cli/src/code-buffer.js', () => ({
  codeBlockBuffer: { recordFromSegments: () => {}, clear: () => {} },
}));

import {
  handleOutputEvent,
  clearPermissionQueue,
  flushPendingToolCalls,
  _permissionQueue,
} from '../../packages/cli/src/generated/signals/output.js';
import type { OutputActions, OutputState } from '../../packages/cli/src/generated/signals/output.js';

function createMockActions(): OutputActions & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    setQuestionState: [],
    addBlock: [],
    setLiveSpinner: [],
    setLiveProgress: [],
    setStreamingText: [],
    setLiveToolStreams: [],
    clearBlocks: [],
    setReviewEvent: [],
    setPendingPlanProposal: [],
    setChatStartTime: [],
    flushStream: [],
    setAgentProgress: [],
  };
  return {
    calls,
    setQuestionState: vi.fn((...args) => calls.setQuestionState.push(args)),
    addBlock: vi.fn((...args) => calls.addBlock.push(args)),
    setLiveSpinner: vi.fn((...args) => calls.setLiveSpinner.push(args)),
    setLiveProgress: vi.fn((...args) => calls.setLiveProgress.push(args)),
    setStreamingText: vi.fn((...args) => calls.setStreamingText.push(args)),
    setLiveToolStreams: vi.fn((...args) => calls.setLiveToolStreams.push(args)),
    clearBlocks: vi.fn((...args) => calls.clearBlocks.push(args)),
    setReviewEvent: vi.fn((...args) => calls.setReviewEvent.push(args)),
    setPendingPlanProposal: vi.fn((...args) => calls.setPendingPlanProposal.push(args)),
    setChatStartTime: vi.fn((...args) => calls.setChatStartTime.push(args)),
    flushStream: vi.fn((...args) => calls.flushStream.push(args)),
    getEngineColor: vi.fn(() => 245),
    setAgentProgress: vi.fn((...args) => calls.setAgentProgress.push(args)),
  };
}

function emptyState(): OutputState {
  return { liveSpinner: null, liveProgress: null, streamingText: {}, liveToolStreams: {}, agentProgress: {} };
}

function firePermission(
  actions: OutputActions,
  tool: string,
  command: string,
  resolve: (approved: boolean) => void,
) {
  handleOutputEvent(
    { type: 'permission-ask', tool, command, reason: 'needs approval', resolve } as any,
    emptyState(),
    actions,
    'agent',
    0,
  );
}

describe('permission queue', () => {
  beforeEach(() => {
    // Drain any residual queue state between tests
    _permissionQueue.length = 0;
    loadConfigMock.mockReturnValue({});
    configSetMock.mockReset();
  });

  afterEach(() => {
    _permissionQueue.length = 0;
    vi.restoreAllMocks();
  });

  it('fires setQuestionState for the first permission immediately', () => {
    const actions = createMockActions();
    const resolve = vi.fn();

    firePermission(actions, 'Bash', 'npm test', resolve);

    expect(actions.calls.setQuestionState).toHaveLength(1);
    expect(actions.calls.setQuestionState[0][0]).toMatchObject({
      kind: 'permission',
      tool: 'Bash',
      command: 'npm test',
      prompt: 'Approve Bash',
    });
  });

  it('queues the second permission — only one setQuestionState at a time', () => {
    const actions = createMockActions();
    const resolve1 = vi.fn();
    const resolve2 = vi.fn();

    firePermission(actions, 'Bash', 'rm -rf /tmp/x', resolve1);
    firePermission(actions, 'Bash', 'curl http://evil', resolve2);

    // Only the first permission triggered setQuestionState
    expect(actions.calls.setQuestionState).toHaveLength(1);
    expect(actions.calls.setQuestionState[0][0]).toMatchObject({
      kind: 'permission',
      tool: 'Bash',
      command: 'rm -rf /tmp/x',
    });
    // Second is still in the queue
    expect(_permissionQueue).toHaveLength(2);
  });

  it('shows queued permission after resolving the first', async () => {
    const actions = createMockActions();
    const resolve1 = vi.fn();
    const resolve2 = vi.fn();

    firePermission(actions, 'Bash', 'npm test', resolve1);
    firePermission(actions, 'Bash', 'npm build', resolve2);

    expect(actions.calls.setQuestionState).toHaveLength(1);

    // Resolve the first permission via the question's resolve callback
    const firstQuestion = actions.calls.setQuestionState[0][0] as { resolve: (answer: string) => void };
    firstQuestion.resolve('y');

    expect(resolve1).toHaveBeenCalledWith(true);

    // _showNextPermission uses setTimeout(50), so wait for it
    await new Promise(r => setTimeout(r, 100));

    expect(actions.calls.setQuestionState).toHaveLength(2);
    expect(actions.calls.setQuestionState[1][0]).toMatchObject({
      kind: 'permission',
      tool: 'Bash',
      command: 'npm build',
    });
  });

  it('"Always" auto-resolves next queued permission with same base command', async () => {
    loadConfigMock.mockReturnValue({ allowedCommands: [] });

    const actions = createMockActions();
    const resolve1 = vi.fn();
    const resolve2 = vi.fn();

    firePermission(actions, 'Bash', 'npm test --watch', resolve1);
    firePermission(actions, 'Bash', 'npm install express', resolve2);

    // Answer first with "Always" — this should add "npm" to allowedCommands
    const firstQuestion = actions.calls.setQuestionState[0][0] as { resolve: (answer: string) => void };
    firstQuestion.resolve('a');

    expect(resolve1).toHaveBeenCalledWith(true);
    expect(configSetMock).toHaveBeenCalledWith('allowedCommands', ['npm']);

    // After "Always", the drain function should auto-approve the next queued "npm ..." command
    // loadConfig needs to return the updated allowedCommands for the drain
    loadConfigMock.mockReturnValue({ allowedCommands: ['npm'] });

    await new Promise(r => setTimeout(r, 100));

    // The second permission should have been auto-resolved (drained)
    expect(resolve2).toHaveBeenCalledWith(true);
  });

  it('clearPermissionQueue resolves all queued permissions with false', () => {
    const actions = createMockActions();
    const resolve1 = vi.fn();
    const resolve2 = vi.fn();
    const resolve3 = vi.fn();

    firePermission(actions, 'Bash', 'cmd1', resolve1);
    firePermission(actions, 'Bash', 'cmd2', resolve2);
    firePermission(actions, 'Bash', 'cmd3', resolve3);

    clearPermissionQueue();

    // All resolvers called with false
    expect(resolve1).toHaveBeenCalledWith(false);
    expect(resolve2).toHaveBeenCalledWith(false);
    expect(resolve3).toHaveBeenCalledWith(false);
    expect(_permissionQueue).toHaveLength(0);
  });

  it('denying a permission resolves with false', async () => {
    const actions = createMockActions();
    const resolve1 = vi.fn();

    firePermission(actions, 'Bash', 'rm -rf /', resolve1);

    const question = actions.calls.setQuestionState[0][0] as { resolve: (answer: string) => void };
    question.resolve('n');

    expect(resolve1).toHaveBeenCalledWith(false);
  });

  it('flushes slow running tool calls so active work is visible', () => {
    const actions = createMockActions();

    handleOutputEvent(
      { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'running' } as any,
      emptyState(),
      actions,
      'chat',
      0,
    );
    flushPendingToolCalls(actions);

    expect(actions.calls.addBlock).toHaveLength(1);
    const group = actions.calls.addBlock[0][0] as any;
    expect(group.type).toBe('tool-call-group');
    expect(group.blocks[0].event).toMatchObject({ tool: 'Read', status: 'running' });
  });

  it('replaces an unflushed running tool call with the final result', () => {
    const actions = createMockActions();
    const running = { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'running' } as any;
    const done = { ...running, status: 'done', output: 'file content' } as any;

    handleOutputEvent(running, emptyState(), actions, 'chat', 0);
    handleOutputEvent(done, emptyState(), actions, 'chat', 0);
    flushPendingToolCalls(actions);

    expect(actions.calls.addBlock).toHaveLength(1);
    const group = actions.calls.addBlock[0][0] as any;
    expect(group.blocks).toHaveLength(1);
    expect(group.blocks[0].event).toMatchObject({ tool: 'Read', status: 'done', output: 'file content' });
  });

  it('tracks streamed tool output live and flushes final output to scrollback', () => {
    const actions = createMockActions();

    handleOutputEvent(
      { type: 'tool-stream-start', streamId: 's1', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}' } as any,
      emptyState(),
      actions,
      'chat',
      0,
    );
    handleOutputEvent({ type: 'tool-stream-chunk', streamId: 's1', chunk: 'file ' } as any, emptyState(), actions, 'chat', 0);
    handleOutputEvent({ type: 'tool-stream-chunk', streamId: 's1', chunk: 'content' } as any, emptyState(), actions, 'chat', 0);
    handleOutputEvent({ type: 'tool-stream-end', streamId: 's1', status: 'done' } as any, emptyState(), actions, 'chat', 0);
    flushPendingToolCalls(actions);

    expect(actions.calls.setLiveToolStreams.length).toBeGreaterThanOrEqual(4);
    expect(actions.calls.addBlock).toHaveLength(1);
    const group = actions.calls.addBlock[0][0] as any;
    expect(group.blocks).toHaveLength(1);
    expect(group.blocks[0].event).toMatchObject({
      engineId: 'cesar',
      tool: 'Read',
      input: '{"file_path":"a.ts"}',
      status: 'done',
      output: 'file content',
    });
  });

  it('keeps plan proposals in the live approval panel instead of transcript blocks', () => {
    const actions = createMockActions();
    const event = {
      type: 'plan-proposal',
      plan: { id: 'cplan-test', state: 'awaiting_approval', steps: [] },
      markdown: '# Plan\n\nApprove me',
    } as any;

    handleOutputEvent(event, emptyState(), actions, 'chat', 0);

    expect(actions.calls.setPendingPlanProposal).toEqual([[event]]);
    expect(actions.calls.addBlock).toHaveLength(0);
  });
});
