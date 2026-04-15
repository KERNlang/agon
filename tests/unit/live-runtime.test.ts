import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAgentProgressByTeamState,
  getLiveRuntimeState,
  pruneCompletedAgentProgressState,
  resetLiveRuntimeState,
  setChatStartTimeState,
  setCesarConfidenceState,
  setLiveProgressState,
  setLiveSpinnerState,
  updateAgentProgressState,
  updateStreamingTextState,
} from '../../packages/cli/src/live-runtime.js';

describe('live runtime store', () => {
  beforeEach(() => {
    resetLiveRuntimeState({ preserveConfidence: false });
  });

  it('updates live streaming and spinner state without dropping other fields', () => {
    setLiveSpinnerState({ message: 'thinking', color: 123, engineId: 'claude' });
    setLiveProgressState([{ id: 'claude', status: 'running', elapsed: 250, done: false, failed: false }]);
    updateStreamingTextState({
      claude: {
        engineId: 'claude',
        content: 'hello',
        startedAt: 1,
      },
    });

    expect(getLiveRuntimeState()).toMatchObject({
      liveSpinner: { message: 'thinking', color: 123, engineId: 'claude' },
      liveProgress: [{ id: 'claude', status: 'running', elapsed: 250, done: false, failed: false }],
      streamingText: {
        claude: {
          engineId: 'claude',
          content: 'hello',
          startedAt: 1,
        },
      },
    });
  });

  it('preserves confidence across soft resets', () => {
    setCesarConfidenceState(91);
    setChatStartTimeState(1234);
    setLiveSpinnerState({ message: 'working' });
    updateStreamingTextState({
      claude: {
        engineId: 'claude',
        content: 'hello',
        startedAt: 1,
      },
    });

    resetLiveRuntimeState({ preserveConfidence: true });

    expect(getLiveRuntimeState()).toEqual({
      liveSpinner: null,
      liveProgress: null,
      streamingText: {},
      agentProgress: {},
      cesarConfidence: 91,
      chatStartTime: 0,
    });
  });

  it('prunes completed agent progress and clears teams explicitly', () => {
    updateAgentProgressState({
      claude: {
        engineId: 'claude',
        turnIndex: 1,
        phase: 'completed',
        toolCalls: 2,
        tokensUsed: 100,
        elapsedMs: 5000,
        startedAt: 1000,
        turnsRemaining: 0,
        maxTurns: 4,
        teamId: 'team-1',
        completedAt: 1000,
      },
      codex: {
        engineId: 'codex',
        turnIndex: 1,
        phase: 'running',
        toolCalls: 1,
        tokensUsed: 50,
        elapsedMs: 1000,
        startedAt: 4000,
        turnsRemaining: 2,
        maxTurns: 4,
        teamId: 'team-2',
      },
    });

    pruneCompletedAgentProgressState(5000, 7001);
    expect(Object.keys(getLiveRuntimeState().agentProgress)).toEqual(['codex']);

    clearAgentProgressByTeamState('team-2');
    expect(getLiveRuntimeState().agentProgress).toEqual({});
  });
});
