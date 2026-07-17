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
